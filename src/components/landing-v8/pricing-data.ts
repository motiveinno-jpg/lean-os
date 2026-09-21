// /pricing 요금 자료 — 원본은 DB `subscription_plans` (2026-09-14, 결정 229 보강)
//
//   전에는 요금 문구가 세 벌이었다: DB features · 옛 랜딩 PLANS/MATRIX · v8 PRICING.
//   셋이 조금씩 달랐다(예: v8 「저장공간 인원당 10GB」 ↔ DB·결제 코드 「추가 1명당 10GB」).
//   이제 /pricing 은 DB 를 읽는다 → 요금제를 DB 에서 바꾸면 랜딩도 따라온다.
//   · 비로그인 읽기 = RLS "Anyone can read active plans"(is_active = true)
//   · PLAN_FALLBACK 은 DB 를 못 읽었을 때만 쓴다(빌드 중 DB 장애 등). 2026-09-14 운영 DB 값을 그대로 옮겼다.
//     ⚠️ 요금제를 DB 에서 바꾸면 이 값도 맞춰 둔다 — 안 맞추면 장애 때만 옛 값이 보인다.

export type PlanRow = {
  slug: string;
  name: string;
  base_price: number;
  /** 정상가(취소선) — 실제 청구는 base_price. null 이면 취소선 없음 */
  list_price: number | null;
  per_seat_price: number;
  included_seats: number;
  max_seats: number | null;
  features: string[];
  monthly_tax_invoice_limit: number | null;
  monthly_cashbill_limit: number | null;
  monthly_contract_limit: number | null;
  monthly_ai_token_limit: number | null;
  included_storage_bytes: number;
  storage_per_unit_bytes: number;
  annual_discount: string | number | null;
  sort_order: number | null;
};

export const PLAN_COLUMNS =
  "slug, name, base_price, list_price, per_seat_price, included_seats, max_seats, features, monthly_tax_invoice_limit, monthly_cashbill_limit, monthly_contract_limit, monthly_ai_token_limit, included_storage_bytes, storage_per_unit_bytes, annual_discount, sort_order";

export const PLAN_FALLBACK: PlanRow[] = [
  {
    slug: "free", name: "무료", base_price: 0, list_price: null, per_seat_price: 0, included_seats: 5, max_seats: 5,
    features: [
      "구성원 5명", "저장공간 500MB", "결재 허브·근태·급여·프로젝트·게시판·파일보관함 무제한",
      "세금계산서 발행 월 5건 · 현금영수증 발행 월 5건", "전자계약 월 5건", "AI 대표 참모 월 10만 토큰",
      "통장·카드 3개까지 연결 · 하루 2회 자동 동기화", "AI 브리핑은 기본형(요약 규칙)",
    ],
    monthly_tax_invoice_limit: 5, monthly_cashbill_limit: 5, monthly_contract_limit: 5, monthly_ai_token_limit: 100000,
    included_storage_bytes: 524288000, storage_per_unit_bytes: 10737418240, annual_discount: "0.10", sort_order: 0,
  },
  {
    slug: "standard", name: "오너뷰", base_price: 39000, list_price: 80000, per_seat_price: 5000, included_seats: 5, max_seats: null,
    features: [
      "기본 5명 포함 · 추가 1명당 ₩5,000/월", "저장공간 500MB + 추가 1명당 10GB · 저장공간 팩(+10GB) ₩5,000/월",
      "세금계산서 발행 월 100건 · 현금영수증 발행 월 100건", "전자계약(서명) 무제한",
      "통장·카드 무제한 연결 · 하루 2회 자동 + 필요할 때 즉시 동기화", "홈택스 수집(무제한) · 부가세 자료 정리",
      "AI 대표 참모 월 50만 토큰", "AI 브리핑(매일 자동 분석)", "결재 허브·근태·급여·프로젝트 전 기능 무제한",
    ],
    monthly_tax_invoice_limit: 100, monthly_cashbill_limit: 100, monthly_contract_limit: null, monthly_ai_token_limit: 500000,
    included_storage_bytes: 524288000, storage_per_unit_bytes: 10737418240, annual_discount: "0.10", sort_order: 1,
  },
];

/* 표시용 — 숫자는 전부 PlanRow 에서 만든다 */
export const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
export const perMonth = (n: number | null, unit: string) => (n === null ? "무제한" : `월 ${n.toLocaleString("ko-KR")}${unit}`);
export const tokens = (n: number | null) => (n === null ? "무제한" : `월 ${n >= 10000 ? `${n / 10000}만` : n.toLocaleString("ko-KR")} 토큰`);
export const bytes = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)}GB` : `${Math.round(n / 1024 ** 2)}MB`);
export const discountPct = (p: PlanRow) => Math.round(Number(p.annual_discount || 0) * 100);
