// 결재허브 새 요청 — 요청 유형 즐겨찾기 (2026-09-02 사장님 "요청건들이 많으면 즐겨찾기")
//   저장: user_preferences.approval_type_favorites (계정별 — PC 를 바꿔도 따라온다) + localStorage(즉시 표시용 캐시).
//   ⚠️ user_preferences.user_id 는 auth.users(id) — users.id 가 아니다(사이드바 고정핀에서 겪은 함정).
//   회사 조회는 users.auth_id 로. 값 = 유형 value(내장 키 또는 'form:<양식id>') 배열.

import { supabase } from "@/lib/supabase";

const cacheKey = (companyId: string) => `ov-approval-type-favs-${companyId}`;

export function readCachedFavorites(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(cacheKey(companyId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function writeCache(companyId: string, favs: string[]) {
  try { localStorage.setItem(cacheKey(companyId), JSON.stringify(favs)); } catch { /* 저장 실패는 무시 */ }
}

/** 계정에 저장된 즐겨찾기 — 없거나 실패하면 null(호출측은 캐시 유지). */
export async function loadApprovalTypeFavorites(companyId: string): Promise<string[] | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return null;
    const { data, error } = await (supabase as any)
      .from("user_preferences")
      .select("approval_type_favorites")
      .eq("user_id", uid)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) return null;
    const arr = data?.approval_type_favorites;
    const favs = Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string") as string[] : [];
    writeCache(companyId, favs);
    return favs;
  } catch { return null; }
}

/** 즐겨찾기 저장 — 캐시는 즉시, 계정은 뒤에서. 실패해도 화면은 유지(다음 로드에서 계정값으로 정합). */
export async function saveApprovalTypeFavorites(companyId: string, favs: string[]): Promise<void> {
  writeCache(companyId, favs);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    await (supabase as any)
      .from("user_preferences")
      .upsert({ user_id: uid, company_id: companyId, approval_type_favorites: favs, updated_at: new Date().toISOString() }, { onConflict: "user_id,company_id" });
  } catch { /* 계정 저장 실패 — 캐시로 버틴다 */ }
}
