// 운영자 콘솔 집계에서 테스트 회사(companies.is_test — 자동 QA·검수용 가짜 회사)를 빼는 한 곳.
//   RPC 쪽 집계는 DB 함수가 같은 기준으로 이미 빼고, 여기는 화면이 테이블을 직접 읽는 목록·숫자에 쓴다.
//   is_internal(자사 실사용 회사)은 실제 회사라 빼지 않는다.
//   회사 상세(companies/[id])는 이 필터를 쓰지 않는다 — 운영자가 테스트 회사를 직접 열어 볼 수 있어야 한다.
import { supabase } from "@/lib/supabase";
import { reportError } from "@/lib/friendly-error";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; ids: Promise<Set<string>> } | null = null;

async function fetchTestCompanyIds(): Promise<Set<string>> {
  const { data, error } = await (supabase as any)
    .from("companies")
    .select("id")
    .eq("is_test", true)
    .order("id")
    .limit(1000);
  if (error) {
    // 컬럼이 아직 없는 DB(마이그레이션 적용 전)에서는 거를 대상이 없는 것으로 본다 — 화면은 종전 그대로 뜬다.
    if (error.code === "42703") return new Set();
    reportError("platform.test-companies", error);
    throw error;
  }
  return new Set(((data || []) as { id: string }[]).map((r) => r.id));
}

/** 테스트 회사 id 집합. 여러 화면·쿼리가 같이 불러도 5분 안에는 한 번만 조회한다. */
export function loadTestCompanyIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  const ids = fetchTestCompanyIds();
  cache = { at: Date.now(), ids };
  // 실패한 조회는 캐시에 남기지 않는다(다음 호출에서 다시 시도)
  ids.catch(() => { if (cache?.ids === ids) cache = null; });
  return ids;
}

/**
 * 테스트 회사 행을 뺀다. pick 은 행의 회사 id(회사 행이면 r.id).
 * 회사가 없는 행(null)은 남긴다.
 */
export async function dropTestCompanies<T>(
  rows: T[] | null | undefined,
  pick: (row: T) => string | null | undefined = (r: any) => r?.company_id,
): Promise<T[]> {
  const list = rows || [];
  const ids = await loadTestCompanyIds();
  if (ids.size === 0) return list;
  return list.filter((r) => {
    const id = pick(r);
    return !id || !ids.has(id);
  });
}
