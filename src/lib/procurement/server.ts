import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requirePerm } from "@/lib/api-authz";
import {
  DEFAULT_SETTINGS,
  type Workspace,
  type CompanyBasics,
  type NoticeRow,
  type ReviewRow,
  type Evidence,
  type CaseRow,
  type DraftRow,
  type RunRow,
  type Settings,
} from "./types";
import { ProcurementError } from "./validation";
import { evidenceHash } from "./fingerprint";

// 신규 테이블은 운영 스키마 반영 후 database.ts 재생성 대상. any는 이 DB 어댑터 경계에만 둔다.
export type ProcurementDb = ReturnType<typeof createSupabaseAdminClient> & {
  from: (table: string) => any;
};
export async function authorize() {
  const session = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await session.auth.getUser();
  if (error || !user) throw new ProcurementError("로그인이 필요합니다.", 401);
  const db = createSupabaseAdminClient();
  const gate = await requirePerm(db as never, user.id, "/procurement");
  if (!gate.ok) throw new ProcurementError(gate.error, gate.status);
  if (!gate.caller.isMaster)
    throw new ProcurementError(
      "입찰 검토 기본 기능은 회사 마스터만 사용할 수 있습니다.",
      403,
    );
  return {
    db: db as unknown as ProcurementDb,
    companyId: gate.caller.companyId,
    userId: gate.caller.id,
  };
}
export function checked<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}): T {
  if (result.error) {
    if (result.error.code === "P0001")
      throw new ProcurementError(
        "자료 기준이 변경되었거나 검토가 완료되지 않았습니다. 최신 공고와 평가를 다시 확인하세요.",
        409,
      );
    if (
      ["42P01", "PGRST205", "42883", "PGRST202"].includes(
        result.error.code || "",
      )
    )
      throw new ProcurementError(
        "입찰 검토 저장소가 아직 설치되지 않았습니다. 데이터베이스 준비 후 저장할 수 있습니다.",
        503,
      );
    throw new ProcurementError(
      "입찰 자료 처리에 실패했습니다. 저장 상태를 확인하고 다시 시도하세요.",
      500,
    );
  }
  return result.data;
}
export async function rows<T>(
  db: ProcurementDb,
  table: string,
  companyId: string,
  columns = "*",
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const result = await db
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    const data = checked(result) as T[];
    out.push(...data);
    if (data.length < 500) return out;
  }
  const extra = checked(
    await db
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(20000, 20000),
  ) as T[];
  if (!extra.length) return out;
  throw new ProcurementError(
    "자료가 2만 건을 넘었습니다. 기간별 조회 기능을 적용해야 합니다.",
    413,
  );
}
export async function workspace(
  db: ProcurementDb,
  companyId: string,
): Promise<Workspace> {
  const [companyResult, profileResult, fileResult] = await Promise.all([
    db
      .from("companies")
      .select(
        "id,name,business_number,representative,address,phone,fax,industry,business_type,business_category",
      )
      .eq("id", companyId)
      .single(),
    db
      .from("company_profile_ext")
      .select("open_date,size_class,certifications")
      .eq("company_id", companyId)
      .maybeSingle(),
    rows<{ id: string; file_name: string; created_at: string | null }>(
      db,
      "document_files",
      companyId,
      "id,file_name,created_at",
    ),
  ]);
  const company = checked(companyResult) as CompanyBasics;
  const profile = checked(profileResult) as Workspace["profile"];
  const files = fileResult;
  const integration = {
    g2b: !!process.env.G2B_SERVICE_KEY,
    g2bVerified: process.env.PROCUREMENT_G2B_VERIFIED === "true",
    mail: !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL,
    scheduler:
      (process.env.PROCUREMENT_CRON_SECRET?.length || 0) >= 32 &&
      process.env.PROCUREMENT_SCHEDULER_ENABLED === "true" &&
      process.env.PROCUREMENT_COMPANY_ID === companyId,
  };
  const base: Workspace = {
    company,
    profile,
    files,
    integration,
    settings: { ...DEFAULT_SETTINGS },
    evidence: [],
    notices: [],
    reviews: [],
    cases: [],
    drafts: [],
    runs: [],
    ready: false,
  };
  const settingResult = await db
    .from("procurement_settings")
    .select("settings")
    .eq("company_id", companyId)
    .maybeSingle();
  if (
    settingResult.error &&
    ["42P01", "PGRST205"].includes(settingResult.error.code)
  )
    return base;
  const saved = checked(settingResult) as { settings: Settings } | null;
  const [evidence, notices, reviews, cases, drafts, runs] = await Promise.all([
    rows<{ payload: Evidence }>(
      db,
      "procurement_evidence",
      companyId,
      "id,payload,created_at",
    ),
    rows<NoticeRow & { is_current: boolean }>(
      db,
      "procurement_notices",
      companyId,
      "id,payload,content_hash,is_current,created_at",
    ),
    rows<ReviewRow>(db, "procurement_reviews", companyId),
    rows<CaseRow>(db, "procurement_cases", companyId),
    rows<DraftRow>(db, "procurement_drafts", companyId),
    rows<RunRow>(db, "procurement_runs", companyId),
  ]);
  const currentEvidence = evidence.map((e) => e.payload),
    currentNotices = notices.filter((n) => n.is_current);
  const settings = saved?.settings || { ...DEFAULT_SETTINGS };
  const basis = evidenceHash(currentEvidence, company, settings);
  return {
    ...base,
    settings,
    ready: true,
    evidence: currentEvidence,
    notices: currentNotices,
    reviews: reviews.map((r) => ({
      ...r,
      stale:
        r.evidence_hash !== basis ||
        !currentNotices.some(
          (n) => n.id === r.notice_id && n.content_hash === r.content_hash,
        ),
    })),
    cases,
    drafts,
    runs,
  };
}
