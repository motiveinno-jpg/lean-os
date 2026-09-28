// 광고 메일 링크 클릭·전환 계측 — 운영자 「메일 보내기」가 누가 눌렀는지·가입/상담까지 갔는지 보여 준다.
//
//   · 발송 함수(email-campaign-send)가 owner-view.com 링크마다 ?ec=<수신자 토큰 16자> 를 붙인다.
//   · 사이트에 그 값을 달고 들어오면 record_email_click 으로 클릭을 적고, 주소창에서는 ec 를 지운다(공유·북마크에 안 남게).
//   · 토큰은 30일 동안 이 브라우저에 두었다가 회원가입·상담 신청이 되면 전환으로 한 번 더 적고 지운다.
//   · 자동화 브라우저(메일 보안 스캐너 등)는 page-view-beacon 의 isAutomated 로 걸러서 부르지 않는다.
import { supabase } from "@/lib/supabase";

const KEY = "ov_email_ref";
const TTL_MS = 30 * 86400_000;
const TOKEN_RE = /^[0-9a-f]{16}$/;

//   supabase.rpc 는 then 을 불러야 요청이 나간다(void 로 버리면 아무것도 안 보냄).
const rpc = (token: string, path: string | null, kind: "click" | "signup" | "contact") => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.rpc as any)("record_email_click", { p_token: token, p_path: path, p_kind: kind }).then(() => {}, () => {});
};

//   첫 화면에서 두 번 불린다 — 같은 토큰은 탭당 한 번만. 모듈 변수로는 못 막아서(두 번째 호출도 새 값으로 시작) sessionStorage 로.
function firstTime(token: string): boolean {
  try {
    const k = `ov_ec_done:${token}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, "1");
  } catch { /* 저장 불가 — 서버가 30초 안 중복을 접는다 */ }
  return true;
}

/** 들어온 주소에 ec 가 있으면 클릭으로 적는다. 페이지마다 불러도 된다(없으면 아무것도 안 함). */
export function captureEmailClick() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const token = sp.get("ec");
    if (!token) return;
    sp.delete("ec");
    const qs = sp.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    if (!TOKEN_RE.test(token) || !firstTime(token)) return;
    try { localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* 저장 불가 — 전환만 못 셈 */ }
    rpc(token, window.location.pathname, "click");
  } catch { /* 계측은 화면을 방해하지 않는다 */ }
}

/** 회원가입·상담 신청이 성공했을 때 부른다. 메일 링크로 들어온 브라우저가 아니면 아무것도 안 함. */
export function markEmailConversion(kind: "signup" | "contact") {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const { token, at } = JSON.parse(raw) as { token?: string; at?: number };
    if (!token || !TOKEN_RE.test(token) || !at || Date.now() - at > TTL_MS) { localStorage.removeItem(KEY); return; }
    rpc(token, window.location.pathname, kind);
    if (kind === "signup") localStorage.removeItem(KEY);
  } catch { /* 무해 */ }
}

/** 소셜 로그인(구글·네이버·카카오)은 가입 화면을 거치지 않고 돌아온다 — 방금 만든 계정의 첫 세션이면 가입으로 센다. */
export function markSignupIfNewAccount(createdAt: string | undefined) {
  if (!createdAt) return;
  const age = Date.now() - new Date(createdAt).getTime();
  if (age >= 0 && age < 30 * 60_000) markEmailConversion("signup");
}
