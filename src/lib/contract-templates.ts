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

  // maybeSingle: 권한이 없으면 update 가 0행이라 .single() 이 406 이 나고, 화면엔 엉뚱하게
  //   "데이터를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요" 가 떴다 — 새로고침해도 소용없다.
  //   (2026-08-20 감사: 07-31 에 쓰기 권한이 마스터·/hr-templates 로 좁혀졌다)
  const { data, error } = await db
    .from("contract_templates")
    .update(update as never)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("이 양식을 수정할 권한이 없습니다 — 근로계약·서식 권한이 필요합니다.");
  return data as ContractTemplate;
}

export async function deleteContractTemplate(id: string): Promise<void> {
  const { error } = await db.from("contract_templates").delete().eq("id", id);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// 표준(시스템) 양식 숨김 — 회사 단위
// ──────────────────────────────────────────────────────────
//   표준 양식은 전 회사가 공유하는 행이라 삭제하면 남의 회사 것까지 사라진다.
//   그래서 "우리 회사 목록에서만 감추는" 방식으로 company_settings.settings 에 id 목록을 둔다.
//   (2026-08-03 사장님: 양식관리에서 지운 계약서가 발송하기에 계속 나오면 안 된다)
const HIDDEN_KEY = "hidden_contract_template_ids";

export async function getHiddenContractTemplateIds(companyId: string): Promise<string[]> {
  const { data } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const ids = ((data as any)?.settings || {})[HIDDEN_KEY];
  return Array.isArray(ids) ? ids.filter((v: unknown) => typeof v === "string") : [];
}

export async function setContractTemplateHidden(companyId: string, templateId: string, hidden: boolean): Promise<void> {
  const { data } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const settings = { ...(((data as any)?.settings) || {}) } as Record<string, unknown>;
  const cur = new Set<string>(Array.isArray(settings[HIDDEN_KEY]) ? (settings[HIDDEN_KEY] as string[]) : []);
  if (hidden) cur.add(templateId); else cur.delete(templateId);
  settings[HIDDEN_KEY] = Array.from(cur);
  const { error } = await db.from("company_settings").update({ settings } as never).eq("company_id", companyId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// 양식 순서 — 회사 단위 (2026-08-03 사장님: "순서도 내가 변경할 수 있게")
// ──────────────────────────────────────────────────────────
//   표준 양식 행은 전 회사 공유라 sort_order 를 직접 못 바꾼다(RLS) — 숨김과 같은 방식으로
//   company_settings.settings 에 id 순서 배열을 두고, 화면(양식관리·발송 목록)이 이 순서로 정렬한다.
const ORDER_KEY = "contract_template_order";

export async function getContractTemplateOrder(companyId: string): Promise<string[]> {
  const { data } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const ids = ((data as any)?.settings || {})[ORDER_KEY];
  return Array.isArray(ids) ? ids.filter((v: unknown) => typeof v === "string") : [];
}

export async function setContractTemplateOrder(companyId: string, ids: string[]): Promise<void> {
  const { data } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const settings = { ...(((data as any)?.settings) || {}) } as Record<string, unknown>;
  settings[ORDER_KEY] = ids;
  const { error } = await db.from("company_settings").update({ settings } as never).eq("company_id", companyId);
  if (error) throw error;
}

/** 저장된 순서(id 배열)대로 정렬 — 배열에 있는 것 먼저(그 순서), 없는 것은 기존 순서 유지로 뒤에. */
export function sortTemplatesByOrder<T extends { id: string }>(templates: T[], order: string[]): T[] {
  if (!order.length) return templates;
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...templates].sort((a, b) => {
    const ai = idx.has(a.id) ? (idx.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bi = idx.has(b.id) ? (idx.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    return ai - bi; // 동률(둘 다 미기재)은 sort 안정성으로 기존 순서 유지
  });
}

// ──────────────────────────────────────────────────────────
// 변수 처리
// ──────────────────────────────────────────────────────────

// 변수 토큰 규약 — `{{변수명}}` 이중 중괄호로 통일 (2026-08-05 사장님 지시).
//   전자계약 발송 경로(signatures.normalizeVariableTokens·OrgBulkWizard)가 원래 이중이었는데
//   계약 양식 쪽만 단일이라, 편집기에서 넣은 변수가 발송 때 치환되지 않았다.
//   레거시 단일 중괄호 `{변수명}` 본문(과거 저장분)도 계속 인식·치환한다 — 이중을 먼저 매칭.
const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}|\{([^{}\s][^{}]*?)\}/g;

/** 본문에서 `{{변수명}}`(레거시 `{변수명}` 포함) 토큰 자동 추출 (중복 제거, 등장 순서). */
export function extractVariables(body: string | null | undefined): string[] {
  if (!body) return [];
  const re = new RegExp(TOKEN_RE.source, "g");
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = (m[1] ?? m[2] ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 본문의 `{{변수명}}`(레거시 `{변수명}`) 토큰을 vars 매핑으로 치환.
 *  누락된 변수는 원래 토큰을 그대로 남긴다(빈문자열 X — 누락을 눈으로 인지하게). */
export function renderTemplateWithVariables(body: string | null | undefined, vars: Record<string, string>): string {
  if (!body) return "";
  return body.replace(new RegExp(TOKEN_RE.source, "g"), (full, dbl?: string, sgl?: string) => {
    const name = (dbl ?? sgl ?? "").trim();
    if (!name) return full;
    const v = vars[name];
    return v === undefined || v === null ? full : String(v);
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
