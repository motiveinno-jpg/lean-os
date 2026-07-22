# 오너뷰 정식 배포 체크리스트 (2026-07-21 작성 · 2026-07-22 갱신)

근거: 2026-07-21~22 세션 실측 — 보안 어드바이저 스캔, CODEF 답변 수신·CF-05001 원인 확정, 세금계산서 실발행 검증, 결제 파이프라인 배선, P0 코드 스윕(헬스체크·CODEF 로그·PDF 보안·의존성·CI·마이그레이션 정합).

완료 시 `[x]`. **실제로 검증한 것만 체크** — 미검증/사장님 액션은 `[ ]` 유지. P0 전부 완료 전 정식 배포 금지.

---

## ✅ 검증 완료 — 인프라/품질 (2026-07-22 실측)

- [x] 라이브 `/api/health/` = **healthy** (db·stripe·codef 전부 ok; Stripe balance·CODEF anon+RLS 거짓 degraded 해소)
- [x] `/status/` = 비로그인 **HTTP 200** (미들웨어 공개 라우트 추가)
- [x] `npm run typecheck` 통과 · `npm test` **110/110** 통과
- [x] `npm audit --omit=dev --audit-level=high` = **critical/high 0** (moderate 3 = next 번들 postcss, --force 불가)
- [x] `npm run smoke:db-guards` = **6/6** 크리티컬 트리거 존재
- [x] `npm run smoke:rls` PASS (Realtime WAL sender 오판 수정 — hung_5s 정상)
- [x] Security Advisor **ERROR 0** (v_deal_* security_invoker 전환 유지)
- [x] `npm run check:migrations` = **210건 all applied** (schema_migrations name 매칭 + 51건 객체검증 backfill로 정합)
- [x] CODEF 민감정보 로그 제거 (계좌·거래샘플·raw 응답 — codef-sync 재배포)
- [x] PDF 라우트 SSRF/XSS 하드닝 (자산 allowlist·sanitize·네트워크 차단·rate limit + 회귀테스트)
- [x] CI 게이트 하드닝 (preflight 토큰없으면 FAIL·순서강제 / qa-auto-fix injection차단·main push 제거·PR만)

## P0 — 런치 블로커 (하나라도 미완이면 배포 불가)

- [ ] **국세청 발행 신뢰성 확보** — 세금계산서는 해결, 현금영수증 미해결.
  - [x] CODEF 문의 발송 + **답변 수신(2026-07-22)**: CF-05001 원인 = sendToNtsYn=Y CODEF 로직 버그(세금계산서), 팝빌 상품권한 미부여(현금영수증)
  - [x] **세금계산서: sendToNtsYn=N 우회 적용 + 실발행 검증** (100원 테스트 issued·승인번호 수신·중복 없음, hometax-issue v35)
  - [ ] **현금영수증: 팝빌 계정 현금영수증 API 상품권한 활성화** (사장님/팝빌 액션 — 코드 무관, -99910002)
  - [ ] 중복 발행된 세금계산서 5건 취소 처리 (사장님)
- [ ] **Stripe 과금 실전 리허설** — 파이프라인 배선 완료(프로·울트라 price 생성·env 연결·연간 토글·"유효하지 않은 플랜" 해소). **실카드 체크아웃→구독활성→포털→해지→재구독 1바퀴 + webhook DB 갱신 확인은 미검증(사장님)**
- [x] **보안 ERROR 2건 해소** — v_deal_goal_actual·v_deal_revenue_actual security_invoker (마이그 20260721120000)
- [x] **공개 버킷 파일 열거 차단** — chat-files/company-assets 정책 스코프
- [x] **고장난 기능 노출 정리** — 현금영수증 발행 '베타' 배지·안내, 랜딩 과장문구 완화(전문솔루션 동등·100% 유지·SLA), 세금계산서는 검증완료라 정상 노출
- [ ] **Vercel Pro 전환 + Spend Management(월 $40)** (사장님)
- [ ] **CODEF 요금제 다운그레이드·재협상** (사장님)
- [ ] **CODEF 비밀번호 변경** (사장님, 즉시)
- [ ] **GitHub Actions 시크릿 등록** — SUPABASE_ACCESS_TOKEN·NEXT_PUBLIC_SUPABASE_URL·ANON_KEY (미등록이 최신 preflight 실패의 직접 원인) + main branch protection(PR필수·required check=preflight·Include administrators·force push 금지) (사장님)

## P1 — 배포 주간에 함께

- [ ] Supabase "유출 비밀번호 로그인 차단" 토글 (대시보드 5분, 사장님)
- [ ] 백업·복구 — PITR 활성 확인 + 복구 리허설 1회 (사장님)
- [ ] Sentry Edge 계측 — **Edge Function용 SENTRY_DSN 시크릿 등록**(현재 Vercel DSN만 있고 Edge용 없음) + 테스트 오류 1건 알림 수신 확인 (사장님)
- [ ] 신규 가입 온보딩 실주행 1회 (사장님)
- [x] 법적 페이지 — 약관 요금제명 실제(Free/프로/울트라/엔터프라이즈) 통일, 푸터 사업자정보(모티브이노베이션·155-88-02209·통신판매업 제2023-서울강남-04603호) e2e 강검증
- [ ] 발송 메일 스팸 테스트 — SPF/DKIM/DMARC (사장님)
- [ ] 테스트 데이터 청소 — 내부·QA 회사 아카이브 (사장님)
- [ ] 지원 채널 확정 (사장님)

## P2 — 배포 후 2주 내

- [~] 어드바이저 WARN 배치 — **부분 완료**: search_path 미고정 앱함수 → 0, 내부 _seed 함수 execute 회수 2, always-true RLS 6건 리뷰(sync_logs anon 축소 1 + 공개폼 5건은 의도라 유지). **남음(위험/저가치)**: SECURITY DEFINER 202건(앱 정식 RPC — 회수 금지, 정상), extension_in_public 2(pg_trgm 이동 시 인덱스 파손 위험), rls_enabled_no_policy 1(백업테이블, 안전 잠김)
- [ ] 미사용 가짜 폰트 제거 — NotoSansKR-Regular.ts(GitHub HTML) [x] 제거 완료
- [ ] 가입→체험→유료 전환 퍼널 지표 대시보드
- [ ] 요금제·가격 최종 점검 (프로 55,000·울트라 88,000·연간 10% 정합 완료)
- [ ] 첫 유료 고객 목표 (배포 후 30일 내 1곳)

---

진행 규칙: 항목 완료 시 이 파일에 체크 후 커밋. **P0 전체 완료 시점 = 배포일 확정 가능.**
남은 P0는 전부 사장님 액션(현금영수증 팝빌 권한·중복 5건 취소·Stripe 실카드 리허설·Vercel Pro·CODEF 비번/재협상·GitHub 시크릿+branch protection).
