// 로그인 상태가 깨졌을 때의 판정과 처리를 한 곳에 둔다.
//   "내 사용자·회사 정보를 못 읽었다"에는 두 가지가 섞여 있다 —
//   ① 정말 회사가 없는 계정(가입 중 이탈 등) → 회사 설정으로 보낸다
//   ② 로그인이 깨져서 못 읽은 것(다른 곳에서 로그인되어 밀려남·회사 IP 제한·로그인 만료) → 로그인 화면으로 보낸다
//   예전엔 ②도 ①로 봐서, 가만히 두었다가 로그인이 풀리면 사업자번호 입력(회사 개설) 화면이 떴다.
import { supabase } from "./supabase";

export type SessionProblem = "duplicate" | "ip" | "expired";

/** DB·API 오류가 로그인 문제인지 — 아니면 null(일시 장애 등) */
export function sessionProblemOf(err: unknown): SessionProblem | null {
  if (!err) return null;
  const e = err as { message?: string; code?: string; status?: number; details?: string; hint?: string };
  const hay = `${e.message || ""} ${e.details || ""} ${e.hint || ""} ${e.code || ""}`;
  if (/session_gate:duplicate/.test(hay)) return "duplicate";
  if (/session_gate:ip/.test(hay)) return "ip";
  if (e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303" || /jwt|token is expired|invalid claim/i.test(hay)) return "expired";
  return null;
}

/** 이 브라우저에서만 로그아웃하고 로그인 화면으로 — 이유를 함께 넘겨 화면이 안내한다.
 *  전체 새로고침으로 옮겨 이전 로그인의 화면 상태(사용자 캐시 등)가 남지 않게 한다. */
export async function leaveForLogin(reason: SessionProblem): Promise<void> {
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* 이미 끊긴 세션이어도 진행 */ }
  const back = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
  const q = new URLSearchParams({ reason });
  if (back && back.startsWith("/") && !back.startsWith("/auth") && !back.startsWith("/company-setup")) q.set("redirectTo", back);
  window.location.assign(`/auth?${q.toString()}`);
}

/** 사람이 누르는 로그아웃 — 이 브라우저만. 기본(global)은 같은 계정의 다른 PC·브라우저 로그인까지 전부 끊어
 *  그쪽이 다음 토큰 갱신 때(최대 1시간 뒤) 갑자기 로그아웃됐다. */
export async function logoutHere(to = "/auth"): Promise<void> {
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* 무시 */ }
  window.location.href = to;
}
