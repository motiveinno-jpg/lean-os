"use client";

// 매출·매입 항목(sub_deals) 탭 — 한 프로젝트(deal) 아래 거래 항목별 거래처·금액·매출/매입 타입 관리.
//   ※ '세부 프로젝트(캠페인)'(자식 deals)와는 별개 개념 — 여긴 금액 항목만. UI 명칭도 '항목'으로 구분.
//   RLS: parent_deal_id → deals.company_id 경유 기존 정책 재사용(신규 정책 없음).
//   약정 마진 롤업은 부모 페이지(v_project_margin)에서 표기. 여기선 항목 CRUD + 항목별 약정/실적.

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase as any;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type SubDeal = {
  id: string; parent_deal_id: string; name: string; type: string | null;
  contract_amount: number | null; partner_id: string | null; vat_type: string | null;
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
// 금액은 '입력한 총액' 그대로 저장하고 vat_type(포함/별도) 플래그를 함께 저장. 마진은 뷰에서 net 역산.
const emptyForm = () => ({ name: "", type: "purchase", partner_id: "", contract_amount: "", status: "estimate", start_date: "", end_date: "", vat_type: "exclude" as "exclude" | "include" });

export function SubDealsTab({ dealId, companyId, direction, campaignInherit }: {
  dealId: string; companyId: string | null; direction?: "sales" | "purchase";
  // 상위(최상위) 프로젝트의 파이프라인 탭에서만 전달 — 항목 추가 시 '세부 프로젝트(캠페인)로도 생성' 옵션 활성화 + 상속 필드.
  campaignInherit?: { partnerId: string | null; managerId: string | null; classification: string | null } | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [ptSearch, setPtSearch] = useState("");
  const [ptOpen, setPtOpen] = useState(false);
  const [asCampaign, setAsCampaign] = useState(false);

  // 파이프라인(방향) 탭에서는 세부 프로젝트(캠페인) 소속 항목도 함께 표시 — 개요 롤업과 동일한 시야.
  const { data: childDeals = [] } = useQuery({
    queryKey: ["sub-deals-children", dealId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("id, name").eq("parent_deal_id", dealId).is("archived_at", null);
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!dealId && !!direction,
  });
  const childIdsKey = direction ? childDeals.map((c) => c.id).join(",") : "";
  const childNameById = useMemo(() => Object.fromEntries(childDeals.map((c) => [c.id, c.name])), [childDeals]);

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["sub-deals", dealId, childIdsKey],
    queryFn: async () => {
      const parentIds = direction ? [dealId, ...childDeals.map((c) => c.id)] : [dealId];
      const { data } = await db.from("sub_deals").select("id, parent_deal_id, name, type, contract_amount, partner_id, vat_type, status, start_date, end_date").in("parent_deal_id", parentIds).order("created_at", { ascending: true });
      return (data || []) as SubDeal[];
    },
    enabled: !!dealId,
  });
  // 세부별 실적원가 (전표 sub_deal_id 귀속분) — v_sub_deal_pnl
  const { data: pnlRows = [] } = useQuery({
    queryKey: ["sub-deal-pnl", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_sub_deal_pnl").select("sub_deal_id, actual_cost").eq("deal_id", dealId);
      return (data || []) as { sub_deal_id: string; actual_cost: number }[];
    },
    enabled: !!dealId,
  });
  const actualCost = (id: string) => Number(pnlRows.find((r) => r.sub_deal_id === id)?.actual_cost || 0);
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

  const openCreate = () => { setEditId(null); setForm({ ...emptyForm(), type: direction ?? emptyForm().type }); setPtSearch(""); setAsCampaign(!!campaignInherit); setShowForm(true); };
  const openEdit = (s: SubDeal) => {
    setEditId(s.id);
    // 저장값은 입력한 총액 그대로 → vat_type 플래그를 그대로 복원
    setForm({ name: s.name || "", type: s.type || "purchase", partner_id: s.partner_id || "", contract_amount: s.contract_amount != null ? String(s.contract_amount) : "", status: s.status || "estimate", start_date: s.start_date || "", end_date: s.end_date || "", vat_type: s.vat_type === "inclusive" ? "include" : "exclude" });
    setPtSearch(partnerName(s.partner_id));
    setShowForm(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("항목명을 입력하세요");
      // '캠페인으로도 생성' — 같은 이름의 세부 프로젝트(자식 deal)를 만들고 항목을 그 소속으로 저장.
      //   상단 '세부 프로젝트(캠페인)' 탭에 표시되고, 금액은 캠페인 롤업으로 1회만 집계됨(중복 없음).
      let ownerDealId = dealId;
      let madeCampaign = false;
      if (!editId && asCampaign && campaignInherit && companyId) {
        const { data: child, error: cErr } = await db.from("deals").insert({
          company_id: companyId, parent_deal_id: dealId, name: form.name.trim(),
          status: "active", stage: "estimate",
          partner_id: form.partner_id || campaignInherit.partnerId || null,
          internal_manager_id: campaignInherit.managerId || null,
          classification: campaignInherit.classification || null,
          start_date: form.start_date || null, end_date: form.end_date || null,
        }).select("id").single();
        if (cErr) throw new Error(cErr.message);
        ownerDealId = child.id;
        madeCampaign = true;
      }
      const payload = {
        parent_deal_id: ownerDealId,
        name: form.name.trim(),
        type: form.type,
        partner_id: form.partner_id || null,
        // 입력한 총액 그대로 저장 + vat_type 플래그(마진은 뷰에서 net 역산).
        contract_amount: form.contract_amount === "" ? null : Number(form.contract_amount),
        vat_type: form.vat_type === "include" ? "inclusive" : "exclusive",
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (editId) {
        const { error } = await db.from("sub_deals").update(payload).eq("id", editId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("sub_deals").insert(payload);
        if (error) throw new Error(error.message);
      }
      return { madeCampaign };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sub-deals", dealId] });
      qc.invalidateQueries({ queryKey: ["project-margin", dealId] });
      if (r?.madeCampaign) {
        // 캠페인 목록·개요 롤업·프로젝트 목록 배지 갱신
        qc.invalidateQueries({ queryKey: ["sub-deals-children", dealId] });
        qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
        qc.invalidateQueries({ queryKey: ["projecthub-subdeals-roll", dealId] });
        qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      }
      setShowForm(false);
      toast(editId ? "항목을 수정했습니다" : r?.madeCampaign ? "항목을 추가하고 세부 프로젝트(캠페인)로도 생성했습니다" : "항목을 추가했습니다", "success");
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
      toast("항목을 삭제했습니다", "info");
    },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });

  const salesSum = subs.filter((s) => s.type === "sales").reduce((a, s) => a + Number(s.contract_amount || 0), 0);
  const purchaseSum = subs.filter((s) => s.type === "purchase").reduce((a, s) => a + Number(s.contract_amount || 0), 0);
  // 방향 지정 시 그 방향만 표시(파이프라인 탭). 없으면 전체.
  const shown = direction ? subs.filter((s) => s.type === direction) : subs;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 매출·매입 항목(거래처·금액)을 관리합니다. 세부 프로젝트(캠페인)와는 별개입니다. <span className="text-[var(--text-dim)]">매출 합 {won(salesSum)} · 매입 합 {won(purchaseSum)}</span></p>
        <button onClick={openCreate} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 항목 추가</button>
      </div>

      {isLoading ? (
        <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">{direction === "sales" ? "매출" : direction === "purchase" ? "매입" : "매출/매입"} 항목이 없습니다. “+ 항목 추가”로 등록하세요.</div>
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <th className="px-3 py-2.5 text-left text-[12px] font-bold border-b border-[var(--border)]">항목명</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">구분</th>
                <th className="px-3 py-2.5 text-left text-[12px] font-bold border-b border-[var(--border)]">거래처</th>
                <th className="px-3 py-2.5 text-right text-[12px] font-bold border-b border-[var(--border)]">금액</th>
                <th className="px-3 py-2.5 text-right text-[12px] font-bold border-b border-[var(--border)]">실적원가</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">기간</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">상태</th>
                <th className="px-3 py-2.5 text-center text-[12px] font-bold border-b border-[var(--border)]">관리</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--bg-surface)]/50">
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40">
                    <button onClick={() => openEdit(s)} className="text-[var(--text)] font-medium hover:text-[var(--primary)] hover:underline text-left">{s.name}</button>
                    {s.parent_deal_id !== dealId && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] whitespace-nowrap" title="세부 프로젝트(캠페인) 소속 항목">📁 {childNameById[s.parent_deal_id] || "캠페인"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${s.type === "sales" ? "bg-blue-500/10 text-blue-600" : "bg-orange-500/10 text-orange-600"}`}>{s.type === "sales" ? "매출" : "매입"}</span>
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text)]">{partnerName(s.partner_id)}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{s.contract_amount != null ? Number(s.contract_amount).toLocaleString("ko-KR") : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text-muted)]" title="전표에서 이 항목으로 귀속한 비용계정 실적">{actualCost(s.id) ? Number(actualCost(s.id)).toLocaleString("ko-KR") : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center text-[11px] text-[var(--text-muted)] whitespace-nowrap">{s.start_date || s.end_date ? `${fmtDate(s.start_date)}~${fmtDate(s.end_date)}` : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{STATUS_LABEL[s.status || ""] || "—"}</span></td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                    <button onClick={() => openEdit(s)} className="px-2 py-1 text-[11px] font-semibold rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">수정</button>
                    <button onClick={() => { if (confirm(`'${s.name}' 항목을 삭제할까요?\n연결된 문서는 프로젝트에 남고 링크만 해제됩니다.`)) delMut.mutate(s.id); }} className="ml-1 px-2 py-1 text-[11px] font-semibold rounded bg-red-500/10 text-red-500 hover:bg-red-500/20">삭제</button>
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
              <h3 className="text-base font-bold text-[var(--text)]">{editId ? "매출·매입 항목 수정" : "매출·매입 항목 추가"}</h3>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">항목명 *</label>
                <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="예: 외주 디자인 / 자재 납품"
                  className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">구분{direction ? <span className="ml-1 text-[10px] text-[var(--text-dim)]">· {direction === "sales" ? "매출" : "매입"} 탭 고정</span> : null}</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    disabled={!!direction}
                    className={`w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] ${direction ? "opacity-70 cursor-not-allowed" : ""}`}>
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
                <div className="flex gap-1.5">
                  <input value={form.contract_amount} onChange={(e) => setForm((f) => ({ ...f, contract_amount: e.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric" placeholder="0"
                    className="flex-1 h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)]" />
                  <select value={form.vat_type} onChange={(e) => setForm((f) => ({ ...f, vat_type: e.target.value as "exclude" | "include" }))}
                    className="px-2 h-10 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]">
                    <option value="exclude">VAT 별도</option>
                    <option value="include">VAT 포함</option>
                  </select>
                </div>
                {form.contract_amount !== "" && form.vat_type === "include" && (
                  <p className="text-[11px] text-[var(--text-dim)] mt-1 text-right">
                    총액 {Number(form.contract_amount).toLocaleString("ko-KR")}원 저장 · 마진은 공급가액 {Math.round(Number(form.contract_amount) / 1.1).toLocaleString("ko-KR")}원 기준
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">시작일</label>
                  <DateField value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">종료일</label>
                  <DateField value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    className="w-full h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
                </div>
              </div>
              {!editId && campaignInherit && (
                <label className="flex items-start gap-2 text-xs text-[var(--text-muted)] cursor-pointer pt-1">
                  <input type="checkbox" checked={asCampaign} onChange={(e) => setAsCampaign(e.target.checked)} className="accent-[var(--primary)] mt-0.5" />
                  <span>세부 프로젝트(캠페인)로도 생성 <span className="text-[var(--text-dim)]">— 상단 ‘세부 프로젝트(캠페인)’ 탭에 같은 이름으로 표시되고, 항목은 그 캠페인 소속이 됩니다</span></span>
                </label>
              )}
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
