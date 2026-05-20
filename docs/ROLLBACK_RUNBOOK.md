# OwnerView 롤백 런북 (P0 인시던트 — "누가·무엇·몇 분 내")

> 본 문서는 운영 신뢰성 P0-4 산출물. **인시던트 발생 → 5분 안에 이 표만 보고 즉시 행동**.
> 검증된 라이브 스모크 기법은 `~/motive-brain/lessons.md` 의 *"Management API 단독으로 RLS-컨텍스트 재귀 시뮬"* 항목.

---

## 시나리오 ① — 로그인 504 전면장애 (커넥션풀 고갈 / RLS 재귀)

**증상**: `/auth`·로그인 부트스트랩 504/timeout, `prod home` HTTP 200이지만 로그인 직후 hang. `getCurrentUser` (SELECT users + SELECT employees) 응답 없음. Management API 도 544 가능.

**즉시 판정 (1분)**:
```bash
# 1) 위험 정책 — 정책 본문에 인라인 서브쿼리가 있는지 (재귀 시그니처)
node scripts/apply-supabase-migration.mjs --query \
  "SELECT count(*) bad FROM pg_policies WHERE schemaname='public' AND qual ~* '\\mSELECT\\M' AND tablename IN ('users','employees','payslip_overrides','card_transactions','corporate_cards','payroll_items');"

# 2) 5초+ hung 쿼리 카운트
node scripts/apply-supabase-migration.mjs --query \
  "SELECT count(*) hung_5s FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '5 seconds';"
```
- `bad > 0` 또는 `hung_5s > 0` → RLS 재귀 확진.

**조치 (5분 내)**:
1. **직전 RLS 마이그 식별** — `git log --oneline supabase/migrations/ | head -5` 에서 가장 최근 RLS 관련 파일 확인. 의심이 가는 정책은 "FOR SELECT" 또는 "RESTRICTIVE" 추가본.
2. **롤백 마이그 재적용** (검증된 안전 상태로 즉시 원복):
   ```bash
   # 예: 급여·카드 RLS 재하드닝 롤백 (PART A 인시던트 시 사용한 검증된 경로)
   node scripts/apply-supabase-migration.mjs supabase/migrations/20260519030000_rollback_restrict_salary_card_select_recursion.sql
   ```
   - 직전 변경이 RLS 정책 추가/교체였다면 그 변경에 해당하는 `*_rollback_*.sql` 또는 `DROP POLICY IF EXISTS ... ; -- 직전 정의 복원` 인라인 적용.
3. **확인 (1분)**: 위 STEP1 쿼리 둘 다 0 → 신규 세션 로그인 1회 → 504 해소.
4. **최악 시 에스컬레이션**: pg_terminate_backend·관리 API 모두 슬롯 못 잡는 544 상태 → **Supabase Dashboard 에서 DB 재시작** → 깨끗한 창에서 즉시 롤백 마이그 재적용.

**재발 방지 검증 (배포 전 필수)**:
- `npm run smoke:rls` (P0-5) 의 authenticated 컨텍스트 부트스트랩 재귀 sim 8s 바운드 통과해야 배포.
- 메모리 `feedback_rls_recursion_gate`: 정책 본문 users/employees 인라인 서브쿼리 금지, SECURITY DEFINER 헬퍼만.

---

## 시나리오 ② — 결제 webhook 실패 (Stripe / Toss)

**증상**: 결제 영수증/구독 상태가 DB에 반영 안 됨. Stripe Dashboard 의 Webhook attempts 에 4xx/5xx, 또는 Toss callback 실패.

**즉시 판정 (2분)**:
- Stripe Dashboard → Developers → Webhooks → 해당 endpoint 의 Recent deliveries 확인 (200 vs 4xx/5xx).
- 우리 측 webhook 라우트: `src/app/api/stripe/webhook/route.ts` (있다면) / Toss: `src/app/api/payments/toss/*`. Vercel 로그에서 해당 라우트의 500 / 서명 검증 실패 확인.
- 시크릿 회전: `STRIPE_WEBHOOK_SECRET` / `TOSS_SECRET_KEY` 최근 변경 여부.

**조치**:
1. **서명 검증 실패** = 시크릿 불일치 → Vercel 환경변수에서 secret 재설정·재배포. Stripe 의 경우 dashboard 의 webhook signing secret 과 환경변수 동기화.
2. **DB 쓰기 실패** → 위 시나리오 ① RLS 재귀 점검 먼저, 아니면 해당 INSERT 타깃 테이블의 RLS WITH CHECK 확인 (서비스롤 키 사용 여부).
3. **재처리**: Stripe Dashboard "Resend" 또는 Toss 의 결제내역 조회 → 누락 건 수동 처리. 사용자에게 1건씩 재시도 확인.
4. **에스컬레이션**: 5분 내 해소 안 되면 사용자에게 결제수단 일시 정지 안내 + 영수증 수동발급.

---

## 시나리오 ③ — 은행 sync 정지 (며칠 조용한 적재실패)

**증상**: 통장 잔액 정체, 거래내역이 N일 이상 동일 maxd. (예: 5/14 사건 — codef-sync 가 CF-00000 성공 응답에도 ON CONFLICT 불일치로 silent insertErrors=25/2.)

**즉시 판정 (1분)**:
```bash
# 최근 24h codef_bank insert 카운트 + 계좌별 max(transaction_date)
node scripts/apply-supabase-migration.mjs --query \
  "SELECT count(*) FILTER (WHERE created_at > now()-interval '24 hours') AS last_24h_ingest, count(*) AS total FROM bank_transactions WHERE source='codef_bank';"

# 최근 codef_bank_cron sync_log 의 debug array 에서 insertErrors 라인 추출
node scripts/apply-supabase-migration.mjs --query \
  "SELECT d FROM sync_logs s, LATERAL jsonb_array_elements_text(s.details->'bank'->'debug') d WHERE s.sync_type='codef_bank_cron' AND s.created_at > now()-interval '24 hours' AND d ILIKE '%insertErrors%' LIMIT 5;"
```
- `last_24h_ingest=0` → sync 정지. `insertErrors` 라인 보임 → ON CONFLICT 불일치(5/14 시그니처).

**조치 (5~10분 내)**:
1. **ON CONFLICT/유니크 인덱스 불일치** (5/14 케이스): codef-sync `bank_transactions.upsert(..., {onConflict:'external_id'})` 와 매칭되는 **비-부분** 유니크 인덱스가 있는지 확인. 부분(WHERE) 인덱스만 있으면 bare arbiter 가 매칭 실패. 해결: `20260519090000_bank_tx_external_unique_full.sql` 처럼 전체 유니크 인덱스로 교체.
   ```sql
   DROP INDEX IF EXISTS public.uq_bank_tx_external;
   CREATE UNIQUE INDEX uq_bank_tx_external ON public.bank_transactions(external_id);
   ```
2. **인증/CODEF 외부 채널** (CF-00401 권한 / CF-13021 형식 / CF-00007 / connectedId 만료): 사용자 측 재인증 안내. **BLOCKED**: 코드로 우회 시도 금지(CF-12200/00007/00000 는 운영팀 트랙).
3. **catch-up**: 위 수정 후 수동 발사:
   ```bash
   # 등록된 bank-sync-tick cron 명령을 즉시 실행 (다음 0/13시 안 기다림)
   node scripts/apply-supabase-migration.mjs --query \
     "DO \$\$ DECLARE c text; BEGIN SELECT command INTO c FROM cron.job WHERE jobname='bank-sync-tick'; EXECUTE c; END \$\$;"
   ```
   - 1~2분 뒤 sync_logs 에 `codef_bank_cron status=success synced>0` + bank_transactions.maxd 가 today 근접.
4. **잔액 정정**: `SELECT public.recompute_bank_balances('<company_uuid>');` (e39b351 산식, 멱등).

**재발 방지 검증**:
- P0-2 의 일일 health RPC 가 24h ingest=0 / insertErrors 패턴을 자동 감지·텔레그램 알림.
- 메모리 `lessons.md` 의 "Management API authed-context sim" 으로 codef-sync 변경 시 사전 검증.

---

## 공통 — 즉시 사용 가능한 검증 기법 (메모리 lessons.md 기록)

**Authed RLS-컨텍스트 시뮬레이션** (비파괴, prod 안전):
```sql
BEGIN;
SET LOCAL statement_timeout='8000';
SET LOCAL request.jwt.claims='{"sub":"<user_auth_id>","role":"authenticated"}';
SET LOCAL ROLE authenticated;
-- 부트스트랩 재현
SELECT count(*) FROM users;
SELECT count(*) FROM employees;
-- 대상 테이블 RLS 동작 확인
SELECT count(*) FROM payroll_items;
ROLLBACK;
```
- 8s 안 응답 + cross-company 0 → RLS 정상. 8s timeout 또는 다른 회사 행 노출 → 즉시 롤백.

**롤백 후 검증 체크리스트**:
- [ ] `bad_inline_subq=0` (정책 본문 서브쿼리 0)
- [ ] `hung_5s=0` (커넥션 hung 0)
- [ ] 신규 세션 로그인 1회 → 200 응답
- [ ] owner 계정 → 전체 데이터 보임
- [ ] 직원 계정 → 본인 데이터만, 타사 0

---

## 권한 / 책임

- **즉시 대응**: 메인 운영자 (Slack/Telegram 알림 수신자).
- **DB 재시작 권한**: Supabase Dashboard 접근권자.
- **에스컬레이션 → CODEF/Stripe/Toss 운영팀**: 각 서비스 support 채널.
- **사후 회고**: 인시던트 종료 후 24h 내 `~/motive-brain/lessons.md` 에 원인·조치·재발방지 추가.
