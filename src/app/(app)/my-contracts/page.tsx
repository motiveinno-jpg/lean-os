"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

type Package = {
  id: string;
  title: string;
  status: string;
  sign_token: string;
  sent_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  created_at: string;
  employees?: { id: string; name: string; user_id: string | null } | null;
  hr_contract_package_items?: { id: string; status: string }[];
};

const STATUS_INFO: Record<string, { label: string; bg: string; text: string }> = {
  sent: { label: "서명 대기", bg: "bg-amber-500/10", text: "text-amber-400" },
  partially_signed: { label: "일부 서명", bg: "bg-blue-500/10", text: "text-blue-400" },
  completed: { label: "서명 완료", bg: "bg-green-500/10", text: "text-green-400" },
  cancelled: { label: "취소됨", bg: "bg-gray-500/10", text: "text-gray-400" },
  draft: { label: "준비 중", bg: "bg-gray-500/10", text: "text-gray-400" },
};

// 내게 온 서명 요청 — 모두사인 스타일 인앱 서명 inbox.
export default function MyContractsPage() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const companyId = user?.company_id ?? null;
  const [filter, setFilter] = useState<"pending" | "completed" | "all">("pending");

  const { data: packages = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["my-contracts", userId, companyId],
    queryFn: async () => {
      const db = supabase as any;
      // 본인의 employees 레코드 id 먼저 조회
      const { data: emp } = await db
        .from("employees")
        .select("id")
        .eq("user_id", userId!)
        .eq("company_id", companyId!)
        .maybeSingle();
      if (!emp) return [];
      const { data } = await db
        .from("hr_contract_packages")
        .select(
          "id, title, status, sign_token, sent_at, expires_at, completed_at, created_at, employees(id, name, user_id), hr_contract_package_items(id, status)",
        )
        .eq("employee_id", emp.id)
        .order("created_at", { ascending: false });
      return (data || []) as Package[];
    },
    enabled: !!userId && !!companyId,
  });

  const filtered = useMemo(() => {
    if (filter === "all") return packages;
    if (filter === "pending") return packages.filter((p) => ["sent", "partially_signed", "draft"].includes(p.status));
    return packages.filter((p) => p.status === "completed");
  }, [packages, filter]);

  const counts = useMemo(() => {
    const pending = packages.filter((p) => ["sent", "partially_signed"].includes(p.status)).length;
    const completed = packages.filter((p) => p.status === "completed").length;
    return { pending, completed, all: packages.length };
  }, [packages]);

  function openSign(pkg: Package) {
    if (!pkg.sign_token) return;
    // 인앱에서 새 탭으로 서명 페이지 열기 — /sign 은 (app) 외부 라우트라 별도 페이지로 처리.
    window.open(`/sign?token=${pkg.sign_token}`, "_blank", "noopener");
  }

  if (!userId || !companyId) {
    return (
      <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">내 서명 요청</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            받은 계약서를 OwnerView 안에서 바로 서명하세요.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition disabled:opacity-50 flex items-center gap-1.5"
        >
          <svg className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isFetching ? '갱신 중...' : '새로고침'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { key: "pending" as const, label: "대기 중", count: counts.pending },
          { key: "completed" as const, label: "완료", count: counts.completed },
          { key: "all" as const, label: "전체", count: counts.all },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f.key
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {f.label}
            {f.count > 0 && (
              <span className="ml-1 text-[10px] px-1 py-0.5 rounded-full bg-white/20">
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-3">✍️</div>
          <div className="text-sm text-[var(--text-muted)]">
            {filter === "pending"
              ? "대기 중인 서명 요청이 없습니다"
              : filter === "completed"
              ? "완료된 서명이 없습니다"
              : "받은 계약서가 없습니다"}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const st = STATUS_INFO[p.status] || STATUS_INFO.draft;
            const items = p.hr_contract_package_items || [];
            const signedCount = items.filter((it) => it.status === "signed").length;
            const totalCount = items.length;
            const expired = p.expires_at && new Date(p.expires_at) < new Date();
            const canSign = !expired && ["sent", "partially_signed"].includes(p.status);
            const sentDate = p.sent_at ? new Date(p.sent_at).toLocaleDateString("ko-KR") : "—";
            const expDate = p.expires_at ? new Date(p.expires_at).toLocaleDateString("ko-KR") : "—";

            return (
              <div
                key={p.id}
                className="glass-card p-5 hover:border-[var(--primary)]/30 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="text-base font-bold truncate">{p.title}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                        {expired ? "만료됨" : st.label}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] space-y-0.5">
                      <div>📄 문서 {totalCount}건 · 서명 {signedCount}/{totalCount}</div>
                      <div>📨 발송일 {sentDate} · 만료일 {expDate}</div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {canSign ? (
                      <button
                        onClick={() => openSign(p)}
                        className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition"
                      >
                        서명하기 →
                      </button>
                    ) : p.status === "completed" ? (
                      <button
                        onClick={() => openSign(p)}
                        className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl text-sm font-medium hover:text-[var(--text)] transition"
                      >
                        보기
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
