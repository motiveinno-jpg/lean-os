"use client";
import { logRead } from "@/lib/log-read";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// 내 근로계약서 — /my-contracts 의 서명 inbox 를 마이페이지용으로 압축.
//   개인 인사기록 허브(2026-07-15): 나에게 온 계약서/서명 요청을 마이페이지에서 바로 확인·서명.
const STATUS_INFO: Record<string, { label: string; bg: string; text: string }> = {
  sent: { label: "서명 대기", bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]" },
  partially_signed: { label: "일부 서명", bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]" },
  completed: { label: "서명 완료", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
  cancelled: { label: "취소됨", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]" },
  draft: { label: "준비 중", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]" },
};

export function MyContractsCard({ employeeId }: { employeeId: string | null }) {
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["mypage-contracts", employeeId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('_components/MyContractsCard:data', await db
        .from("hr_contract_packages")
        .select("id, title, status, sign_token, sent_at, expires_at, completed_at, created_at, hr_contract_package_items(id, status)")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!employeeId,
  });

  const pendingCount = useMemo(
    () => packages.filter((p) => ["sent", "partially_signed"].includes(p.status)).length,
    [packages],
  );

  function openSign(pkg: any) {
    if (!pkg.sign_token) return;
    window.open(`/sign?token=${pkg.sign_token}`, "_blank", "noopener");
  }

  return (
    <div className="mypage-contracts-card glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">내 근로계약서</h2>
        {pendingCount > 0 && (
          <span className="badge bg-[var(--warning-dim)] text-[var(--warning)]">서명 대기 {pendingCount}</span>
        )}
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">불러오는 중...</div>
      ) : packages.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-3xl mb-2">📄</div>
          <div className="text-sm font-semibold text-[var(--text-muted)]">받은 계약서가 없습니다</div>
          <div className="text-xs text-[var(--text-dim)] mt-1">회사에서 계약서를 발송하면 이곳에 표시됩니다.</div>
        </div>
      ) : (
        <div className="mypage-contracts-list space-y-2.5">
          {packages.map((p) => {
            const st = STATUS_INFO[p.status] || STATUS_INFO.draft;
            const items = p.hr_contract_package_items || [];
            const signedCount = items.filter((it: any) => it.status === "signed").length;
            const totalCount = items.length;
            const expired = p.expires_at && new Date(p.expires_at) < new Date();
            const canSign = !expired && ["sent", "partially_signed"].includes(p.status);
            const sentDate = p.sent_at ? new Date(p.sent_at).toLocaleDateString("ko-KR") : "—";
            return (
              <div key={p.id} className="mypage-contract-row flex items-center justify-between gap-3 bg-[var(--bg-surface)] rounded-xl px-4 py-3 border border-[var(--border)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-semibold truncate">{p.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{expired ? "만료됨" : st.label}</span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">문서 {totalCount}건 · 서명 {signedCount}/{totalCount} · 발송 {sentDate}</div>
                </div>
                {canSign ? (
                  <button onClick={() => openSign(p)} className="btn-primary btn-sm shrink-0">서명하기 →</button>
                ) : p.status === "completed" ? (
                  <button onClick={() => openSign(p)} className="btn-secondary btn-sm shrink-0">보기</button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
