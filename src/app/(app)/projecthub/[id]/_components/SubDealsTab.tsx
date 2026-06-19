"use client";

// 세부 프로젝트(sub_deals) 탭 — 한 프로젝트(deal) 아래 세부 거래처·금액·매출/매입 타입 관리.
//   RLS: parent_deal_id → deals.company_id 경유 기존 정책 재사용(신규 정책 없음).
//   계획 마진 롤업은 부모 페이지(v_project_margin)에서 표기. 여기선 세부 CRUD + 세부별 계획/실적.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase as any;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type SubDeal = {
  id: string; parent_deal_id: string; name: string; type: string | null;
  contract_amount: number | null; partner_id: string | null;
  status: string | null; start_date: string | null; end_date: string | null;
};
type Partner = { id: string; name: string; business_number: string | null };

const STATUS_OPTS = [
  { v: "estimate", label: "견적" },
  { v: "in_progress", label: "진행" },
  { v: "done", label: "완료" },
  { v: "canceled", label: "취소" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTS.map((s) => [s.v, s.label]));
const emptyForm = () => ({ name: "", type: "purchase", partner_id: "", contract_amount: "", status: "estimate", start_date: "", end_date: "" });

export function SubDealsTab({ dealId, companyId }: { dealId: string; companyId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [ptSearch, setPtSearch] = useState("");
  const [ptOpen, setPtOpen] = useState(false);

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["sub-deals", dealId],
    queryFn: async () => {
      const { data } = await db.from("sub_deals").select("id, parent_deal_id, name, type, contract_amount, partner_id, status, start_date, end_date").eq("parent_deal_id", dealId).order("created_at", { ascending: true });
      return (data || []) as SubDeal[];
    },
    enabled: !!dealId,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["sub-deal-partners", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number").eq("company_id", companyId).order("name");
      return (data || []) as Partner[];
    },
    enabled: !!companyId,
  });
  const partnerName = (id: string | null) => partners.find((p) => p.id === id)?.name || "—";
  const ptMatches = useMemo(() => {
    const t = ptSearch.trim().toLowerCase();
    if (!t) return partners.slice(0, 30);
    const tn = t.replace(/-/g, "");
    return partners.filter((p) => p.name.toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)).slice(0, 200);
  }, [partners, ptSearch]);

  const openCreate = () => { setEditId(null); setForm(emptyForm()); setPtSearch(""); setShowForm(true); };
  const openEdit = (s: SubDeal) => {
    setEditId(s.id);
    setForm({ name: s.name || "", type: s.type || "purchase", partner_id: s.partner_id || "", contract_amount: s.contract_amount != null ? String(s.contract_amount) : "", status: s.status || "estimate", start_date: s.start_date || "", end_date: s.end_date || "" });
    setPtSearch(partnerName(s.partner_id));
    setShowForm(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        parent_deal_id: dealId,
        name: form.name.trim(),
        type: form.type,
        partner_id: form.partner_id || null,
        contract_amount: form.contract_amount === "" ? null : Number(form.contract_amount),
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (!payload.name) throw new Error("세부 프로젝트명을 입력하세요");
      if (editId) {
        const { error } = await db.from("sub_deals").update(payload).eq("id", editId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("sub_deals").insert(payload);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-deals", dealId] });
      qc.invalidateQueries({ queryKey: ["project-margin", dealId] });
      setShowForm(false);
      toast(editId ? "세부 프로젝트를 수정했습니다" : "세부 프로젝트를 추가했습니다", "success");
    },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });
  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("sub_deals").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-deals", dealId] });
      qc.invalidateQueries({ queryKey: ["project-margin", dealId] });
      toast("세부 프로젝트를 삭제했습니다", "info");
    },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });

  const salesSum = subs.filter((s) => s.type === "sales").reduce((a, s) => a + Number(s.contract_amount || 0), 0);
  const purchaseSum = subs.filter((s) => s.type === "purchase").reduce((a, s) => a + Number(s.contract_amount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-[var(--text-muted)]">세부 프로젝트별 거래처·금액·매출/매입을 관리합니다. <span className="text-[var(--text-dim)]">매출형 합 {won(salesSum)} · 매입형 합 {won(purchaseSum)}</span></p>
        <button onClick={openCreate} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 세부 추가</button>
      </div>

      {isLoading ? (
        <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중…</div>
      ) : subs.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">세부 프로젝트가 없습니다. “+ 세부 추가”로 매출/매입 세부를 등록하세요.</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <th className="px-3 py-2.5 text-left text-[12px] font-bold border-b border-[var(--border)]">세부 프로젝트명</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">구분</th>
                <th className="px-3 py-2.5 text-left text-[12px] font-bold border-b border-[var(--border)]">거래처</th>
                <th className="px-3 py-2.5 text-right text-[12px] font-bold border-b border-[var(--border)]">금액</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">기간</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">상태</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">관리</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--bg-surface)]/50">
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40"><button onClick={() => openEdit(s)} className="text-[var(--text)] font-medium hover:text-[var(--primary)] hover:underline text-left">{s.name}</button></td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${s.type === "sales" ? "bg-blue-500/10 text-blue-600" : "bg-orange-500/10 text-orange-600"}`}>{s.type === "sales" ? "매출" : "매입"}</span>
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text)]">{partnerName(s.partner_id)}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{s.contract_amount != null ? Number(s.contract_amount).toLocaleString("ko-KR") : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center text-[11px] text-[var(--text-muted)] whitespace-nowrap">{s.start_date || s.end_date ? `${fmtDate(s.start_date)}~${fmtDate(s.end_date)}` : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{STATUS_LABEL[s.status || ""] || "—"}</span></td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                    <button onClick={() => openEdit(s)} className="px-2 py-1 text-[11px] font-semibold rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">수정</button>
                    <button onClick={() => { if (confirm(`'${s.name}' 세부 프로젝트를 삭제할까요?\n연결된 문서는 프로젝트에 남고 링크만 해제됩니다.`)) delMut.mutate(s.id); }} className="ml-1 px-2 py-1 text-[11px] font-semibold rounded bg-red-500/10 text-red-500 hover:bg-red-500/20">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 추가/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--text)]">{editId ? "세부 프로젝트 수정" : "세부 프로젝트 추가"}</h3>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">세부 프로젝트명 *</label>
                <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="예: 외주 디자인 / 자재 납품"
                  className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">구분</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    <option value="purchase">매입 (줄 돈 · 거래처=매입처)</option>
                    <option value="sales">매출 (받을 돈 · 거래처=고객)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">상태</label>
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]">
                    {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">거래처</label>
                <input value={ptSearch} onChange={(e) => { setPtSearch(e.target.value); setPtOpen(true); setForm((f) => ({ ...f, partner_id: "" })); }} onFocus={() => setPtOpen(true)}
                  placeholder="거래처명·사업자번호 검색"
                  className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                {ptOpen && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg">
                    {ptMatches.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[var(--text-dim)]">검색 결과 없음</div>
                    ) : ptMatches.map((p) => (
                      <button key={p.id} onClick={() => { setForm((f) => ({ ...f, partner_id: p.id })); setPtSearch(p.name); setPtOpen(false); }}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] ${form.partner_id === p.id ? "text-[var(--primary)] font-semibold" : "text-[var(--text)]"}`}>
                        {p.name}{p.business_number ? <span className="text-[11px] text-[var(--text-dim)] ml-1.5">{p.business_number}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">금액 ({form.type === "sales" ? "받을 돈" : "줄 돈"})</label>
                <input value={form.contract_amount} onChange={(e) => setForm((f) => ({ ...f, contract_amount: e.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric" placeholder="0"
                  className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">시작일</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">종료일</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button onClick={() => setShowForm(false)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110">{saveMut.isPending ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
