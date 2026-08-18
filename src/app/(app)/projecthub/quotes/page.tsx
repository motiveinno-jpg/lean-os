"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 견적서 — 프로젝트와 별개의 독립 견적서 메뉴(프로젝트 토글 하위). 프로젝트의 견적서 탭과 동일 데이터(documents+deal_id).
//   작성 시 기존 프로젝트 선택 또는 신규 프로젝트 생성 → 양쪽(프로젝트 운영/견적서) 연동.
import { useMemo, useState } from "react";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup, AppliedChips, QuickSearch, quickSearchHit, quickTerms,
  Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { nextQuoteNumber, DOC_STATUS } from "@/lib/documents";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase;

// 견적서 기본 구조 (프로젝트 견적서 탭과 동일)
const QUOTE_CONTENT = {
  title: "견적서",
  sections: [
    { title: "견적 정보", content: "공급자: {{회사명}} (대표: {{대표자명}})\n수신: {{거래처명}}\n견적일자: {{견적일자}}\n유효기간: {{유효기간}}" },
    { title: "견적 품목", content: "[품목 테이블]" },
    { title: "거래 조건", content: "납품 조건: {{납품조건}}\n결제 조건: {{결제조건}}" },
    { title: "비고", content: "1. 본 견적서의 유효기간은 견적일로부터 {{유효기간}}입니다.\n2. 기타 문의사항은 담당자에게 연락 바랍니다." },
  ],
};

const won = (n: any) => `₩${(Number(n) || 0).toLocaleString("ko")}`;
const fmtDate = (s?: string) => (s ? kstDateStr(new Date(s)) : "—");

export default function QuotesPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  //   ── 조회 화면 표준 (2026-08-18 Wave 3) — 상태 칩·빠른검색·머리단 정렬·쪽 넘김. 조건이 둘뿐이라 검색조건 패널은 없다 ──
  const [q, setQ] = useState("");
  const [st, setSt] = useState<string>("all");
  type QSortKey = "no" | "name" | "deal" | "amount" | "status" | "date";
  const [sort, setSort] = useState<SortState<QSortKey>>({ key: "date", dir: "desc" });
  const onSort = (k: QSortKey) => setSort((c) => nextSort(c, k, k === "date" ? "desc" : "asc"));

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes-list", companyId],
    queryFn: async () => {
      const data = logRead('quotes/page:data', await db.from("documents")
        .select("id, name, status, content_type, contract_amount, created_at, deal_id, document_number, deals(name)")
        .eq("company_id", companyId ?? "")
        .in("content_type", ["invoice", "quote"])
        .order("created_at", { ascending: false }).limit(300));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const statusLabel = (x: any) => (DOC_STATUS as any)[x.status]?.label || DOC_STATUS.draft.label;
  const statusOpts = useMemo(() => [{ value: "all", label: "전체" }, ...[...new Set((quotes as any[]).map(statusLabel))].map((v) => ({ value: v, label: v }))], [quotes]);
  const shown = useMemo(() => {
    const arr = (quotes as any[]).filter((x) => (st === "all" || statusLabel(x) === st) &&
      quickSearchHit(q, [x.name, x.deals?.name, x.document_number], [Number(x.contract_amount || 0)]));
    const val = (x: any) => {
      switch (sort.key) {
        case "no": return x.document_number || ""; case "name": return x.name || ""; case "deal": return x.deals?.name || "";
        case "amount": return Number(x.contract_amount || 0); case "status": return statusLabel(x); default: return x.created_at || "";
      }
    };
    arr.sort((a, b) => { const c = cmp(val(a), val(b)); return (sort.dir === "asc" ? c : -c) || String(b.created_at || "").localeCompare(String(a.created_at || "")); });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, q, st, sort]);
  const pager = usePager(shown, 50, `${q}|${st}`);
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...(st !== "all" ? [{ group: "상태", label: st, onRemove: () => setSt("all") }] : []),
  ];

  return (
    <div className="qk-shell quotes-page">
      {/* ── 조회 화면 표준 — 조회 줄 · 걸린 조건 · 결과 요약 · 표 · 쪽 넘김 (2026-08-18 Wave 3) ── */}
      <QueryScreen>
        <QueryHead>
          <QueryBar right={<button type="button" onClick={() => setShowCreate(true)} className="btn-primary btn-sm">+ 견적서 작성</button>}>
            <QuickSearch value={q} onApply={setQ} placeholder="견적서명 · 프로젝트 · 견적No. · 금액 — 쉼표로 여러 개, Enter" />
            <ChipGroup value={st} onChange={setSt} options={statusOpts} />
          </QueryBar>
          <AppliedChips chips={chips} onClearAll={() => { setQ(""); setSt("all"); }} />
          <ResultStrip>
            <Stat label="견적서" value={`${shown.length.toLocaleString("ko")}건`} />
            <Stat label="금액 합계" value={won(shown.reduce((s0, x) => s0 + Number(x.contract_amount || 0), 0))} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          {isLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : quotes.length === 0 ? (
            <div className="collect-empty">아직 견적서가 없습니다 — 오른쪽 위 [+ 견적서 작성]으로 첫 견적서를 만들어 보세요</div>
          ) : shown.length === 0 ? (
            <div className="collect-empty">이 조건에 맞는 견적서가 없습니다 — 검색·상태를 풀어 보세요</div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table ev-lined quotes-table">
                <thead>
                  <tr>
                    <SortableTh label="견적No." sortKey="no" sort={sort} onSort={onSort} style={{ width: 130 }} />
                    <SortableTh label="견적서명" sortKey="name" sort={sort} onSort={onSort} />
                    <SortableTh label="프로젝트" sortKey="deal" sort={sort} onSort={onSort} style={{ width: 200 }} />
                    <SortableTh label="금액" sortKey="amount" sort={sort} onSort={onSort} style={{ width: 130 }} />
                    <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} style={{ width: 96 }} />
                    <SortableTh label="작성일" sortKey="date" sort={sort} onSort={onSort} style={{ width: 110 }} />
                    <SortableTh label="관리" style={{ width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((x) => (
                    <tr key={x.id} className="quotes-row">
                      <td className="mono-number ev-dim">{x.document_number || fmtDate(x.created_at)}</td>
                      <td className="ev-ell font-medium">{x.name || "(이름 없음)"}</td>
                      <td className="ev-ell ev-dim">
                        {x.deal_id ? <Link href={`/projecthub/${x.deal_id}`} className="text-[var(--primary)] hover:underline">{x.deals?.name || "프로젝트"}</Link> : "—"}
                      </td>
                      <td className="tr mono-number">{x.contract_amount != null ? won(x.contract_amount) : "—"}</td>
                      <td className="tc">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{statusLabel(x)}</span>
                      </td>
                      <td className="tc ev-dim mono-number">{fmtDate(x.created_at)}</td>
                      <td className="tc">
                        <Link href={`/documents?id=${x.id}`} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">열기/편집 →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>
        <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>

      {showCreate && companyId && userId && (
        <CreateQuoteModal
          companyId={companyId} userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={(docId) => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["quotes-list"] }); router.push(`/documents?id=${docId}`); }}
          toastFn={toast}
        />
      )}
    </div>
  );
}

// 견적서 작성 모달 — 기존 프로젝트 선택 또는 신규 프로젝트 생성
function CreateQuoteModal({ companyId, userId, onClose, onCreated, toastFn }: {
  companyId: string; userId: string; onClose: () => void; onCreated: (docId: string) => void; toastFn: (m: string, t?: any) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [dealId, setDealId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: deals = [] } = useQuery({
    queryKey: ["quotes-deals", companyId],
    queryFn: async () => {
      const data = logRead('quotes/page:data', await db.from("deals").select("id, name").eq("company_id", companyId ?? "").neq("status", "archived").order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let useDealId = dealId;
      let projectLabel = deals.find((d) => d.id === dealId)?.name || "";
      // 신규 프로젝트 생성
      if (mode === "new") {
        const pname = newProjectName.trim();
        if (!pname) { toastFn("새 프로젝트명을 입력하세요", "error"); setBusy(false); return; }
        const { data: deal, error: de } = await db.from("deals").insert({
          company_id: companyId, name: pname, status: "active", stage: "estimate", classification: "B2B", contract_total: 0,
        }).select("id, name").single();
        if (de) throw new Error(de.message);
        useDealId = deal.id; projectLabel = deal.name;
      }
      if (!useDealId) { toastFn("프로젝트를 선택하거나 새로 만드세요", "error"); setBusy(false); return; }
      // 견적서 문서 생성 (deal 연결)
      const name = quoteName.trim() || `${projectLabel || "프로젝트"} 견적서`;
      const { data: doc, error: ce } = await db.from("documents").insert({
        company_id: companyId, deal_id: useDealId, name, status: "draft",
        document_number: await nextQuoteNumber(companyId),
        content_type: "invoice", content_json: QUOTE_CONTENT, version: 1, created_by: userId,
      }).select("id").single();
      if (ce) throw new Error(ce.message);
      toastFn("견적서를 생성했습니다", "success");
      onCreated(doc.id);
    } catch (e: any) {
      toastFn(e?.message || "견적서 생성 실패", "error");
      setBusy(false);
    }
  };

  useModalKeys(true, onClose, busy ? undefined : create);

  return (
    <div className="quote-create-modal-overlay fixed inset-0">
      <div className="quote-create-modal" onClick={(e) => e.stopPropagation()}>
        <div className="quote-create-modal-header">
          <h3 className="text-base font-bold">견적서 작성</h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        {/* 프로젝트 모드 */}
        <div className="quote-create-mode-toggle">
          <button onClick={() => setMode("existing")} className={`flex-1 h-9 rounded-lg text-xs font-semibold border transition ${mode === "existing" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>기존 프로젝트</button>
          <button onClick={() => setMode("new")} className={`flex-1 h-9 rounded-lg text-xs font-semibold border transition ${mode === "new" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>새 프로젝트</button>
        </div>

        {mode === "existing" ? (
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">프로젝트 선택</label>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}
              className="w-full h-11 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
              <option value="">프로젝트를 선택하세요</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">새 프로젝트명</label>
            <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} autoFocus
              placeholder="예: 2026 온라인홍보 프로젝트"
              className="w-full h-11 px-3.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            <p className="text-[11px] text-[var(--text-dim)] mt-1">새 프로젝트가 생성되어 프로젝트 운영 메뉴에도 함께 나타납니다.</p>
          </div>
        )}

        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">견적서명</label>
        <input value={quoteName} onChange={(e) => setQuoteName(e.target.value)} placeholder="비우면 프로젝트명 + 견적서"
          className="w-full h-11 px-3.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />

        <div className="quote-create-modal-footer">
          <button onClick={onClose} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
          <button onClick={create} disabled={busy} className="btn-primary">{busy ? "생성 중..." : "생성 후 작성"}</button>
        </div>
      </div>
    </div>
  );
}
