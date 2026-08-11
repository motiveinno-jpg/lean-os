"use client";

// 중복 로그인 방지 — 계정당 유효 세션 1개 (2026-08-11 사장님).
//   로그인(앱 진입) 시 내 세션을 active_sessions 에 유효 세션으로 등록한다.
//   다른 기기가 같은 계정으로 로그인해 행을 덮어쓰면, 이 기기는 Realtime 으로 즉시 감지해
//   스스로 로그아웃하고 /auth?reason=duplicate 로 보낸다.
//   Realtime 유실 대비 — 탭 복귀(visibility/focus) 시 한 번 더 대조한다.
//   같은 브라우저의 여러 탭은 세션(session_id)이 같아 서로 쫓아내지 않는다.

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
    let mySession: string | null = null;
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

    const check = async () => {
      if (!alive || !mySession) return;
      try {
        const { data } = await (supabase as any).from("active_sessions").select("session_id").maybeSingle();
        if (alive && data?.session_id && data.session_id !== mySession) kick();
      } catch { /* 조회 실패는 다음 기회에 */ }
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive || !session) return;
      mySession = sessionIdOf(session.access_token);
      if (!mySession) return;

      // 내 세션을 유효 세션으로 등록 — 기존 기기 행을 덮어쓴다(그 기기는 아래 Realtime 으로 감지해 로그아웃)
      const device = typeof navigator !== "undefined" ? (navigator.platform || "web") : "web";
      try {
        await (supabase as any).from("active_sessions").upsert(
          { auth_id: session.user.id, session_id: mySession, device_label: device, updated_at: new Date().toISOString() },
          { onConflict: "auth_id" },
        );
      } catch { /* 등록 실패해도 앱 사용은 막지 않는다 (베스트 에포트) */ }

      channel = supabase
        .channel(`single-session-${session.user.id}`)
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "active_sessions", filter: `auth_id=eq.${session.user.id}` },
          (payload: any) => {
            const sid = payload?.new?.session_id;
            if (sid && sid !== mySession) kick();
          })
        .subscribe();
    })();

    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
