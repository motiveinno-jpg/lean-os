"use client";

// 회사 합류 요청 대기 화면 — 가입 시 기존 회사에 합류 요청을 보낸 사용자용.
//   승인 전에는 회사 데이터 접근 0 (public.users 미생성 상태). 승인되면 대시보드 진입.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type JoinStatus = "loading" | "none" | "pending" | "approved" | "rejected" | "expired" | "cancelled" | "error";

export default function JoinPendingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<JoinStatus>("loading");
  const [companyMasked, setCompanyMasked] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/join-request", { method: "GET" });
      if (res.status === 401) { router.push("/auth"); return; }
      const j = await res.json();
      if (!res.ok) { setStatus("error"); return; }
      setStatus((j.status as JoinStatus) || "none");
      setCompanyMasked(j.companyNameMasked || "");
      setCreatedAt(j.createdAt ? String(j.createdAt).slice(0, 10) : "");
      if (j.status === "approved") setTimeout(() => router.push("/dashboard"), 1500);
    } catch {
      setStatus("error");
    } finally { setRefreshing(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const logout = async () => { await supabase.auth.signOut(); router.push("/auth"); };

  const box = (icon: string, title: string, desc: React.ReactNode, tone: string) => (
    <div className="join-status-box empty-state">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <h2 className={`text-base font-bold ${tone}`}>{title}</h2>
      <div className="text-sm text-[var(--text-muted)] leading-relaxed">{desc}</div>
    </div>
  );

  return (
    <div className="join-pending-page">
      <div className="w-full max-w-md">
        <div className="join-pending-card glass-card">
          {status === "loading" && box("⏳", "확인 중...", "합류 요청 상태를 불러오고 있습니다.", "text-[var(--text)]")}

          {status === "pending" && box("📨", "합류 요청 대기 중", (
            <>
              <b className="text-[var(--text)]">{companyMasked || "회사"}</b> 의 대표/관리자에게 합류 요청을 보냈습니다{createdAt ? ` (${createdAt})` : ""}.<br />
              승인되면 바로 회사 페이지를 사용할 수 있습니다.<br />
              <span className="text-[var(--text-dim)] text-xs">빠른 승인이 필요하면 대표/관리자에게 직접 알려주세요. 요청은 14일 후 만료됩니다.</span>
            </>
          ), "text-[var(--text)]")}

          {status === "approved" && box("🎉", "합류가 승인되었습니다!", "잠시 후 대시보드로 이동합니다.", "text-[var(--success)]")}

          {status === "rejected" && box("🚫", "합류 요청이 거절되었습니다", (
            <>회사 대표/관리자에게 문의하거나, 초대 링크를 받아 다시 시도해주세요.</>
          ), "text-[var(--danger)]")}

          {status === "expired" && box("⌛", "요청이 만료되었습니다", "14일 내 처리되지 않아 만료됐습니다. 대표/관리자에게 초대를 요청하거나, 로그인 후 다시 요청해주세요.", "text-[var(--text)]")}

          {(status === "none" || status === "cancelled") && box("🔎", "진행 중인 합류 요청이 없습니다", (
            <>회사 초대 링크로 합류하거나, 대표라면 회사를 새로 개설해주세요.</>
          ), "text-[var(--text)]")}

          {status === "error" && box("⚠️", "상태를 불러오지 못했습니다", "잠시 후 새로고침을 눌러 다시 시도해주세요.", "text-[var(--danger)]")}

          <div className="space-y-2.5 mt-4">
            {status === "approved" ? (
              <button onClick={() => router.push("/dashboard")} className="btn-primary w-full">
                대시보드로 이동
              </button>
            ) : (
              <button onClick={load} disabled={refreshing} className="btn-primary w-full">
                {refreshing ? "확인 중..." : "승인 여부 새로고침"}
              </button>
            )}
            <button onClick={logout} className="btn-secondary w-full">
              로그아웃
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-[var(--text-dim)] mt-6">
          <Link href="/" className="hover:underline">오너뷰</Link> — 대표를 위한 회사 상황판 OS
        </p>
      </div>
    </div>
  );
}
