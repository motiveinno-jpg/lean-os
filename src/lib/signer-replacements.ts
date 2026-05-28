// 2026-05-28 서명·문서 토큰 매핑 헬퍼.
//   sign 페이지 fillBody 매핑과 문서 미리보기(/documents 테스트) 가 공유.
//   - 본문 토큰({{단체명}}, {{갑_회사명}} ...) 을 회사(갑) · 거래처(을) 데이터로 채움.
//   - 매핑 없는 토큰은 원형 유지 (오타 발견용).
//   - ?-prefix 토큰(?라디오:..., ?텍스트:...) 은 서명자 입력 — 변수 치환 대상 아님(원형 유지).

import { normalizeVariableTokens, type PartnerVarColumn } from "./signatures";

export type CompanyLike = {
  name?: string | null;
  business_number?: string | null;
  representative?: string | null;
  address?: string | null;
};

export type PartnerLike = {
  name?: string | null;
  business_number?: string | null;
  representative?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
};

// 회사(갑) · 거래처(을) 데이터 → 토큰 치환 테이블.
//   sign/page.tsx 의 fillBody 매핑과 동일(소스 1곳 공유).
export function buildPartnerReplacements(
  company: CompanyLike | null | undefined,
  partner: PartnerLike | null | undefined,
): Record<string, string> {
  const c = company || {};
  const pn = partner || {};
  const today = new Date().toLocaleDateString("ko-KR");
  return {
    // ─── 갑(우리 회사) — 명시 접두사 ───
    "갑_회사명": String(c.name || ""),
    "갑_사업자번호": String(c.business_number || ""),
    "갑_대표자": String(c.representative || ""),
    "갑_주소": String(c.address || ""),
    "company_name": String(c.name || ""),
    // ─── 을(거래처) — 명시 접두사 ───
    "을_회사명": String(pn.name || ""),
    "을_단체명": String(pn.name || ""),
    "을_사업자번호": String(pn.business_number || ""),
    "을_대표자": String(pn.representative || ""),
    "을_담당자": String(pn.contact_name || ""),
    "을_이메일": String(pn.contact_email || ""),
    "을_연락처": String(pn.contact_phone || ""),
    "을_전화": String(pn.contact_phone || ""),
    "을_주소": String(pn.address || ""),
    "partner_name": String(pn.name || ""),
    // ─── 단독 토큰 (사용자 자유 양식) ───
    "갑": String(c.name || ""),
    "을": String(pn.name || ""),
    // 갑/을 구분 없는 단독 토큰 — 을(거래처) 우선 매핑
    "회사명": String(pn.name || ""),
    "단체명": String(pn.name || ""),
    "사업자등록번호": String(pn.business_number || c.business_number || ""),
    "사업자번호": String(pn.business_number || c.business_number || ""),
    "대표자명": String(pn.representative || c.representative || ""),
    "대표자": String(pn.representative || c.representative || ""),
    "주소": String(pn.address || c.address || ""),
    "담당자": String(pn.contact_name || ""),
    "이메일": String(pn.contact_email || ""),
    "연락처": String(pn.contact_phone || ""),
    "전화": String(pn.contact_phone || ""),
    "전화번호": String(pn.contact_phone || ""),
    "휴대폰": String(pn.contact_phone || ""),
    "핸드폰": String(pn.contact_phone || ""),
    "휴대전화": String(pn.contact_phone || ""),
    // 공통값
    "날짜": today,
    "오늘": today,
    "계약일": today,
  };
}

// 본문 토큰 치환. replacements 에 키 있으면 값으로, 없으면 원형 유지.
// ?-prefix 토큰은 항상 원형 유지(서명자 입력).
// 정규식: {{...}} 또는 {...} (sign/page.tsx 와 동일 — RichEditor 변종 흡수).
export function applyTokenReplacements(body: string, replacements: Record<string, string>): string {
  return body.replace(/\{\{?\s*([^}{\s]+?)\s*\}\}?/g, (full, key: string) => {
    const k = String(key).trim();
    if (k.startsWith("?라디오") || k.startsWith("?텍스트")) return full;
    if (k in replacements) return replacements[k];
    return full;
  });
}

// ============================================================================
// 토큰 추출 + 자동매핑 (signatures/page.tsx 인라인을 lib 로 승격, 미리보기와 공유)

export const PARTNER_COLUMN_LABELS: Record<PartnerVarColumn, string> = {
  name: "단체명",
  representative: "대표자",
  contact_name: "담당자",
  contact_email: "담당자 이메일",
  contact_phone: "담당자 연락처",
  business_number: "사업자번호",
  address: "주소",
};

// 토큰 이름 → partners 컬럼 자동매핑. 매핑 안 되면 null(직접 입력만).
export function autoMapToken(token: string): PartnerVarColumn | null {
  const t = token.replace(/\s+/g, "").toLowerCase();
  // 갑(甲) 측 = 우리 회사 → 회사 설정에서 자동 채움. 자동매핑 X.
  if (/^(갑|甲|our|us|company)[_-]/i.test(t)) return null;
  const body = t.replace(/^(을|乙|partner|client|customer|counterparty)[_-]/i, "");
  if (/(단체명|회사명|업체명|상호|법인명|partnername|companyname|name)/i.test(body)) return "name";
  if (/(대표자|대표|representative|ceo)/i.test(body)) return "representative";
  if (/(담당자|담당|contactname)/i.test(body) && !/이메일|email/i.test(body)) return "contact_name";
  if (/(이메일|메일|email|mail)/i.test(body)) return "contact_email";
  if (/(사업자번호|사업자등록번호|businessnumber|brn)/i.test(body)) return "business_number";
  if (/(연락처|전화|휴대폰|핸드폰|phone|tel|mobile)/i.test(body)) return "contact_phone";
  if (/(주소|소재지|사업장|address|addr)/i.test(body)) return "address";
  return null;
}

// 본문(들)에서 일반 {{토큰}} 추출. ?-prefix 토큰은 제외.
export function extractTokens(...sources: unknown[]): string[] {
  const seen = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  for (const src of sources) {
    let s: string;
    if (src == null) continue;
    if (typeof src === "string") s = src;
    else {
      try { s = JSON.stringify(src); } catch { continue; }
    }
    s = normalizeVariableTokens(s);
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const name = m[1].trim();
      if (!name) continue;
      if (name.startsWith("?라디오") || name.startsWith("?텍스트")) continue;
      seen.add(name);
    }
  }
  return Array.from(seen);
}
