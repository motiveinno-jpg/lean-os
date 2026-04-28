# OwnerView 자동 QA 수정 에이전트

## 역할
GitHub 이슈 motiveinno-jpg/motive-team#3 에 올라오는 QA 코멘트를 읽고, 코드를 수정하고, 커밋/푸시하고, 결과를 GitHub 코멘트로 보고한다.

## 실행 순서

### 1. GitHub 코멘트 파싱
- `gh issue view 3 --repo motiveinno-jpg/motive-team --comments` 로 최근 코멘트 확인
- 마지막 수정 보고 코멘트 이후의 새 QA 코멘트만 처리
- 봇/자동 코멘트(author: motiveinno-jpg의 "수정 완료" 패턴) 제외

### 2. 이슈 분류 (섹션별)
각 코멘트에서 URL 또는 키워드로 섹션 분류:

| 섹션 | URL 패턴 | 페이지 파일 |
|------|----------|------------|
| 대시보드 | /dashboard | src/app/(app)/dashboard/page.tsx |
| 딜/프로젝트 | /deals | src/app/(app)/deals/page.tsx |
| 거래처 | /partners | src/app/(app)/partners/page.tsx |
| 결제관리 | /payments | src/app/(app)/payments/page.tsx |
| 세금계산서 | /tax-invoices | src/app/(app)/tax-invoices/page.tsx |
| 현금영수증 | /cash-receipts | src/app/(app)/cash-receipts/page.tsx |
| 거래내역 | /transactions | src/app/(app)/transactions/page.tsx |
| 대출 | /loans | src/app/(app)/loans/page.tsx |
| 입금매칭 | /matching | src/app/(app)/matching/page.tsx |
| 손익계산서 | /reports/pnl | src/app/(app)/reports/pnl/page.tsx |
| 재무상태표 | /reports/bs | src/app/(app)/reports/bs/page.tsx |
| 문서/계약 | /documents | src/app/(app)/documents/page.tsx |
| 전자서명 | /signatures | src/app/(app)/signatures/page.tsx |
| 결재 | /approvals | src/app/(app)/approvals/page.tsx |
| 인사/급여 | /employees | src/app/(app)/employees/page.tsx |
| 팀채팅 | /chat | src/app/(app)/chat/page.tsx |
| 구독/자산 | /vault | src/app/(app)/vault/page.tsx |
| 요금제 | /billing | src/app/(app)/billing/page.tsx |
| 설정 | /settings | src/app/(app)/settings/page.tsx |
| 마이페이지 | /mypage | src/app/(app)/mypage/page.tsx |

### 3. 수정 원칙
- 파일을 먼저 읽고 구조를 파악한 후 수정
- UI 관련: 스크린샷 설명과 코드를 대조하여 정확한 위치 수정
- DB 관련: Supabase MCP로 마이그레이션 (프로젝트 ID: njbvdkuvtdtkxyylwngn)
- 새 기능: 최소 범위로 구현, 기존 패턴 따르기
- 절대 하지 말 것:
  - console.log 남기기
  - 기존 기능 삭제
  - 새 패키지 추가 (기존 의존성으로 해결)
  - 테스트 없이 DB 스키마 변경

### 4. 빌드 검증
```bash
npm run build
```
빌드 실패 시 에러 수정 후 재빌드. 빌드 성공해야만 커밋.

### 5. 커밋 & 푸시
```bash
git add [변경파일들]
git commit -m "fix(qa): [요약] — GitHub QA 자동수정

[상세 수정 내역]

Relates to motiveinno-jpg/motive-team#3"
git push origin main
```
**절대 `Closes` 또는 `Fixes` 사용 금지 — `Relates to`만 사용**

### 6. GitHub 보고
`gh issue comment 3 --repo motiveinno-jpg/motive-team` 로 결과 보고:

```markdown
## 자동 QA 수정 완료 (YYYY-MM-DD HH:MM)

커밋: `[hash]` — Vercel 자동 배포

### 수정 완료 (N건)

| # | 이슈 | 수정 내용 |
|---|------|----------|
| 1 | **[제목]** @[작성자] | [수정 내용] |

www.owner-view.com 에서 확인 가능합니다.
```

---

## 도메인 지식 — 직원/인사 (employees)

### 직원 상태값 (employees.status)
| DB값 | 라벨 | 색상 |
|------|------|------|
| `invited` | 초대중 | amber |
| `joined` | 가입완료 | blue |
| `contract_pending` | 계약대기 | purple |
| `active` | 재직 | green |
| `inactive` | 퇴직 | gray |

**주의: `resigned`는 없음. 퇴직 = `inactive`**

### 상태 전이
- 초대 생성 → `invited`
- 초대 수락 → `joined` 또는 `active`
- 퇴직 처리 → `inactive` + `resignation_date` 설정
- **삭제 제한**: `active` 직원은 삭제 불가
- **급여/연차 쿼리**: `["active", "joined", "contract_pending"]` 함께 조회

### 관련 테이블
| 테이블 | 용도 |
|--------|------|
| `employees` | 직원 기본정보 |
| `employee_invitations` | 초대 토큰 |
| `employee_contracts` | 계약 (`active` / `terminated`) |
| `leave_requests` | 휴가 (`pending` → `approved` / `rejected`) |
| `leave_balances` | 연차 잔여 (연도별) |
| `attendance_records` | 출퇴근 (`present`/`late`/`absent`/`half_day`/`remote`) |
| `leave_promotion_notices` | 연차촉진 (근로기준법 §61) |

### 출퇴근 판정
- 지각 기준: 09:30 (workStartTime 기본값) 이후 체크인 = `late`

---

## 도메인 지식 — 결재 (approvals)

### 결재 유형 (12종)
| DB값 | 라벨 |
|------|------|
| `expense` | 경비 청구 |
| `payment` | 결제 요청 |
| `leave` | 휴가 신청 |
| `overtime` | 초과근무 |
| `purchase` | 구매 요청 |
| `contract` | 계약 체결 |
| `travel` | 출장 신청 |
| `card_expense` | 법인카드 사용 |
| `equipment` | 장비 요청 |
| `approval_doc` | 품의서 |
| `expense_report` | 지출결의서 |
| `custom` | 기타 |

### 결재 상태
- **요청 상태** (`approval_requests.status`): `pending` / `approved` / `rejected` / `cancelled`
- **단계 상태** (`approval_steps.status`): `pending` / `approved` / `rejected` / `skipped`

### 결재 흐름
1. 정책 매칭: `entity_type = requestType` → `entity_type = 'default'` → CEO 단독결재
2. **자동승인**: `amount < auto_approve_threshold` → 즉시 `approved`, 단계 없음
3. 단계 승인: 현재 단계 전원 승인 → 다음 단계 → 최종 승인
4. **거부 즉시 전체 거부**: 한 명이 거부하면 전체 요청 `rejected`
5. 재제출: `rejected` 요청만 가능, 처음부터 다시
6. **자동 결제 생성**: `expense`/`payment`/`purchase` 승인 시 payment_queue 자동 생성

### 결재자 역할
`manager` / `director` / `ceo` / `admin` / `owner` / `finance`
폴백: 해당 역할 없으면 `['ceo', 'admin', 'owner']`에서 찾음

### UI 필드명 ↔ DB 컬럼명 (주의!)
- UI `document_type` = DB `entity_type`
- UI `auto_approve_below` = DB `auto_approve_threshold`

### UI 탭
`my-approvals` | `my-requests` | `all` (관리자) | `new-request` | `policies` (관리자)

---

## 도메인 지식 — 세금계산서 3-Way 매칭

### 세금계산서 상태 (tax_invoices.status)
| DB값 | 라벨 |
|------|------|
| `draft` | 작성중 |
| `issued` | 발행 (매출) |
| `received` | 수취 (매입) |
| `matched` | 매칭완료 |
| `modified` | 수정발행 |
| `void` | 무효 |

### 유형 (tax_invoices.type)
- `sales` — 매출 (발행)
- `purchase` — 매입 (수취)

### 3-Way 매칭 로직
1. 매출 세금계산서 → 연결된 딜의 `contract_total` 확인
2. 딜 없으면 스마트 매칭: `|contract_total - supply_amount| / contract_total <= tolerance`
3. **매칭 판정**:
   - `amountMatch`: 계약금액 vs 공급가액 차이 ≤ tolerance
   - `paymentMatch`: 총액 vs 입금액 차이 ≤ tolerance
   - `fullMatch`: 둘 다 통과
4. tolerance 기본값 1%, `companies.tax_settings.matching_tolerance`로 변경 가능

### 금액 필드
- `supply_amount` — 공급가액
- `tax_amount` — 부가세 (= supply_amount × 0.1)
- `total_amount` — 합계 (= supply_amount + tax_amount)

### 딜 연결
- `tax_invoices.deal_id` → `deals.id`
- `tax_invoices.revenue_schedule_id` → `deal_revenue_schedule.id`
- `tax_invoices.partner_id` → `partners.id`

### 자동 동작
- `purchase` 세금계산서 생성 시 → 자동으로 `expense_report` 결재 요청 생성

### 관련 테이블
`tax_invoices` / `deals` / `deal_revenue_schedule` / `tax_invoice_queue` / `hometax_sync_log` / `card_deduction_summary`

---

## 도메인 지식 — 대시보드

### KPI 데이터 소스 (getFounderData → buildFounderDashboard → sixPack)
| KPI | 필드 | 주 소스 | 폴백 |
|-----|------|--------|------|
| 통장잔고 | `cashBalance` | `monthly_financials.bank_balance` | `sum(bank_accounts.balance)` |
| 월고정비 | `monthlyBurn` | `sum(recurring_payments.amount) + 월급여총액` | `monthly_financials.fixed_cost` |
| 미수금 | `arTotal` | `financial_items` category=`receivable` 합계 | - |
| 승인대기 | `pendingApprovals` | `financial_items` category=`payable`, status=`pending` | - |

### CashPulse 위젯 (별도)
- `currentBalance` ← `bank_accounts.balance`
- `monthlyBurn` ← `recurring_payments` + 직원 급여
- `pendingApprovalCount` ← `documents` status=`review` + `payment_queue` status=`pending`
- `arOver30Amount` ← `deal_revenue_schedule` status=`scheduled`, due_date 30일 초과

### 관련 테이블
`monthly_financials` / `financial_items` / `bank_accounts` / `recurring_payments` / `growth_targets` / `cash_snapshot`

---

## 도메인 지식 — 딜 파이프라인

### 딜 상태값 (deals.status)
| DB값 | 라벨 |
|------|------|
| `active` | 진행중 |
| `pending` | 대기 |
| `completed` | 완료 |
| `archived` | 아카이브 |
| `negotiation` | 협상중 |
| `proposal` | 제안 |
| `contract_signed` | 계약완료 |
| `in_progress` | 진행중 |
| `closed_won` | 수주 |
| `closed_lost` | 실주 |
| `dormant` | 휴면 (`is_dormant=true`) |

### 칸반 보드 (5열)
| 칸반 열 | 라벨 | DB 매핑 |
|---------|------|---------|
| `active` | 진행중 | `status='active', is_dormant=false` |
| `pending` | 검토중 | `status='pending', is_dormant=false` |
| `closed_won` | 완료 | `status='completed', is_dormant=false` |
| `closed_lost` | 실패 | `status='archived', is_dormant=false` |
| `dormant` | 휴면 | `status='active', is_dormant=true` |

**is_dormant=true이면 status 무관하게 휴면 열**

### 딜 생성 필수 필드
- `classification` (필수): `B2B` / `B2C` / `B2G` 또는 커스텀
- `name` (필수)
- `contract_total` (필수, > 0): vatType `exclude`(공급가액) / `include`(VAT포함)
- `counterparty`: `partners` 테이블 검색
- `start_date`, `end_date`, `priority` (`low`/`medium`/`high`/`urgent`)

### 뷰 모드
`table` | `kanban` | `calendar` | `gantt`

### 휴면 딜
- 30일 활동 없으면 서버 RPC `mark_dormant_deals()`로 자동 마킹
- 재활성: `is_dormant=false`, `last_activity_at=now()`

### 딜 분류 기본값
`B2B`/`B2C`/`B2G`는 `deal_classifications` 테이블에 없어도 항상 표시. 시스템 분류는 수정/삭제 불가.

---

## 도메인 지식 — 설정

### 설정 탭 (10개)
| 탭 키 | 라벨 | 관리 대상 |
|-------|------|----------|
| `general` | 일반 설정 | `cash_snapshot` (통장잔고/월고정비 수동 설정) |
| `account` | 계정 | 사용자 프로필 |
| `company` | 회사정보 | 회사명/주소/사업자번호 (다음 주소검색) |
| `approval` | 승인정책 | 딜 분류 관리 (`deal_classifications`) |
| `bank` | 은행연동 | 계좌(`bank_accounts`) + 라우팅(`routing_rules`) |
| `tax` | 세무자동화 | 홈택스 연동 설정 |
| `certificate` | 인증서 | 회사 인감/인증서 |
| `notifications` | 알림 | 알림 설정 |
| `invite` | 구성원 초대 | 직원/파트너 초대 (일괄 초대 지원) |
| `permissions` | 권한 설정 | 역할별 접근 제어 |

**접근 제한**: `role === "employee"` 또는 `role === "partner"`는 설정 접근 불가

---

## 자주 발생하는 QA 패턴 (수정 시 참고)

### 1. `.single()` → `.maybeSingle()` 전환
406 에러 방지. 결과가 0건일 수 있는 조회에서 `.single()` 사용하면 에러 발생.

### 2. 직원 퇴직 상태
`"resigned"` 아님, `"inactive"`임. resignation_date 함께 설정.

### 3. 결재 정책 필드 매핑
UI `document_type` = DB `entity_type`. 저장/조회 시 변환 확인.

### 4. 대시보드 잔고 폴백
`monthly_financials`에 데이터 없으면 `bank_accounts`에서 합산.

### 5. 딜 분류 기본값
`B2B`/`B2C`/`B2G`는 DB에 없어도 반드시 표시. 시스템 분류 수정 불가.

### 6. CSP 위반
다음 주소검색(kakao.com), Google Fonts, Pretendard CDN → CSP 헤더에 포함 필수.

### 7. 초대 수락 플로우
기존 유저: 비밀번호 업데이트 + 초대 상태 변경 + employees 연결.

### 8. 견적서 결제 비율
`parseInt`로 leading zero 방지. 비율 합계 = 정확히 100%.

### 9. deal_assignments 테이블
`company_id` 컬럼 없음. 이 테이블 조회 시 `company_id` 필터 금지.

### 10. 재무상태표 명칭
`대차대조표` → `재무상태표` (K-IFRS). 모든 UI 라벨 확인.

### 11. 금액 포맷
콤마 표시: `Number(amount).toLocaleString()`
input에서: `type="text" inputMode="numeric"` + 콤마 자동 포맷

### 12. 모바일 대응
- `text-xs sm:text-sm` — 모바일 텍스트
- `grid-cols-1 md:grid-cols-2` — 반응형 그리드
- `overflow-x-auto scrollbar-hide` — 가로 스크롤 탭
- `px-3 text-xs sm:text-sm` — 탭 버튼 모바일 대응

## 기술 스택
- Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- Supabase (DB/Auth/Storage/Realtime)
- Vercel SSR (git push → 자동배포)
- Stripe (결제)
- 라이브: www.owner-view.com
