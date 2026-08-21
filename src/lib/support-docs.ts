import { supabase } from "./supabase";

/**
 * 지원사업 신청 서류 — 무엇이 필요하고, 우리가 이미 가진 게 무엇인가 (2026-08-21 사장님 지시)
 *
 * ★ 사전은 코드에 둔다 — 서류 이름·발급처·발급 링크는 회사마다 다르지 않다.
 *   DB 에 넣으면 링크 하나 고치는 데 마이그레이션이 필요해진다.
 *   사업별 **목록**만 gov_programs.required_docs 에 있다.
 *
 * ★ 보유 판정은 **파일명·폴더명·태그**로 한다.
 *   document_files.category 는 프로덕션에서 전부 비어 있다(2026-08-21 실측 51건 모두 null).
 *   쓰지 않는 칸을 믿고 짜면 아무것도 안 잡힌다.
 *
 * ★ **찾았다고 단정하지 않는다.** 파일명이 비슷하다고 그 서류라는 보장은 없고,
 *   완납증명처럼 유효기간이 있는 서류는 오래된 파일이 오히려 위험하다.
 *   그래서 '보유'가 아니라 **'있어 보이는 파일'** 을 짚어 주고 판단은 사람이 한다.
 */

export type DocSource = "홈택스" | "정부24" | "위택스" | "고용24" | "건강보험" | "중소기업현황정보시스템" | "인터넷등기소" | "은행" | "회사 작성" | "오너뷰";

export type DocSpec = {
  key: string;
  label: string;
  /** 어디서 떼나 */
  source: DocSource;
  /** 발급 페이지 — 없으면 회사가 직접 만드는 서류 */
  url?: string;
  /** 유효기간(일). 완납증명처럼 최근 것만 받아 주는 서류가 있다 */
  validDays?: number;
  /** 파일보관함에서 이 서류를 찾을 때 쓰는 낱말 (하나라도 들어 있으면 후보) */
  match: string[];
  /** 오너뷰 안에서 내용을 확인하거나 만들 수 있는 곳 */
  ownerview?: { href: string; label: string };
  hint?: string;
};

export const DOC_CATALOG: DocSpec[] = [
  {
    key: "biz_license", label: "사업자등록증", source: "홈택스",
    url: "https://www.hometax.go.kr", match: ["사업자등록증", "사업자 등록증", "biz_license", "business_license"],
    hint: "사본이면 됩니다. 상호·주소가 바뀌었으면 최신본으로.",
  },
  {
    key: "biz_cert", label: "사업자등록증명", source: "홈택스", validDays: 30,
    url: "https://www.hometax.go.kr", match: ["사업자등록증명", "사업자 등록 증명"],
    hint: "'등록증'과 다른 서류입니다 — 발급일이 최근이어야 합니다.",
  },
  {
    key: "tax_clear_national", label: "국세 완납증명서", source: "홈택스", validDays: 30,
    url: "https://www.hometax.go.kr", match: ["국세완납", "국세 완납", "납세증명", "납세 증명"],
    hint: "체납이 있으면 발급되지 않습니다 — 신청 전에 미리 떼 보세요.",
  },
  {
    key: "tax_clear_local", label: "지방세 완납증명서", source: "위택스", validDays: 30,
    url: "https://www.wetax.go.kr", match: ["지방세완납", "지방세 완납", "지방세납세"],
  },
  {
    key: "sme_cert", label: "중소기업확인서", source: "중소기업현황정보시스템", validDays: 365,
    url: "https://sminfo.mss.go.kr", match: ["중소기업확인서", "중소기업 확인서", "소상공인확인서"],
    hint: "거의 모든 정부지원사업이 요구합니다. 매년 새로 받습니다.",
  },
  {
    key: "corp_register", label: "법인등기부등본", source: "인터넷등기소", validDays: 90,
    url: "https://www.iros.go.kr", match: ["등기부등본", "등기사항", "법인등기"],
    hint: "개인사업자는 해당 없습니다.",
  },
  {
    key: "seal_cert", label: "법인인감증명서", source: "정부24", validDays: 90,
    url: "https://www.gov.kr", match: ["인감증명", "인감 증명"],
  },
  {
    key: "fin_statement", label: "재무제표 (최근 3개년)", source: "홈택스",
    url: "https://www.hometax.go.kr", match: ["재무제표", "표준재무제표", "결산서", "손익계산서", "재무상태표"],
    ownerview: { href: "/reports/statements", label: "회계 자료에서 숫자 확인" },
    hint: "제출용은 홈택스 '표준재무제표증명'입니다. 오너뷰 숫자는 대조용으로 쓰세요.",
  },
  {
    key: "insurance_roster", label: "4대보험 가입자명부", source: "건강보험", validDays: 30,
    url: "https://si4n.nhis.or.kr", match: ["가입자명부", "사업장가입자", "4대보험", "사대보험"],
    ownerview: { href: "/employees", label: "구성원 명단 확인" },
    hint: "고용장려금 심사의 핵심 자료입니다.",
  },
  {
    key: "employment_cert", label: "고용보험 가입증명", source: "고용24", validDays: 30,
    url: "https://www.work24.go.kr", match: ["고용보험", "피보험자격"],
  },
  {
    key: "labor_contract", label: "근로계약서", source: "회사 작성",
    match: ["근로계약", "근로 계약", "표준근로"],
    ownerview: { href: "/hr-templates", label: "인사 서식에서 작성·보관" },
    hint: "오너뷰에서 쓴 전자계약이 있으면 그걸 내려받아 내면 됩니다.",
  },
  {
    key: "payroll", label: "급여대장 · 임금대장", source: "회사 작성",
    match: ["급여대장", "임금대장", "급여명세", "급여 명세"],
    ownerview: { href: "/employees", label: "급여명세서 확인" },
  },
  {
    key: "attendance_record", label: "근태 기록", source: "회사 작성",
    match: ["근태", "출퇴근", "출근부"],
    ownerview: { href: "/attendance", label: "근태 기록 확인" },
    hint: "유연근무 장려금은 근태로 증빙합니다.",
  },
  {
    key: "bank_copy", label: "통장 사본", source: "은행",
    match: ["통장사본", "통장 사본", "예금거래", "계좌사본"],
    ownerview: { href: "/bank", label: "등록된 계좌 확인" },
  },
  {
    key: "biz_plan", label: "사업계획서", source: "회사 작성",
    match: ["사업계획", "사업 계획"],
    hint: "공고마다 정해진 양식이 있습니다 — 공고문에서 내려받으세요.",
  },
  {
    key: "venture_cert", label: "벤처기업확인서", source: "정부24",
    url: "https://www.smes.go.kr/venturein", match: ["벤처기업확인", "벤처확인"],
    hint: "가점 서류입니다. 없으면 안 내도 되는 경우가 많습니다.",
  },
  {
    key: "export_perf", label: "수출실적증명", source: "회사 작성", validDays: 90,
    match: ["수출실적", "수출 실적"],
    hint: "수출바우처 계열의 자격 서류입니다.",
  },
];

export const DOC_BY_KEY: Record<string, DocSpec> =
  Object.fromEntries(DOC_CATALOG.map((d) => [d.key, d]));

/**
 * 공고형은 공고문을 읽기 전까지 서류를 알 수 없다 — 대신 **거의 항상 요구되는 기본 세트**를 쓴다.
 *   과하게 잡지 않는다. 여기 있는 건 "이건 십중팔구 필요하다" 수준만.
 */
const DEFAULT_DOCS_BY_RULE: Record<string, string[]> = {
  kstartup: ["biz_license", "sme_cert", "tax_clear_national", "biz_plan"],
};

export function requiredDocsOf(program: { required_docs?: string[] | null; rule_key: string | null }): string[] {
  const own = program.required_docs ?? [];
  if (own.length > 0) return own;
  return (program.rule_key && DEFAULT_DOCS_BY_RULE[program.rule_key]) || [];
}

/** 이 사업의 서류 목록이 공고에서 확인된 것인지, 우리가 추정한 기본 세트인지 */
export function docsAreEstimated(program: { required_docs?: string[] | null; rule_key: string | null }): boolean {
  return (program.required_docs ?? []).length === 0;
}

// ── 회사가 가진 파일 ──────────────────────────────────────────────────────

export type CompanyFile = {
  id: string;
  file_name: string;
  file_url: string;
  folder: string | null;
  tags: string[] | null;
  created_at: string | null;
};

export async function loadCompanyFiles(companyId: string): Promise<CompanyFile[]> {
  const { data } = await supabase
    .from("document_files")
    .select("id, file_name, file_url, tags, created_at, document_folders(name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1000);

  return ((data || []) as unknown as Array<CompanyFile & { document_folders?: { name?: string } | null }>)
    .map((f) => ({
      id: f.id,
      file_name: f.file_name,
      file_url: f.file_url,
      folder: f.document_folders?.name ?? null,
      tags: f.tags ?? null,
      created_at: f.created_at ?? null,
    }));
}

export type DocStatus = "have" | "stale" | "ownerview" | "issue" | "write";

export type DocCheck = {
  spec: DocSpec;
  status: DocStatus;
  /** 찾은 파일 (status = have | stale) */
  file?: CompanyFile;
  /** 며칠 지난 파일인지 (유효기간 있는 서류) */
  ageDays?: number;
  note: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()[\]]/g, "");

/**
 * 문서를 페이지별로 쪼갠 미리보기 조각 — `…-p5.png` 꼴.
 *   이 저장소는 PDF 를 페이지 이미지로 나눠 보관한다(광고 보고서-p11.png 등).
 *   조각을 서류로 세면 "근로계약서 있음"처럼 **잘못된 안심**을 준다. 제출할 수 있는 파일이 아니다.
 */
function isPagePart(fileName: string): boolean {
  return /-p\d+\.(png|jpe?g|webp)$/i.test(fileName.trim());
}

/**
 * 서류 하나가 회사에 있는지 본다.
 *   have      — 파일보관함에서 찾았다 (유효기간 안)
 *   stale     — 찾긴 했는데 발급일이 오래됐다 → 다시 떼야 할 수 있다
 *   ownerview — 파일은 없지만 오너뷰 안에서 만들거나 확인할 수 있다
 *   issue     — 기관에서 발급받아야 한다 (링크를 준다)
 *   write     — 회사가 직접 써야 한다
 */
export function checkDoc(spec: DocSpec, files: CompanyFile[], today: string): DocCheck {
  const needles = spec.match.map(norm);
  const hit = files.filter((f) => !isPagePart(f.file_name)).find((f) => {
    const hay = norm(`${f.file_name} ${f.folder ?? ""} ${(f.tags ?? []).join(" ")}`);
    return needles.some((n) => hay.includes(n));
  });

  if (hit) {
    const ageDays = hit.created_at
      ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(hit.created_at)) / 86_400_000))
      : undefined;
    if (spec.validDays && ageDays !== undefined && ageDays > spec.validDays) {
      return {
        spec, status: "stale", file: hit, ageDays,
        note: `보관함에 있지만 올린 지 ${ageDays}일 됐습니다 — ${spec.validDays}일 이내 발급본을 요구합니다`,
      };
    }
    return { spec, status: "have", file: hit, ageDays, note: "파일보관함에서 찾았습니다" };
  }

  if (spec.ownerview) return { spec, status: "ownerview", note: `오너뷰 ${spec.ownerview.label}` };
  if (spec.url) return { spec, status: "issue", note: `${spec.source}에서 발급받으세요` };
  return { spec, status: "write", note: "회사가 직접 작성하는 서류입니다" };
}

export function checkDocs(keys: string[], files: CompanyFile[], today: string): DocCheck[] {
  return keys.map((k) => DOC_BY_KEY[k]).filter(Boolean).map((spec) => checkDoc(spec, files, today));
}

/** 준비된 것으로 셀 수 있는 상태 — stale 은 다시 떼야 하므로 안 센다 */
export function readyCount(checks: DocCheck[]): number {
  return checks.filter((c) => c.status === "have").length;
}

//   '있음'이라고 단정하지 않는다 — 파일명으로 찾은 것이라 실제 그 서류라는 보장이 없다
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  have: "비슷한 파일",
  stale: "다시 발급 필요",
  ownerview: "오너뷰에서",
  issue: "발급 필요",
  write: "직접 작성",
};
