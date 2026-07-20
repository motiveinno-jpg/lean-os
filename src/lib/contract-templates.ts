// L 견적/계약 — 계약서 양식 카탈로그 lib
//
// DB: public.contract_templates (마이그 20260521030000).
//   is_system=true 는 시스템 전역 양식 (3종 seed: service/supply/consulting).
//   is_system=false 는 회사별 자체 양식 (admin 만 CRUD).
//
// RLS:
//   SELECT  = is_system OR company_id=get_my_company_id()
//   WRITE   = is_company_admin() + company_id=get_my_company_id()
//
// 호출자:
//   - C: contract-templates-manager.tsx (settings 회사 자체 양식 관리)
//   - D: project-quote-stages.tsx (contract stage 양식 선택 + 변수 치환 후 발송)
//   - E: /quote/[token] 외부 페이지는 payload.template_snapshot_html 그대로 렌더 (lib 미사용)

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export interface ContractTemplate {
  id: string;
  company_id: string | null;
  name: string;
  code: string | null;
  body_html: string | null;
  body_markdown: string | null;
  variables: string[];
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  file_url: string | null;
  file_type: "html" | "markdown" | "pdf";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

/** 시스템 양식 + 본인 회사 양식 통합 fetch (sort_order ASC, 시스템 먼저). */
export async function listContractTemplates(companyId: string): Promise<ContractTemplate[]> {
  const { data, error } = await db
    .from("contract_templates")
    .select("id, company_id, name, code, body_html, body_markdown, variables, is_system, is_active, sort_order, file_url, file_type, created_by, created_at, updated_at")
    // RLS 가 is_system + 회사 격리 — OR 필터 불필요
    .order("is_system", { ascending: false })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return ((data || []) as unknown as ContractTemplate[]).filter((t: ContractTemplate) => t.is_active);
}

export async function createContractTemplate(params: {
  companyId: string;
  name: string;
  bodyHtml?: string | null;
  bodyMarkdown?: string | null;
  fileUrl?: string | null;
  fileType?: "html" | "markdown" | "pdf";
  variables?: string[];
  sortOrder?: number;
}): Promise<ContractTemplate> {
  const vars = params.variables ?? extractVariables(params.bodyHtml || params.bodyMarkdown || "");
  const insertRow = {
    company_id: params.companyId,
    name: params.name.trim(),
    body_html: params.bodyHtml ?? null,
    body_markdown: params.bodyMarkdown ?? null,
    file_url: params.fileUrl ?? null,
    file_type: params.fileType ?? (params.fileUrl ? "pdf" : "html"),
    variables: vars,
    sort_order: params.sortOrder ?? 100,
    is_system: false,
  };
  const { data, error } = await db
    .from("contract_templates")
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as ContractTemplate;
}

export async function updateContractTemplate(id: string, patch: Partial<{
  name: string;
  bodyHtml: string | null;
  bodyMarkdown: string | null;
  fileUrl: string | null;
  fileType: "html" | "markdown" | "pdf";
  variables: string[];
  sortOrder: number;
  isActive: boolean;
}>): Promise<ContractTemplate> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.bodyHtml !== undefined) update.body_html = patch.bodyHtml;
  if (patch.bodyMarkdown !== undefined) update.body_markdown = patch.bodyMarkdown;
  if (patch.fileUrl !== undefined) update.file_url = patch.fileUrl;
  if (patch.fileType !== undefined) update.file_type = patch.fileType;
  if (patch.variables !== undefined) update.variables = patch.variables;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;

  const { data, error } = await db
    .from("contract_templates")
    .update(update as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ContractTemplate;
}

export async function deleteContractTemplate(id: string): Promise<void> {
  const { error } = await db.from("contract_templates").delete().eq("id", id);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// 변수 처리
// ──────────────────────────────────────────────────────────

/** 본문에서 `{변수명}` 패턴 토큰 자동 추출 (중복 제거, 등장 순서). */
export function extractVariables(body: string | null | undefined): string[] {
  if (!body) return [];
  const re = /\{([^{}\s][^{}]*?)\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 본문의 `{변수명}` 토큰을 vars 매핑으로 치환. 누락된 변수는 그대로 노출(빈문자열 X — 누락 인지). */
export function renderTemplateWithVariables(body: string | null | undefined, vars: Record<string, string>): string {
  if (!body) return "";
  return body.replace(/\{([^{}\s][^{}]*?)\}/g, (_full, raw: string) => {
    const name = raw.trim();
    const v = vars[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

// ──────────────────────────────────────────────────────────
// 견적 → 계약 변수 자동 채움 (D 에서 사용)
// ──────────────────────────────────────────────────────────

/** 견적 stage 의 payload + deal 정보 + 회사 정보 → 계약 변수 자동 매핑.
 *  2026-05-21: 신규 변수 형식({갑_회사명} 등) + 사업자등록번호 + alias 호환.
 */
export function buildContractVarsFromDeal(input: {
  myCompanyName?: string | null;          // {갑_회사명}
  myBusinessNumber?: string | null;       // {갑_사업자번호}
  myRepresentative?: string | null;       // {갑_대표자}
  partnerName?: string | null;            // {을_회사명}
  partnerBusinessNumber?: string | null;  // {을_사업자번호}
  partnerRepresentative?: string | null;  // {을_대표자}
  contractTotal?: number | null;          // {계약금액}
  paymentStagesText?: string | null;      // {지급조건}
}): Record<string, string> {
  const myCo = (input.myCompanyName || "").trim();
  const myBiz = (input.myBusinessNumber || "").trim();
  const myRep = (input.myRepresentative || "").trim();
  const ptCo = (input.partnerName || "").trim();
  const ptBiz = (input.partnerBusinessNumber || "").trim();
  const ptRep = (input.partnerRepresentative || "").trim();
  return {
    // 신규 형식 (시스템 양식 v2 기준)
    "갑_회사명": myCo,
    "갑_사업자번호": myBiz,
    "갑_대표자": myRep,
    "을_회사명": ptCo,
    "을_사업자번호": ptBiz,
    "을_대표자": ptRep,
    // alias — 기존 회사 양식(v1) 호환
    "갑사명": myCo,
    "대표자_갑": myRep,
    "을사명": ptCo,
    "대표자_을": ptRep,
    // 공통
    "계약금액": input.contractTotal ? Number(input.contractTotal).toLocaleString("ko-KR") : "",
    "지급조건": (input.paymentStagesText || "").trim(),
  };
}
