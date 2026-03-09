# OwnerView 대화형 회사 운영 OS — 제품 명세서

> 작성일: 2026-03-07 | 버전: v1.0 | 상태: 설계 완료, 구현 대기
> 내일 아침 9시 의사결정용

---

## 한 장 요약 (Executive Summary)

**무엇**: OwnerView 대시보드 상단에 자연어 입력창 추가. 대표가 한글로 질문하면 기존 64개 테이블 + 80개 쿼리 + 15개 엔진을 조합해 카드형 응답 반환.

**왜**: 현재 대시보드는 "보는 도구"일 뿐. 대표는 매일 반복되는 5가지 질문에 대해 매번 3~4개 페이지를 돌아다녀야 함. 입 대신 손을 쓰는 비효율.

**핵심 원칙**:
- 새 DB 테이블 0개 (기존 64개 테이블 100% 재사용)
- 외부 AI API 호출 0건 (키워드 매칭 → 순수 DB 쿼리)
- 기존 페이지/기능 변경 0건 (추가만)
- MVP = 5개 명령 완전 동작 → 이후 확장

**아키텍처**:
```
[입력창] → intent-parser.ts (키워드→인텐트) → command-router.ts (인텐트→쿼리 조합) → ResponseCard (카드 UI)
```

---

## 1. MVP 5개 대표 명령 상세 명세

---

### 명령 1: "오늘 뭐가 위험해?"

#### 1-1. 입력 변형 (10개)
| # | 입력 예시 |
|---|-----------|
| 1 | 오늘 뭐가 위험해? |
| 2 | 위험한 거 있어? |
| 3 | 리스크 현황 |
| 4 | 문제 있는 딜 보여줘 |
| 5 | 경고 뜬 거 있어? |
| 6 | 위험 구역 |
| 7 | 주의해야 할 거 |
| 8 | 오늘 경보 |
| 9 | 마진 낮은 딜 |
| 10 | 미수금 연체된 거 |

#### 1-2. 인텐트
```typescript
{ intent: 'risk_overview', entities: {}, priority: 'high' }
```

#### 1-3. 데이터 소스 & 쿼리
| 순서 | 함수 | 테이블 | 설명 |
|------|------|--------|------|
| 1 | `getSurvivalData(companyId)` | cash_snapshot, deals, deal_revenue_schedule, deal_cost_schedule, transactions, deal_nodes, employees | 생존 raw 데이터 |
| 2 | `getFounderData(companyId)` | monthly_financials, financial_items, growth_targets, deals | 재무 항목 |
| 3 | `getRecurringPayments(companyId)` | recurring_payments, bank_accounts | 고정비 |
| 4 | `getMonthlyTotalSalary(companyId)` | employees | 급여 총합 |
| 5 | `getCashPulseData(companyId)` | bank_accounts + 7개 추가 | 현금 펄스 입력 |

**엔진 체인**:
```
getSurvivalData + getFounderData → buildFounderDashboard() → { risks: RiskItem[], sixPack, riskCounts }
getCashPulseData → buildCashPulse() → { riskCount, pulseScore, briefing }
```

#### 1-4. 응답 데이터 구조
```typescript
interface RiskOverviewResponse {
  type: 'risk_overview';
  pulseScore: number;          // 0-100
  pulseLevel: 'critical' | 'danger' | 'warning' | 'stable' | 'safe';
  briefing: string;            // "잔고 1,800만원. 30일 후 850만원 예상."
  runwayMonths: number;
  runwayLevel: string;         // 'CRITICAL' ~ 'SAFE'
  risks: Array<{
    label: 'LOW_MARGIN' | 'DUE_SOON' | 'AR_OVER_30' | 'OUTSOURCE_OVER_MARGIN';
    title: string;             // "낮은 마진: A프로젝트 (12%)"
    dealName: string;
    amount?: number;
    severity: 'high' | 'medium';
    actionLabel: string;       // "딜 상세 보기"
    actionHref: string;        // "/deals/{dealId}"
  }>;
  riskCounts: Record<string, number>;  // { LOW_MARGIN: 2, DUE_SOON: 1, ... }
  pendingApprovalCount: number;
  timestamp: string;
}
```

#### 1-5. 응답 UI 예시
```
┌─────────────────────────────────────────────────────────┐
│ 🔍 위험 현황                               펄스 72/100  │
│                                                         │
│ "잔고 1,800만원. 30일 후 850만원 예상. 미수금 2건 주의" │
│                                                         │
│ ⚠️ 낮은 마진                                        2건 │
│ ├─ A프로젝트: 마진 12% (목표 20%)     [딜 상세 보기 →] │
│ └─ C프로젝트: 마진 8%                 [딜 상세 보기 →] │
│                                                         │
│ 🔴 미수금 연체 30일+                                1건 │
│ └─ B거래처: ₩3,200,000 (45일 경과)   [미수금 관리 →]  │
│                                                         │
│ 📋 승인 대기                                        3건 │
│ └─ [승인센터 바로가기 →]                               │
│                                                         │
│ 생존 개월: 4.2개월 (⚠️ WARNING)                        │
├─────────────────────────────────────────────────────────┤
│ [전체 위험 상세 ↗]  [현금 펄스 ↗]  [📋 승인센터 ↗]    │
└─────────────────────────────────────────────────────────┘
```

#### 1-6. 액션 버튼
| 버튼 | 타입 | 동작 |
|------|------|------|
| 딜 상세 보기 | navigate | `router.push('/deals/{dealId}')` |
| 미수금 관리 | navigate | `router.push('/finance?tab=receivables')` |
| 승인센터 바로가기 | navigate | `router.push('/approvals')` |
| 전체 위험 상세 | scroll | 대시보드 risk_zone 위젯으로 스크롤 |
| 현금 펄스 | scroll | 대시보드 cash_pulse 위젯으로 스크롤 |

#### 1-7. 승인 버튼 (L3 액션 해당 없음)
이 명령은 **L1 (읽기 전용)**. 승인 필요 없음.

#### 1-8. 에러 상태
| 상황 | 표시 |
|------|------|
| 데이터 없음 (신규 회사) | "아직 등록된 딜이 없습니다. 첫 딜을 등록해보세요." + [딜 등록 →] |
| 위험 0건 | "현재 감지된 위험이 없습니다. 펄스 점수 {score}점 ({level})" |
| 쿼리 실패 | "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." |

#### 1-9. 역할별 차이
| 역할 | 동작 |
|------|------|
| owner | 전체 위험 + 펄스 + 승인 대기 표시 |
| admin | 전체 위험 + 펄스 표시, 승인 대기는 본인 담당분만 |
| employee | 접근 불가 → "이 명령은 관리자 이상만 사용할 수 있습니다." |
| partner | 접근 불가 |

---

### 명령 2: "이번 주 나갈 돈 보여줘"

#### 2-1. 입력 변형 (10개)
| # | 입력 예시 |
|---|-----------|
| 1 | 이번 주 나갈 돈 보여줘 |
| 2 | 이번 주 지출 |
| 3 | 이번 주에 뭐 내야 해? |
| 4 | 금주 결제 예정 |
| 5 | 이번 주 비용 |
| 6 | 이번주 출금 예정 |
| 7 | 돈 나갈 거 |
| 8 | 이번 주 고정비 |
| 9 | 결제 스케줄 |
| 10 | 오늘~금요일 지출 |

#### 2-2. 인텐트
```typescript
{ intent: 'weekly_outflow', entities: { period: 'this_week' }, priority: 'medium' }
```
**기간 파싱**: "이번 주" → 이번 주 월~일, "다음 주" → 다음 주 월~일, "이번 달" → 이번 달 1~말일

#### 2-3. 데이터 소스 & 쿼리
| 순서 | 함수 | 테이블 | 필터 |
|------|------|--------|------|
| 1 | `getPaymentQueue(companyId)` | payment_queue, bank_accounts, deal_cost_schedule | status=pending/approved |
| 2 | 직접 쿼리 | deal_cost_schedule | due_date BETWEEN 주 시작~끝, status=scheduled |
| 3 | `getRecurringPayments(companyId)` | recurring_payments | is_active=true, day_of_month가 해당 주에 포함 |
| 4 | 직접 쿼리 | expense_requests | status=approved, created_at 해당 주 |
| 5 | `getBankAccounts(companyId)` | bank_accounts | 현재 잔고 확인용 |

**새로 작성 필요한 쿼리**: `getWeeklyOutflow(companyId, startDate, endDate)` — 위 4개를 병렬 fetch 후 합산

#### 2-4. 응답 데이터 구조
```typescript
interface WeeklyOutflowResponse {
  type: 'weekly_outflow';
  period: { start: string; end: string; label: string };  // "3/7(월)~3/13(일)"
  totalOutflow: number;
  currentBalance: number;
  balanceAfter: number;         // currentBalance - totalOutflow
  isDeficit: boolean;           // balanceAfter < 0
  categories: Array<{
    category: string;           // "외주비", "급여", "고정비", "기타"
    amount: number;
    count: number;
    items: Array<{
      name: string;             // "디자인 외주비 - A프로젝트"
      amount: number;
      dueDate: string;
      status: 'pending' | 'approved' | 'scheduled';
      dealName?: string;
      actionLabel?: string;
      actionHref?: string;
    }>;
  }>;
  warnings: string[];           // ["잔고 부족: 지출 후 -340만원 예상"]
}
```

#### 2-5. 응답 UI 예시
```
┌─────────────────────────────────────────────────────────┐
│ 💸 이번 주 지출 예정 (3/7~3/13)                         │
│                                                         │
│ 총 지출 예정:  ₩8,420,000                              │
│ 현재 잔고:     ₩12,300,000                             │
│ 지출 후 잔고:  ₩3,880,000  ✅                          │
│                                                         │
│ ─── 외주비 (₩4,200,000 · 2건) ──────────              │
│ • 디자인 외주 - A프로젝트     ₩2,800,000  3/8 (월)    │
│ • 개발 외주 - C프로젝트       ₩1,400,000  3/10 (수)   │
│                                                         │
│ ─── 고정비 (₩3,220,000 · 4건) ──────────              │
│ • 사무실 임대료               ₩1,800,000  3/10 (수)   │
│ • AWS 서버                    ₩520,000    3/8 (월)    │
│ • Figma 구독                  ₩200,000    3/9 (화)    │
│ • 통신비                      ₩700,000    3/10 (수)   │
│                                                         │
│ ─── 기타 (₩1,000,000 · 1건) ────────────              │
│ • 직원 경비 청구              ₩1,000,000  승인 대기   │
├─────────────────────────────────────────────────────────┤
│ [결제 큐 보기 ↗]  [고정비 관리 ↗]  [캘린더로 보기]     │
└─────────────────────────────────────────────────────────┘
```

#### 2-6. 액션 버튼
| 버튼 | 타입 | 동작 |
|------|------|------|
| 결제 큐 보기 | navigate | `/finance?tab=payment-queue` |
| 고정비 관리 | navigate | `/finance?tab=recurring` |
| 캘린더로 보기 | navigate | `/calendar` (미구현 시 비활성) |
| 개별 항목 클릭 | navigate | 해당 딜/비용 상세 |

#### 2-7. 에러 상태
| 상황 | 표시 |
|------|------|
| 이번 주 지출 0건 | "이번 주 예정된 지출이 없습니다." |
| 잔고 부족 예상 | 🔴 경고 배너: "지출 후 잔고 부족 예상 (-₩340만원). 입금 일정을 확인하세요." |
| 기간 파싱 실패 | "기간을 이해하지 못했습니다. '이번 주', '다음 주', '이번 달'로 다시 입력해주세요." |

#### 2-8. 역할별 차이
| 역할 | 동작 |
|------|------|
| owner | 전체 지출 + 잔고 비교 |
| admin | 전체 지출 표시 (잔고는 권한 있을 때만) |
| employee | 본인 경비 청구분만 |
| partner | 접근 불가 |

---

### 명령 3: "미수금 큰 순서대로 보여줘"

#### 3-1. 입력 변형 (10개)
| # | 입력 예시 |
|---|-----------|
| 1 | 미수금 큰 순서대로 보여줘 |
| 2 | 미수금 현황 |
| 3 | 받을 돈 얼마야? |
| 4 | 미수금 연체 |
| 5 | AR 현황 |
| 6 | 안 들어온 돈 |
| 7 | 수금 현황 |
| 8 | 매출채권 |
| 9 | 미수금 정리 |
| 10 | 돈 안 들어온 거 |

#### 3-2. 인텐트
```typescript
{ intent: 'ar_overview', entities: { sort: 'amount_desc' }, priority: 'medium' }
```

#### 3-3. 데이터 소스 & 쿼리
| 순서 | 함수 | 테이블 | 설명 |
|------|------|--------|------|
| 1 | 직접 쿼리 | deal_revenue_schedule + deals | status='scheduled', due_date <= today (연체) + 전체 미수 |
| 2 | `getDealMatchingStatuses(companyId)` | deals, revenue_schedule, tax_invoices, bank_transactions | 매칭 상태 |
| 3 | 직접 쿼리 | financial_items | category='receivable', risk_label 포함 |
| 4 | `getTaxInvoices(companyId)` | tax_invoices | type='sales', 발행 vs 미입금 대조 |

**새로 작성 필요한 쿼리**: `getReceivablesDetail(companyId)` — 미수금 전체 리스트 + 연체일 계산 + 거래처별 합산

#### 3-4. 응답 데이터 구조
```typescript
interface AROverviewResponse {
  type: 'ar_overview';
  totalReceivable: number;        // 총 미수금
  overdueAmount: number;          // 30일+ 연체 금액
  overdueCount: number;
  items: Array<{
    dealName: string;
    counterparty: string;
    amount: number;
    dueDate: string;
    daysOverdue: number;          // 0이면 미연체, 양수면 연체일수
    status: 'on_time' | 'overdue_7' | 'overdue_30' | 'overdue_60';
    hasInvoice: boolean;          // 세금계산서 발행 여부
    matchStatus: 'matched' | 'partial' | 'unmatched';
    dealId: string;
  }>;
  byCounterparty: Array<{        // 거래처별 합산
    counterparty: string;
    total: number;
    count: number;
    maxOverdueDays: number;
  }>;
}
```

#### 3-5. 응답 UI 예시
```
┌─────────────────────────────────────────────────────────┐
│ 📊 미수금 현황 (금액순)                                  │
│                                                         │
│ 총 미수금: ₩28,400,000 (8건)                           │
│ 연체 30일+: ₩8,200,000 (2건) 🔴                        │
│                                                         │
│ # │ 거래처      │ 프로젝트   │ 금액        │ 상태      │
│ 1 │ (주)한진    │ B프로젝트  │ ₩5,200,000 │ 🔴 45일↑  │
│ 2 │ ABC Corp   │ D프로젝트  │ ₩4,800,000 │ ⏰ 7일 전  │
│ 3 │ (주)한진    │ E프로젝트  │ ₩3,000,000 │ 🔴 32일↑  │
│ 4 │ 넥슨       │ A프로젝트  │ ₩2,400,000 │ ✅ 기한 내 │
│ ...                                                     │
│                                                         │
│ ── 거래처별 합산 ──                                     │
│ (주)한진:  ₩8,200,000 (2건, 최대 45일 연체) ⚠️         │
│ ABC Corp: ₩4,800,000 (1건)                             │
│ 넥슨:     ₩2,400,000 (1건)                             │
├─────────────────────────────────────────────────────────┤
│ [세금계산서 대조 ↗]  [독촉 메시지 생성]  [엑셀 다운로드] │
└─────────────────────────────────────────────────────────┘
```

#### 3-6. 액션 버튼
| 버튼 | 타입 | 동작 |
|------|------|------|
| 세금계산서 대조 | navigate | `/finance?tab=matching` |
| 독촉 메시지 생성 | L2 action | 템플릿 기반 독촉 문구 생성 (클립보드 복사) |
| 엑셀 다운로드 | client action | CSV/Excel 파일 생성 다운로드 |
| 행 클릭 | navigate | `/deals/{dealId}` |

#### 3-7. 에러 상태
| 상황 | 표시 |
|------|------|
| 미수금 0건 | "현재 미수금이 없습니다. 모든 매출이 정상 수금되었습니다. 🎉" |
| 쿼리 실패 | "미수금 데이터를 불러오지 못했습니다." |

#### 3-8. 역할별 차이
| 역할 | 동작 |
|------|------|
| owner | 전체 미수금 + 거래처별 합산 |
| admin | 동일 |
| employee | 접근 불가 |
| partner | 본인 관련 딜의 미수금만 |

---

### 명령 4: "오늘 승인할 것만 보여줘"

#### 4-1. 입력 변형 (10개)
| # | 입력 예시 |
|---|-----------|
| 1 | 오늘 승인할 것만 보여줘 |
| 2 | 결재 대기 |
| 3 | 승인 목록 |
| 4 | 뭐 결재해야 해? |
| 5 | 대기 중인 결재 |
| 6 | 승인 대기 현황 |
| 7 | 결재할 거 |
| 8 | 승인 큐 |
| 9 | 대기함 보여줘 |
| 10 | 처리해야 할 것 |

#### 4-2. 인텐트
```typescript
{ intent: 'pending_approvals', entities: {}, priority: 'high' }
```

#### 4-3. 데이터 소스 & 쿼리
| 순서 | 함수 | 테이블 | 설명 |
|------|------|--------|------|
| 1 | `getCEOPendingActions(companyId)` | 7개 소스 병렬 | 전체 대기 목록 |
| 2 | `getApprovalSummary(companyId)` | 동일 7개 소스 | 유형별 건수 |

**7개 승인 소스 (기존 완전 구현됨)**:
1. `payment_queue` — 결제 대기 (status=pending)
2. `expense_requests` — 경비 청구 (status=pending)
3. `documents` — 문서 검토 (status=review)
4. `leave_requests` — 휴가 신청 (status=pending)
5. `signature_requests` — 전자서명 (status=pending)
6. `deal_cost_schedule` — 원가 승인 (approved=false)
7. `approval_requests` — 범용 승인 (status=pending, current_stage 매칭)

#### 4-4. 응답 데이터 구조
```typescript
interface PendingApprovalsResponse {
  type: 'pending_approvals';
  totalCount: number;
  summary: {
    payments: number;
    expenses: number;
    documents: number;
    leaves: number;
    signatures: number;
    costs: number;
    approvals: number;
  };
  items: Array<{
    id: string;
    type: PendingActionType;
    typeLabel: string;           // "결제", "경비", "문서", "휴가", "서명", "원가", "승인"
    title: string;
    amount?: number;
    requester?: string;
    createdAt: string;
    urgency: 'high' | 'medium' | 'low';
    dealName?: string;
    canApprove: boolean;         // 현재 사용자가 승인 가능한지
    canBulkApprove: boolean;     // 일괄 승인 가능한지
  }>;
}
```

#### 4-5. 응답 UI 예시
```
┌─────────────────────────────────────────────────────────┐
│ ✅ 승인 대기 (7건)                                      │
│                                                         │
│ 결제 3건 · 경비 2건 · 문서 1건 · 휴가 1건              │
│                                                         │
│ 🔴 긴급                                                │
│ ├─ [결제] 외주비 A프로젝트  ₩2,800,000  김철수  3/6    │
│ │  [승인] [반려] [상세 →]                               │
│ └─ [결제] 서버 비용         ₩520,000    자동생성  3/5   │
│    [승인] [반려] [상세 →]                               │
│                                                         │
│ 🟡 보통                                                │
│ ├─ [경비] 회식비 청구       ₩180,000   박영희   3/6    │
│ │  [승인] [반려] [상세 →]                               │
│ ├─ [경비] 택시비            ₩35,000    이민수   3/7    │
│ │  [승인] [반려] [상세 →]                               │
│ ├─ [문서] 계약서 검토       -          김철수   3/5    │
│ │  [승인] [반려] [상세 →]                               │
│ └─ [원가] C프로젝트 디자인  ₩1,400,000 -       3/4    │
│    [승인] [반려] [상세 →]                               │
│                                                         │
│ 🟢 낮음                                                │
│ └─ [휴가] 연차 1일          -          박영희   3/7    │
│    [승인] [반려] [상세 →]                               │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [🔴 긴급 3건 일괄 승인]  [전체 일괄 승인]  [승인센터 ↗] │
└─────────────────────────────────────────────────────────┘
```

#### 4-6. 액션 버튼 (승인 버튼 포함)
| 버튼 | 타입 | 동작 | 레벨 |
|------|------|------|------|
| 승인 | L2 action | `approveAction(companyId, type, id, userId)` | L2 (즉시 실행 + 로그) |
| 반려 | L2 action | 해당 테이블 status='rejected' 업데이트 | L2 |
| 긴급 일괄 승인 | L2 action | `bulkApproveActions(companyId, urgencyItems, userId)` | L2 |
| 전체 일괄 승인 | **L3 action** | `ai_pending_actions`에 등록 → 2차 확인 | L3 (전체 일괄은 위험) |
| 상세 | navigate | 해당 엔티티 상세 페이지 | - |
| 승인센터 | navigate | `/approvals` | - |

#### 4-7. 에러 상태
| 상황 | 표시 |
|------|------|
| 대기 0건 | "승인 대기 건이 없습니다. 모든 결재가 처리되었습니다. 👏" |
| 승인 실패 | "승인 처리 중 오류가 발생했습니다. 승인센터에서 직접 처리해주세요." |
| 권한 없음 | "이 항목을 승인할 권한이 없습니다." |

#### 4-8. 역할별 차이
| 역할 | 동작 |
|------|------|
| owner | 전체 7개 소스의 모든 대기 건 + 승인/반려 가능 |
| admin | 본인이 승인 단계에 있는 건만 + 승인/반려 가능 |
| employee | 본인이 요청한 건의 상태만 조회 (승인 불가) |
| partner | 접근 불가 |

---

### 명령 5: "월말 모드로 바꿔줘"

#### 5-1. 입력 변형 (10개)
| # | 입력 예시 |
|---|-----------|
| 1 | 월말 모드로 바꿔줘 |
| 2 | 월말 마감 모드 |
| 3 | 마감 모드 |
| 4 | 월말 마감 시작 |
| 5 | 마감 체크리스트 보여줘 |
| 6 | 기본 모드로 돌려줘 |
| 7 | 위기 모드 |
| 8 | 영업 집중 모드 |
| 9 | 대시보드 뷰 바꿔줘 |
| 10 | 기본 뷰로 |

#### 5-2. 인텐트
```typescript
{ intent: 'switch_view', entities: { view: 'monthend' | 'crisis' | 'sales' | 'default' }, priority: 'low' }
```

**뷰 매핑**:
- "월말", "마감" → `monthend`
- "위기", "비상" → `crisis`
- "영업", "세일즈" → `sales`
- "기본", "원래", "돌려" → `default`

#### 5-3. 데이터 소스 & 쿼리
쿼리 불필요. 기존 `useBoard()` 컨텍스트의 `setActivePreset(presetId)` 호출만.

**기존 프리셋 정의 (widget-registry.ts)**:
| presetId | name | 표시 위젯 |
|----------|------|-----------|
| `default` | 기본 뷰 | cash_pulse, approval_center, today_actions, risk_zone, growth_tracking |
| `crisis` | 위기 모드 | cash_pulse, approval_center, today_actions, risk_zone |
| `monthend` | 월말 마감 | financial_overview, closing_checklist, automation_status, ai_insights |
| `sales` | 영업 집중 | growth_tracking, risk_zone, today_actions, approval_center |

#### 5-4. 응답 데이터 구조
```typescript
interface SwitchViewResponse {
  type: 'switch_view';
  fromView: string;             // 이전 뷰
  toView: string;               // 전환할 뷰
  viewName: string;             // "월말 마감"
  widgets: string[];            // 표시될 위젯 목록
  confirmation: string;         // "월말 마감 모드로 전환했습니다."
}
```

#### 5-5. 응답 UI 예시
```
┌─────────────────────────────────────────────────────────┐
│ 🔄 뷰 전환 완료                                        │
│                                                         │
│ "월말 마감 모드로 전환했습니다."                          │
│                                                         │
│ 표시 위젯:                                              │
│ ✅ 재무 현황    ✅ 월 마감 체크리스트                    │
│ ✅ 자동화 엔진  ✅ AI 인사이트                          │
│                                                         │
│ 숨김 위젯:                                              │
│ ○ 현금 펄스  ○ 승인센터  ○ 오늘의 액션                 │
│ ○ 위험 구역  ○ 성장 영역                               │
├─────────────────────────────────────────────────────────┤
│ [기본 뷰로 돌아가기]  [위젯 직접 편집]                   │
└─────────────────────────────────────────────────────────┘
```

#### 5-6. 액션 버튼
| 버튼 | 타입 | 동작 |
|------|------|------|
| 기본 뷰로 돌아가기 | client action | `setActivePreset('default')` |
| 위젯 직접 편집 | client action | `setEditMode(true)` |

#### 5-7. 에러 상태
| 상황 | 표시 |
|------|------|
| 이미 해당 뷰 | "이미 월말 마감 모드입니다." |
| 뷰 이름 파싱 실패 | "어떤 뷰로 전환할까요?" + 4개 버튼 (기본/위기/월말/영업) |

#### 5-8. 역할별 차이
| 역할 | 동작 |
|------|------|
| owner | 4개 프리셋 전체 사용 가능 |
| admin | 4개 프리셋 전체 사용 가능 |
| employee | 뷰 전환 불가 (대시보드가 다름) |
| partner | 뷰 전환 불가 |

---

## 2. 자유 입력 → Intent 매핑 구조

### 2-1. 아키텍처

```
사용자 입력 (한글 자연어)
    │
    ▼
┌─────────────────┐
│  intent-parser   │  ← 새 파일: src/lib/intent-parser.ts
│  (키워드 매칭)    │     순수 함수, 외부 API 없음
└────────┬────────┘
         │ ParsedIntent
         ▼
┌─────────────────┐
│ command-router   │  ← 새 파일: src/lib/command-router.ts
│ (인텐트→데이터)   │     쿼리 조합 + 엔진 실행
└────────┬────────┘
         │ CommandResult
         ▼
┌─────────────────┐
│  ResponseCard    │  ← 새 컴포넌트: src/components/response-card.tsx
│  (카드형 UI)     │     type별 렌더링 분기
└─────────────────┘
```

### 2-2. Intent 목록 (MVP 5개 + 확장 5개)

| # | intent | 키워드 | 레벨 | 구현 |
|---|--------|--------|------|------|
| 1 | `risk_overview` | 위험, 리스크, 경고, 문제, 주의, 경보 | L1 | MVP |
| 2 | `weekly_outflow` | 나갈 돈, 지출, 결제, 비용, 출금 + 이번 주/다음 주/이번 달 | L1 | MVP |
| 3 | `ar_overview` | 미수금, 받을 돈, 수금, AR, 매출채권, 연체 | L1 | MVP |
| 4 | `pending_approvals` | 승인, 결재, 대기, 처리, 승인 큐 | L1+L2 | MVP |
| 5 | `switch_view` | 모드, 뷰, 월말, 위기, 영업, 기본, 마감 | Client | MVP |
| 6 | `cash_forecast` | 현금, 잔고, 예측, 펄스, 생존, 런웨이 | L1 | Phase 2 |
| 7 | `deal_status` | 딜, 프로젝트, 진행, 계약 + 딜 이름 | L1 | Phase 2 |
| 8 | `employee_status` | 직원, 출근, 근태, 급여, 인원 | L1 | Phase 2 |
| 9 | `search_entity` | 찾아, 검색, 어디, 누구 | L1 | Phase 2 |
| 10 | `dashboard_summary` | 요약, 전체, 현황, 종합 | L1 | Phase 2 |

### 2-3. intent-parser.ts 설계

```typescript
// src/lib/intent-parser.ts

interface ParsedIntent {
  intent: string;               // 'risk_overview' | 'weekly_outflow' | ...
  confidence: number;           // 0~1 (키워드 매칭 점수)
  entities: Record<string, string>;  // { period: 'this_week', sort: 'amount_desc', ... }
  originalInput: string;
}

interface IntentRule {
  intent: string;
  keywords: string[];           // 1차 키워드 (하나만 매칭되면 후보)
  boosters: string[];           // 2차 키워드 (추가 매칭 시 confidence 증가)
  entityExtractors: Record<string, (input: string) => string | null>;
}

// 매칭 알고리즘:
// 1. 입력을 한글 형태소 단위로 분리 (간이: 공백 + 조사 제거)
// 2. 각 IntentRule의 keywords와 매칭 → 점수 부여
// 3. 최고 점수 인텐트 선택 (동점 시 첫 번째)
// 4. entityExtractors 실행하여 entities 추출
// 5. confidence < 0.3이면 'unknown' 반환

export function parseIntent(input: string): ParsedIntent;

// 한글 조사 제거 유틸
function removeParticles(text: string): string;
// "보여줘", "알려줘", "해줘" 등 요청 어미 정규화
function normalizeRequest(text: string): string;
// 기간 파싱: "이번 주" → {start, end}
function parsePeriod(text: string): { start: string; end: string } | null;
```

**한글 조사 제거 패턴**:
```
은/는/이/가/을/를/에/에서/으로/로/과/와/의/도/만/까지/부터/에게/한테/께
```

**요청 어미 정규화**:
```
보여줘/보여/알려줘/알려/해줘/해/보자/볼까/있어?/뭐야/뭐가/어때
→ 모두 제거 후 핵심 키워드만 추출
```

### 2-4. command-router.ts 설계

```typescript
// src/lib/command-router.ts

type CommandResult =
  | RiskOverviewResponse
  | WeeklyOutflowResponse
  | AROverviewResponse
  | PendingApprovalsResponse
  | SwitchViewResponse
  | UnknownCommandResponse;

interface CommandContext {
  companyId: string;
  userId: string;
  role: 'owner' | 'admin' | 'employee' | 'partner';
}

// 인텐트별 핸들러 맵
const handlers: Record<string, (ctx: CommandContext, entities: Record<string, string>) => Promise<CommandResult>> = {
  risk_overview: handleRiskOverview,
  weekly_outflow: handleWeeklyOutflow,
  ar_overview: handleAROverview,
  pending_approvals: handlePendingApprovals,
  switch_view: handleSwitchView,
};

export async function executeCommand(
  intent: ParsedIntent,
  context: CommandContext
): Promise<CommandResult>;

// 각 핸들러는 기존 queries.ts + engines.ts 함수를 조합
// 새 DB 쿼리는 최소화 (기존 함수 재사용 우선)
```

### 2-5. Unknown 처리

```typescript
interface UnknownCommandResponse {
  type: 'unknown';
  originalInput: string;
  suggestions: Array<{
    label: string;              // "위험 현황 보기"
    command: string;            // "오늘 뭐가 위험해?"
  }>;
  message: string;              // "이해하지 못했습니다. 이런 것들을 물어보실 수 있어요:"
}
```

추천 목록은 항상 MVP 5개 명령 중 상위 3개를 표시.

---

## 3. 응답 UI 공통 구조

### 3-1. ResponseCard 컴포넌트

```typescript
// src/components/response-card.tsx

interface ResponseCardProps {
  result: CommandResult;
  onAction: (action: CardAction) => void;
  onDismiss: () => void;
}

// 공통 구조:
// ┌── Header (아이콘 + 제목 + 요약 수치) ──┐
// │                                          │
// │── Body (type별 다른 레이아웃) ──         │
// │                                          │
// │── Footer (액션 버튼들) ──                │
// └──────────────────────────────────────────┘
```

### 3-2. 공통 디자인 규칙

| 항목 | 규칙 |
|------|------|
| 카드 배경 | `bg-[var(--bg-card)]` |
| 카드 테두리 | `border border-[var(--border)] rounded-xl` |
| 그림자 | `shadow-sm` |
| 헤더 | 왼쪽: 아이콘+제목, 오른쪽: 핵심 수치 (bold) |
| 금액 표시 | `₩` + 3자리 콤마, 만원 단위는 "만" 표시 |
| 날짜 표시 | "3/7 (금)" 형태 |
| 긴급도 색상 | 🔴 high=`var(--danger)`, 🟡 medium=`var(--warning)`, 🟢 low=`var(--success)` |
| 액션 버튼 | `text-sm px-3 py-1.5 rounded-lg` |
| 승인 버튼 | 파란색 `bg-[var(--primary)]`, 반려=회색 `bg-[var(--bg-surface)]` |
| 접기/펼치기 | 5개 이상 항목은 접기, "더보기" 토글 |
| 닫기 | 우상단 × 버튼 → 카드 제거 (히스토리에 보관) |
| 반응형 | 모바일: 전체 너비, 데스크톱: max-w-2xl |

### 3-3. 카드 애니메이션

- 등장: `animate-in slide-up 300ms`
- 퇴장: `animate-out fade-out 200ms`
- 로딩: 스켈레톤 (3줄 펄스)

### 3-4. 히스토리

- 최근 10개 카드 응답을 메모리에 보관
- 입력창 아래에 "최근 질문" 칩으로 표시
- 칩 클릭 시 동일 명령 재실행

---

## 4. 데이터 연결 범위

### 4-1. 구현 완료된 데이터 (바로 사용 가능)

| 데이터 | 쿼리 함수 | 엔진 | 테이블 |
|--------|-----------|------|--------|
| 통장 잔고 | `getBankAccounts` | - | bank_accounts |
| 현금 예측 (D+7~90) | `getCashPulseData` | `buildCashPulse` | 8개 테이블 |
| 펄스 점수 (0-100) | `getCashPulseData` | `buildCashPulse` | 동일 |
| 생존 개월 | `getSurvivalData` | `calcRunwayMonths` | 7개 테이블 |
| 위험 감지 (4종) | `getFounderData` | `detectRisks` | deals, financial_items |
| 승인 대기 (7소스) | `getCEOPendingActions` | - | 7개 테이블 |
| 승인 실행 | `approveAction` | - | 각 테이블 |
| 일괄 승인 | `bulkApproveActions` | - | 각 테이블 |
| 결제 큐 | `getPaymentQueue` | - | payment_queue |
| 고정비 | `getRecurringPayments` | - | recurring_payments |
| 급여 총합 | `getMonthlyTotalSalary` | - | employees |
| 딜 목록/상세 | `getDeals`, `getDealWithNodes` | - | deals, deal_nodes |
| 미수금 (매칭) | `getDealMatchingStatuses` | - | 4개 테이블 |
| 재무 항목 | `getFounderData` | `buildFounderDashboard` | monthly_financials, financial_items |
| 마감 체크리스트 | 직접 쿼리 | - | closing_checklists, closing_checklist_items |
| 자동화 실행 | `runAllAutomation` | 15개 엔진 | 다수 |
| 위젯 프리셋 | `getDefaultWidgets` | - | (client-side) |
| 세금계산서 | `getTaxInvoices` | - | tax_invoices |
| 거래 매칭 | `autoExecuteThreeWayMatch` | - | transaction_matches |
| 문서 목록 | `getDocuments` | - | documents |
| 채팅 | `getChannels`, `getMessages` | - | chat_channels, chat_messages |
| 직원/HR | 직접 쿼리 | - | employees, attendance_records, leave_requests |

### 4-2. 새로 작성 필요한 쿼리/함수

| 함수 | 용도 | 난이도 | 명령 |
|------|------|--------|------|
| `getWeeklyOutflow(companyId, start, end)` | 주간 지출 예정 합산 | 중 | 명령2 |
| `getReceivablesDetail(companyId)` | 미수금 상세 + 연체일 | 중 | 명령3 |
| `parseIntent(input)` | 한글 인텐트 파싱 | 중 | 전체 |
| `executeCommand(intent, ctx)` | 명령 라우팅 | 저 | 전체 |

### 4-3. 미구현 데이터 (Phase 2+)

| 데이터 | 필요한 작업 | 연결 명령 |
|--------|-------------|-----------|
| 캘린더 뷰 | 캘린더 페이지 구현 | 명령2 (캘린더로 보기) |
| 독촉 메시지 생성 | 템플릿 엔진 | 명령3 (독촉 메시지) |
| 엑셀 다운로드 | CSV 생성 유틸 | 명령3 |
| AI 요약 (LLM) | OpenAI/Claude API 연동 | Phase 3 |
| 음성 입력 | Web Speech API | Phase 3 |

---

## 5. 구현 우선순위

### Phase 1: MVP 루프 (1일)

**목표**: 입력창 + 5개 명령 + 카드 응답이 동작하는 최소 루프

| 순서 | 파일 | 작업 | 시간 |
|------|------|------|------|
| 1 | `src/lib/intent-parser.ts` | **신규** — 키워드 매칭 엔진 | 1h |
| 2 | `src/lib/command-queries.ts` | **신규** — getWeeklyOutflow, getReceivablesDetail | 1h |
| 3 | `src/lib/command-router.ts` | **신규** — 5개 핸들러 (기존 쿼리 조합) | 2h |
| 4 | `src/components/response-card.tsx` | **신규** — 5개 타입별 카드 UI | 2h |
| 5 | `src/components/command-input.tsx` | **신규** — 입력창 + 히스토리 칩 | 1h |
| 6 | `src/app/(app)/dashboard/page.tsx` | **수정** — 코어 바 위에 CommandInput 배치 | 0.5h |

**건드리는 기존 파일**: dashboard/page.tsx 1개만 (import + JSX 1줄 추가)
**새 파일**: 5개
**기존 파일 수정 범위**: ~5줄

### Phase 2: 확장 명령 + 정교화 (2-3일)

| 작업 | 설명 |
|------|------|
| 명령 6-10 추가 | cash_forecast, deal_status, employee_status, search_entity, dashboard_summary |
| 엔티티 추출 강화 | 딜 이름 매칭, 직원 이름 매칭, 날짜 범위 파싱 |
| 액션 실행 | 승인/반려 버튼 → approveAction 호출 |
| 뷰 전환 연동 | switch_view → useBoard().setActivePreset() |
| 모바일 최적화 | 바텀시트 카드, 터치 제스처 |
| 키보드 단축키 | Cmd+K → 입력창 포커스 |

### Phase 3: AI 연동 (이후)

| 작업 | 설명 |
|------|------|
| LLM Fallback | 키워드 매칭 실패 시 → Claude API로 인텐트 추출 |
| 자연어 요약 | 카드 하단에 AI 1줄 요약 |
| 대화 컨텍스트 | 이전 질문 기반 후속 질문 처리 ("그 중에 가장 큰 거는?") |
| 프로액티브 알림 | "잔고가 2주 내 마이너스 예상입니다" 자동 푸시 |

---

## 6. 파일 구조 정리

```
src/
├── lib/
│   ├── intent-parser.ts      ← 신규: 한글 키워드 → 인텐트 매핑
│   ├── command-router.ts     ← 신규: 인텐트 → 쿼리 조합 → 결과
│   ├── command-queries.ts    ← 신규: 명령 전용 쿼리 (2개)
│   ├── queries.ts            ← 기존 (수정 없음)
│   ├── engines.ts            ← 기존 (수정 없음)
│   ├── cash-pulse.ts         ← 기존 (수정 없음)
│   ├── approval-center.ts    ← 기존 (수정 없음)
│   └── automation.ts         ← 기존 (수정 없음)
├── components/
│   ├── command-input.tsx     ← 신규: 대화형 입력창
│   ├── response-card.tsx     ← 신규: 카드형 응답 UI
│   └── ... (기존 컴포넌트 수정 없음)
├── app/(app)/
│   └── dashboard/
│       └── page.tsx          ← 수정: CommandInput 1줄 추가
└── types/
    └── commands.ts           ← 신규: 명령/응답 타입 정의
```

---

## 부록 A: Intent 키워드 사전

```typescript
const INTENT_RULES: IntentRule[] = [
  {
    intent: 'risk_overview',
    keywords: ['위험', '리스크', '경고', '문제', '주의', '경보', '위기', '빨간'],
    boosters: ['오늘', '현황', '있어', '뭐가', '어떤'],
    entityExtractors: {},
  },
  {
    intent: 'weekly_outflow',
    keywords: ['나갈', '지출', '결제', '비용', '출금', '내야', '돈'],
    boosters: ['이번', '다음', '주', '달', '오늘', '내일', '예정'],
    entityExtractors: {
      period: parsePeriod,  // "이번 주" → {start, end}
    },
  },
  {
    intent: 'ar_overview',
    keywords: ['미수금', '받을', '수금', 'AR', '매출채권', '연체', '안 들어온'],
    boosters: ['큰', '순서', '현황', '정리', '얼마'],
    entityExtractors: {
      sort: parseSortOrder,  // "큰 순서" → 'amount_desc'
    },
  },
  {
    intent: 'pending_approvals',
    keywords: ['승인', '결재', '대기', '처리', '승인 큐'],
    boosters: ['오늘', '목록', '뭐', '있어', '해야'],
    entityExtractors: {},
  },
  {
    intent: 'switch_view',
    keywords: ['모드', '뷰', '전환', '바꿔', '변경'],
    boosters: ['월말', '마감', '위기', '영업', '기본', '원래', '돌려'],
    entityExtractors: {
      view: parseViewName,  // "월말" → 'monthend'
    },
  },
];
```

---

## 부록 B: 기존 AI 페이지와의 관계

| 항목 | 기존 AI 페이지 (/ai) | 새 대화형 OS (대시보드) |
|------|----------------------|------------------------|
| 위치 | 별도 페이지 | 대시보드 상단 임베드 |
| 입력 | 채팅 형태 (왼/오 말풍선) | 검색창 형태 (한 줄) |
| 응답 | 텍스트 + JSON 테이블 | 구조화된 카드 UI |
| 히스토리 | DB 저장 (ai_interactions) | 메모리 (10개) |
| L2/L3 | ai_pending_actions 테이블 | 카드 내 인라인 승인 버튼 |
| 병행 | 유지 (파워유저용) | 메인 진입점 |

**공존 전략**: 기존 /ai 페이지는 그대로 유지. 대시보드 대화형은 "빠른 5개 명령"에 집중. 복잡한 쿼리나 L3 액션은 기존 /ai 페이지로 안내.

---

## 부록 C: 역할별 접근 매트릭스

| 명령 | owner | admin | employee | partner |
|------|-------|-------|----------|---------|
| risk_overview | ✅ 전체 | ✅ 전체 | ❌ | ❌ |
| weekly_outflow | ✅ 전체+잔고 | ✅ 전체 | ⚠️ 본인분만 | ❌ |
| ar_overview | ✅ 전체 | ✅ 전체 | ❌ | ⚠️ 본인 딜만 |
| pending_approvals | ✅ 전체+승인 | ✅ 담당분+승인 | ⚠️ 조회만 | ❌ |
| switch_view | ✅ 4개 뷰 | ✅ 4개 뷰 | ❌ | ❌ |

---

## 부록 D: 성능 기준

| 지표 | 목표 |
|------|------|
| 인텐트 파싱 | < 5ms (순수 JS, 동기) |
| 쿼리 실행 | < 500ms (기존 쿼리 재사용, Supabase 직접) |
| 카드 렌더링 | < 100ms (React, 로컬 state) |
| 전체 응답 (입력→카드) | < 800ms |
| 번들 크기 증가 | < 15KB (intent-parser + command-router) |

---

*이 명세서는 내일 아침 9시 의사결정용입니다. 명령 5개의 상세 스펙, 인텐트 파싱 구조, UI 규칙, 구현 우선순위가 모두 포함되어 있으며, 바로 코딩을 시작할 수 있는 수준입니다.*
