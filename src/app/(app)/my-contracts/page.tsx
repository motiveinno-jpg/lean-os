"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, AppliedChips, QuickSearch, quickSearchHit, quickTerms, Pager, usePager, type AppliedChip } from "@/components/query-kit";
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
  sent: { label: "서명 대기", bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]" },
  partially_signed: { label: "일부 서명", bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]" },
  completed: { label: "서명 완료", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
  cancelled: { label: "취소됨", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]" },
  draft: { label: "준비 중", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]" },
};

// 내게 온 서명 요청 — 모두사인 스타일 인앱 서명 inbox.
export default function MyContractsPage() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const companyId = user?.company_id ?? null;
  const [filter, setFilter] = useState<"pending" | "completed" | "all">("pending");
  //   ── 조회 화면 표준 (2026-08-18 Wave 3) — 갈래 탭·빠른검색·머리단 정렬·쪽 넘김. 확정할 게 없어 SelectionBar 없음 ──
  const [q, setQ] = useState("");
  type MSortKey = "title" | "status" | "docs" | "sent" | "expires";
  const [sort, setSort] = useState<SortState<MSortKey>>({ key: "sent", dir: "desc" });
  const onSort = (k: MSortKey) => setSort((c) => nextSort(c, k, k === "sent" || k === "expires" ? "desc" : "asc"));

  const { data: packages = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["my-contracts", userId, companyId],
    queryFn: async () => {
      const db = supabase;
      // 본인의 employees 레코드 id 먼저 조회
      const emp = logRead('my-contracts/page:emp', await db
        .from("employees")
        .select("id")
        .eq("user_id", userId!)
        .eq("company_id", companyId!)
        .maybeSingle());
      if (!emp) return [];
      const data = logRead('my-contracts/page:data', await db
        .from("hr_contract_packages")
        .select(
          "id, title, status, sign_token, sent_at, expires_at, completed_at, created_at, employees(id, name, user_id), hr_contract_package_items(id, status)",
        )
        .eq("employee_id", emp.id)
        .order("created_at", { ascending: false }));
      return (data || []) as Package[];
    },
    enabled: !!userId && !!companyId,
  });

  const stLabel = (p: Package) => (p.expires_at && new Date(p.expires_at) < new Date()) ? "만료됨" : (STATUS_INFO[p.status] || STATUS_INFO.draft).label;
  const filtered = useMemo(() => {
    let arr = packages;
    if (filter === "pending") arr = arr.filter((p) => ["sent", "partially_signed", "draft"].includes(p.status));
    else if (filter === "completed") arr = arr.filter((p) => p.status === "completed");
    arr = arr.filter((p) => quickSearchHit(q, [p.title, stLabel(p)]));
    const val = (p: Package) => {
      switch (sort.key) {
        case "title": return p.title || ""; case "status": return stLabel(p);
        case "docs": return (p.hr_contract_package_items || []).length; case "expires": return p.expires_at || "";
        default: return p.sent_at || p.created_at || "";
      }
    };
    return [...arr].sort((a, b) => { const c = cmp(val(a), val(b)); return (sort.dir === "asc" ? c : -c) || String(b.created_at).localeCompare(String(a.created_at)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages, filter, q, sort]);
  const pager = usePager(filtered, 50, `${filter}|${q}`);
  const chips: AppliedChip[] = quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) }));

  const counts = useMemo(() => {
    const pending = packages.filter((p) => ["sent", "partially_signed", "draft"].includes(p.status)).length;
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
    <div className="qk-shell">
      {/* ── 조회 화면 표준 — 갈래 탭 · 조회 줄 · 결과 요약 · 표 · 쪽 넘김 (2026-08-18 Wave 3) ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["pending", "대기 중", counts.pending], ["completed", "완료", counts.completed], ["all", "전체", counts.all]] as const).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={filter === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {label}<span className="collect-tab-cnt">{n}</span>
              </button>
            ))}
          </div>
          <QueryBar right={
            <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn-secondary btn-sm">{isFetching ? "갱신 중…" : "새로고침"}</button>
          }>
            <QuickSearch value={q} onApply={setQ} placeholder="제목 · 상태 — 쉼표로 여러 개, Enter" />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={() => setQ("")} />
          <ResultStrip>
            <Stat label="받은 계약서" value={`${filtered.length.toLocaleString("ko")}건`} />
            <Stat label="서명 대기" value={`${counts.pending}건`} tone={counts.pending > 0 ? "minus" : undefined} />
            <span className="text-[10.5px] text-[var(--text-dim)]">회사에서 계약서를 발송하면 여기에 쌓입니다 · 서명하기는 새 탭에서 열립니다</span>
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          {isLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="collect-empty">
              {q ? "이 조건에 맞는 계약서가 없습니다 — 검색을 풀어 보세요"
                : filter === "pending" ? "대기 중인 서명 요청이 없습니다"
                : filter === "completed" ? "완료된 서명이 없습니다" : "받은 계약서가 없습니다"}
            </div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table ev-lined mc-table">
                <thead>
                  <tr>
                    <SortableTh label="제목" sortKey="title" sort={sort} onSort={onSort} />
                    <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} style={{ width: 110 }} />
                    <SortableTh label="문서 · 서명" sortKey="docs" sort={sort} onSort={onSort} style={{ width: 130 }} />
                    <SortableTh label="발송일" sortKey="sent" sort={sort} onSort={onSort} style={{ width: 110 }} />
                    <SortableTh label="만료일" sortKey="expires" sort={sort} onSort={onSort} style={{ width: 110 }} />
                    <SortableTh label="관리" style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((p) => {
                    const st = STATUS_INFO[p.status] || STATUS_INFO.draft;
                    const items = p.hr_contract_package_items || [];
                    const signedCount = items.filter((it) => it.status === "signed").length;
                    const expired = p.expires_at && new Date(p.expires_at) < new Date();
                    const canSign = !expired && ["sent", "partially_signed"].includes(p.status);
                    return (
                      <tr key={p.id}>
                        <td className="ev-ell font-medium">{p.title}</td>
                        <td className="tc"><span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{expired ? "만료됨" : st.label}</span></td>
                        <td className="tc mono-number">{items.length}건 · 서명 {signedCount}/{items.length}</td>
                        <td className="tc mono-number ev-dim">{p.sent_at ? kstDateStr(new Date(p.sent_at)) : "—"}</td>
                        <td className="tc mono-number ev-dim">{p.expires_at ? kstDateStr(new Date(p.expires_at)) : "—"}</td>
                        <td className="tc">
                          {canSign ? <button type="button" onClick={() => openSign(p)} className="btn-primary btn-sm">서명하기 →</button>
                            : p.status === "completed" ? <button type="button" onClick={() => openSign(p)} className="btn-secondary btn-sm">보기</button> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>
        <Pager page={pager.page} pages={pager.pages} total={filtered.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>
    </div>
  );
}
