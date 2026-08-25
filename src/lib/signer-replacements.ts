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
