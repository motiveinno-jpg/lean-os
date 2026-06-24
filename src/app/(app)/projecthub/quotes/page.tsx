"use client";

// 견적서 — 프로젝트와 별개의 독립 견적서 메뉴(프로젝트 토글 하위). 프로젝트의 견적서 탭과 동일 데이터(documents+deal_id).
//   작성 시 기존 프로젝트 선택 또는 신규 프로젝트 생성 → 양쪽(프로젝트 운영/견적서) 연동.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { nextQuoteNumber } from "@/lib/documents";

const db = supabase as any;

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
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString("ko-KR") : "—");

export default function QuotesPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes-list", companyId],
    queryFn: async () => {
      const { data } = await db.from("documents")
        .select("id, name, status, content_type, contract_amount, created_at, deal_id, document_number, deals(name)")
        .eq("company_id", companyId)
        .in("content_type", ["invoice", "quote"])
        .order("created_at", { ascending: false }).limit(300);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-2xl font-extrabold">견적서</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">프로젝트와 연동된 견적서를 한곳에서 작성·관리합니다. 작성 시 기존 프로젝트를 고르거나 새 프로젝트를 만들 수 있습니다.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 shrink-0">+ 견적서 작성</button>
      </div>

      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : quotes.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-3">🧾</div>
            <div className="text-sm font-medium text-[var(--text)]">아직 견적서가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">“+ 견적서 작성”으로 첫 견적서를 만들어 보세요.</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 760 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="px-3 py-2.5 text-left font-semibold w-[130px]">견적No.</th>
                  <th className="px-3 py-2.5 text-left font-semibold border-l border-[var(--border)]/50">견적서명</th>
                  <th className="px-3 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 w-[180px]">프로젝트</th>
                  <th className="px-3 py-2.5 text-right font-semibold border-l border-[var(--border)]/50 w-[120px]">금액</th>
                  <th className="px-3 py-2.5 text-center font-semibold border-l border-[var(--border)]/50 w-[90px]">상태</th>
                  <th className="px-3 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 w-[110px]">작성일</th>
                  <th className="px-3 py-2.5 text-center font-semibold border-l border-[var(--border)]/50 w-[90px]">관리</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50">
                    <td className="px-3 py-2 mono-number text-[var(--text-muted)] text-[11px]">{q.document_number || fmtDate(q.created_at)}</td>
                    <td className="px-3 py-2 text-[var(--text)] font-medium border-l border-[var(--border)]/30">{q.name || "(이름 없음)"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">
                      {q.deal_id ? <Link href={`/projecthub/${q.deal_id}`} className="text-[var(--primary)] hover:underline">{q.deals?.name || "프로젝트"}</Link> : "—"}
                    </td>
                    <td className="px-3 py-2 text-right mono-number border-l border-[var(--border)]/30">{q.contract_amount != null ? won(q.contract_amount) : "—"}</td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{q.status || "draft"}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/30 text-[11px]">{fmtDate(q.created_at)}</td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <Link href={`/documents?id=${q.id}`} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">열기/편집 →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
      const { data } = await db.from("deals").select("id, name").eq("company_id", companyId).neq("status", "archived").order("created_at", { ascending: false });
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

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">견적서 작성</h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        {/* 프로젝트 모드 */}
        <div className="flex gap-2 mb-3">
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

        <div className="flex items-center justify-end gap-2.5 mt-5">
          <button onClick={onClose} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
          <button onClick={create} disabled={busy} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110">{busy ? "생성 중..." : "생성 후 작성"}</button>
        </div>
      </div>
    </div>
  );
}
