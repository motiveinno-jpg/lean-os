"use client";

// 중복 로그인 방지 — 계정당 유효 세션 1개 (2026-08-11 사장님).
//   로그인(앱 진입) 시 내 세션을 active_sessions 에 유효 세션으로 등록한다.
//   다른 기기가 "같은 계정"으로 로그인해 행을 덮어쓰면, 이 기기는 Realtime 으로 즉시 감지해
//   스스로 로그아웃하고 /auth?reason=duplicate 로 보낸다.
//   Realtime 유실 대비 — 탭 복귀(visibility/focus) 시 한 번 더 대조한다.
//   같은 브라우저의 여러 탭은 세션(session_id)이 같아 서로 쫓아내지 않는다.
//
// ⚠️ 2026-08-13 사장님 제보: 같은 브라우저에서 "다른 계정"으로 새로 로그인하면(세무사 창 등)
//   기존 계정 탭이 중복 로그인으로 쫓겨났다. 원인 — 가드가 처음 계정의 세션 id 를 고정해 두고
//   비교해서, 브라우저 세션이 다른 계정으로 바뀐 것을 '중복'으로 오판했다.
//   수정 — 비교는 언제나 "지금 이 순간의 세션" 기준. 계정이 바뀌면 중복이 아니라 계정 전환:
//   그 계정 기준으로 등록·감시를 다시 세우고 화면을 새로고침해 새 계정으로 잇는다.
//   중복 판정은 오직 같은 계정(auth_id 행)의 session_id 가 내 것과 다를 때만.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// JWT payload 의 session_id — 토큰 갱신(rotation)에도 세션이 같으면 유지되는 값
function sessionIdOf(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.session_id ?? null;
  } catch { return null; }
}

export function SingleSessionGuard() {
  const router = useRouter();

  useEffect(() => {
    // 로컬 개발 서버(localhost)는 운영과 같은 prod DB를 봐서, 로컬 로그인이 세션을 등록하면
    //   운영 브라우저가 중복 로그인으로 쫓겨난다(2026-08-11 사장님 제보 — 로컬 결제 테스트 중 발생).
    //   로컬에서는 등록·감시 모두 건너뛴다: 운영을 안 쫓아내고, 로컬도 안 쫓겨난다.
    if (typeof location !== "undefined" &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
    let guardedUserId: string | null = null;   // 지금 감시 중인 계정
    let alive = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let kicked = false;

    const kick = async () => {
      if (kicked) return;
      kicked = true;
      // scope 'local' 필수 — 기본(global)은 새로 로그인한 기기의 세션까지 전부 무효화해 버린다
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* 세션이 이미 무효여도 진행 */ }
      router.replace("/auth?reason=duplicate");
    };

    const teardownChannel = () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };

    // 현재 세션 기준으로 등록·감시를 세운다. 계정이 바뀌었으면 그 계정으로 갈아탄다.
    const arm = async () => {
      if (!alive) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive || !session) return;
      const mySession = sessionIdOf(session.access_token);
      if (!mySession) return;
      guardedUserId = session.user.id;

      // 내 세션을 유효 세션으로 등록 — 같은 계정의 기존 기기 행을 덮어쓴다(그 기기가 Realtime 으로 감지해 로그아웃)
      const device = typeof navigator !== "undefined" ? (navigator.platform || "web") : "web";
      try {
        await (supabase as any).from("active_sessions").upsert(
          { auth_id: session.user.id, session_id: mySession, device_label: device, updated_at: new Date().toISOString() },
          { onConflict: "auth_id" },
        );
      } catch { /* 등록 실패해도 앱 사용은 막지 않는다 (베스트 에포트) */ }

      teardownChannel();
      channel = supabase
        .channel(`single-session-${session.user.id}`)
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "active_sessions", filter: `auth_id=eq.${session.user.id}` },
          () => { void check(); })
        .subscribe();
    };

    // 중복 대조 — 항상 "지금 세션" 기준. 같은 계정 행의 session_id 가 내 것과 다를 때만 중복이다.
    const check = async () => {
      if (!alive) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!alive || !session) return;
        if (session.user.id !== guardedUserId) { await arm(); return; }  // 계정 전환 — 중복 아님
        const cur = sessionIdOf(session.access_token);
        if (!cur) return;
        const { data } = await (supabase as any).from("active_sessions").select("session_id").maybeSingle();
        if (alive && data?.session_id && data.session_id !== cur) kick();
      } catch { /* 조회 실패는 다음 기회에 */ }
    };

    void arm();

    // 같은 브라우저에서 다른 계정으로 로그인하면(다른 탭 포함) 세션이 그 계정으로 바뀐다 —
    //   중복 로그아웃이 아니라 계정 전환으로 처리: 새 계정으로 감시를 다시 세우고 화면을 리로드.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === "SIGNED_OUT") { teardownChannel(); guardedUserId = null; return; }
      if (!session?.user?.id) return;
      if (guardedUserId && session.user.id !== guardedUserId) {
        teardownChannel();
        guardedUserId = session.user.id;
        window.location.reload();  // 화면 전체를 새 계정 기준으로
        return;
      }
      if (!guardedUserId) void arm();
    });

    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      authSub?.subscription?.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      teardownChannel();
    };
  }, [router]);

  return null;
}
