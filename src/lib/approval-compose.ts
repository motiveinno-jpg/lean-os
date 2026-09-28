// 결재 요청 내용 만들기 — 새 요청과 수정 저장이 **같은 함수**로 제목·본문·금액·필수 검사를 만든다.
//   종전엔 두 경로가 따로 계산해서, 새 요청에만 있던 규칙이 수정에서 빠졌다:
//     · 광고비 지출결의서 제목 뒤 업체명 — 업체명을 수정으로 채우면 제목에 안 붙었다
//     · 필수(*) 칸 검사 — 수정에선 필수 칸을 지워도 저장됐다
//     · 경비 양식 금액 0 금지 — 수정에선 0 으로 바꿀 수 있었다
//   규칙을 더할 땐 여기에만 더한다. 화면(approvals/page.tsx)은 이 결과를 쓰기만 한다.
import { titleWithAdVendor, type ApprovalFormField } from "@/lib/approval-forms";

// ── 본문 HTML 도구 (RichEditor 로 쓴 결재 내용) ──
export const isHtmlDesc = (s?: string | null) => !!s && /^\s*</.test(String(s).trim());

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 평문(템플릿 등) → RichEditor 초기값 HTML. 이미 HTML 이면 그대로. */
export function plainToHtml(text: string): string {
  if (!text) return "";
  if (isHtmlDesc(text)) return text;
  return text.split("\n").map((line) => (line.trim() === "" ? "<p><br/></p>" : `<p>${escapeHtmlText(line)}</p>`)).join("");
}

/** RichEditor 빈 문서(<p></p>  등) 판별 · 텍스트·이미지·표 전부 없으면 빈 것으로 취급 */
export function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  if (/<(img|table)/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

const parseAmount = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;

export type ComposedRequest = {
  title: string;
  /** 양식 필드 줄(<p>라벨: 값</p>) + 본문 */
  description: string;
  /** 양식에 금액 필드가 있으면 그 값, 없으면 null(호출하는 쪽이 정한다) */
  amount: number | null;
  /** 비어 있는 필수 칸 이름 — 하나라도 있으면 저장하지 않는다 */
  missing: string[];
};

export function composeFormRequest(input: {
  formName: string | null | undefined;
  fields: Pick<ApprovalFormField, "key" | "label" | "type" | "required">[];
  values: Record<string, string>;
  title: string;
  /** RichEditor HTML 또는 평문 */
  body: string;
  /** 수정 전 업체명 — 제목 끝의 옛 업체명을 갈아 끼울 때 */
  prevVendor?: string;
  /** 경비 양식 — 금액이 0 이면 전표를 만들 수 없어 막는다 */
  isExpense?: boolean;
}): ComposedRequest {
  const { fields, values } = input;
  const bodyHtml = isEmptyHtml(input.body) ? "" : plainToHtml(input.body);
  const fieldHtml = fields.map((fd) => `<p>${escapeHtmlText(`${fd.label}: ${values[fd.key] || ""}`)}</p>`).join("");
  const amountField = fields.find((fd) => fd.type === "amount");
  const amount = amountField ? parseAmount(values[amountField.key]) : null;
  const missing = fields
    .filter((fd) => fd.required && fd.type !== "fixed" && !String(values[fd.key] ?? "").trim())
    .map((fd) => String(fd.label || fd.key));
  if (input.isExpense && !(Number(amount) > 0)) missing.push(amountField ? String(amountField.label) : "금액");
  return {
    title: titleWithAdVendor(input.formName, fields, values, input.title, input.prevVendor),
    description: fieldHtml + bodyHtml,
    amount,
    missing,
  };
}

// ── 휴가 요청 수정 — 날짜·종류는 연차 차감에 쓰이는 구조화 데이터(custom_fields.leave)가 기준이라
//   글자로 고치게 두면 본문과 실제 차감 날짜가 어긋난다. 수정에서는 '사유'만 바꾸게 한다. ──
const REASON_MARK = "\n사유:\n";

/** 휴가 본문을 [자동 생성 부분, 사유]로 나눈다. 사유 표시가 없는 옛 본문은 전부 자동 생성 부분으로 본다. */
export function splitLeaveReason(description: string): { fixed: string; reason: string; hasMark: boolean } {
  const d = String(description || "");
  const i = d.lastIndexOf(REASON_MARK);
  if (i < 0) return { fixed: d, reason: "", hasMark: false };
  return { fixed: d.slice(0, i), reason: d.slice(i + REASON_MARK.length), hasMark: true };
}

/** 자동 생성 부분은 그대로 두고 사유만 바꿔 다시 붙인다. */
export function joinLeaveReason(parts: { fixed: string; hasMark: boolean }, reason: string): string {
  const r = reason.trim();
  if (!parts.hasMark && !r) return parts.fixed;
  return `${parts.fixed}${REASON_MARK}${r}`;
}
