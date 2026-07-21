"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// 거래 원장 — 한 프로젝트(deal)의 매출·매입 항목을 부호 기반 단일 리스트로 관리(2026-07 개편).
//   양수(+)=매출(받을 돈) · 음수(−)=매입(줄 돈). 저장은 기존 type(sales/purchase)+양수 금액 유지
//   (마진 엔진·기존 데이터 안전). 모달 없이 표에서 인라인으로 추가·수정.
//   ※ '세부 프로젝트(캠페인)'(자식 deals)와는 별개 — 여긴 금액 항목만.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;

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

// 인라인 행 입력 상태 — sign(부호)로 매출/매입 표현, 저장 시 type 으로 변환.
type Draft = { name: string; sign: "plus" | "minus"; amount: string; partner_id: string; ptSearch: string; vat: "exclude" | "include"; status: string; asCampaign: boolean };
const emptyDraft = (sign: "plus" | "minus" = "plus"): Draft => ({ name: "", sign, amount: "", partner_id: "", ptSearch: "", vat: "exclude", status: "estimate", asCampaign: false });

export function SubDealsTab({ dealId, companyId, direction, campaignInherit }: {
  dealId: string; companyId: string | null; direction?: "sales" | "purchase";
  // 상위(최상위) 프로젝트에서만 전달 — 항목 추가 시 '세부 프로젝트(캠페인)로도 생성' 옵션.
  campaignInherit?: { partnerId: string | null; managerId: string | null; classification: string | null } | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft(direction === "purchase" ? "minus" : "plus"));
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());

  // 캠페인(자식 deal) 소속 항목도 함께 표시 — 개요 롤업과 동일 시야.
  const { data: childDeals = [] } = useQuery({
    queryKey: ["sub-deals-children", dealId],
    queryFn: async () => {
      const data = logRead('_components/SubDealsTab:data', await db.from("deals").select("id, name").eq("parent_deal_id", dealId).is("archived_at", null));
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!dealId,
  });
  const childIdsKey = childDeals.map((c) => c.id).join(",");
  const childNameById = useMemo(() => Object.fromEntries(childDeals.map((c) => [c.id, c.name])), [childDeals]);

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["sub-deals", dealId, childIdsKey],
    queryFn: async () => {
      const parentIds = [dealId, ...childDeals.map((c) => c.id)];
      const data = logRead('_components/SubDealsTab:data', await db.from("sub_deals").select("id, parent_deal_id, name, type, contract_amount, partner_id, vat_type, status, start_date, end_date").in("parent_deal_id", parentIds).order("created_at", { ascending: true }));
      return (data || []) as SubDeal[];
    },
    enabled: !!dealId,
  });
  const { data: pnlRows = [] } = useQuery({
    queryKey: ["sub-deal-pnl", dealId],
    queryFn: async () => {
      const data = logRead('_components/SubDealsTab:data', await db.from("v_sub_deal_pnl").select("sub_deal_id, actual_cost").eq("deal_id", dealId));
      return (data || []) as { sub_deal_id: string; actual_cost: number }[];
    },
    enabled: !!dealId,
  });
  const actualCost = (id: string) => Number(pnlRows.find((r) => r.sub_deal_id === id)?.actual_cost || 0);
  const { data: partners = [] } = useQuery({
    queryKey: ["sub-deal-partners", companyId],
    queryFn: async () => {
      const data = logRead('_components/SubDealsTab:data', await db.from("partners").select("id, name, business_number").eq("company_id", companyId ?? "").order("name"));
      return (data || []) as Partner[];
    },
    enabled: !!companyId,
  });
  const partnerName = (id: string | null) => partners.find((p) => p.id === id)?.name || "—";

  // 저장 payload — 부호 → type, 절대값 → 금액.
  const buildPayload = (d: Draft, ownerDealId: string) => ({
    parent_deal_id: ownerDealId,
    name: d.name.trim(),
    type: d.sign === "minus" ? "purchase" : "sales",
    partner_id: d.partner_id || null,
    contract_amount: d.amount === "" ? null : Number(d.amount),
    vat_type: d.vat === "include" ? "inclusive" : "exclusive",
    status: d.status,
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("항목명을 입력하세요");
      let ownerDealId = dealId;
      let madeCampaign = false;
      if (draft.asCampaign && campaignInherit && companyId) {
        const { data: child, error: cErr } = await db.from("deals").insert({
          company_id: companyId, parent_deal_id: dealId, name: draft.name.trim(), status: "active", stage: "estimate",
          partner_id: draft.partner_id || campaignInherit.partnerId || null,
          internal_manager_id: campaignInherit.managerId || null, classification: campaignInherit.classification || null,
        }).select("id").single();
        if (cErr) throw new Error(cErr.message);
        ownerDealId = child.id; madeCampaign = true;
      }
      const { error } = await db.from("sub_deals").insert(buildPayload(draft, ownerDealId));
      if (error) throw new Error(error.message);
      return { madeCampaign };
    },
    onSuccess: (r) => {
      invalidate(r?.madeCampaign);
      setDraft(emptyDraft(draft.sign));
      toast(r?.madeCampaign ? "항목을 추가하고 세부 프로젝트(캠페인)로도 생성했습니다" : "항목을 추가했습니다", "success");
    },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });
  const editMut = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      if (!editDraft.name.trim()) throw new Error("항목명을 입력하세요");
      const { error } = await db.from("sub_deals").update(buildPayload(editDraft, editId ? (subs.find((s) => s.id === editId)?.parent_deal_id || dealId) : dealId)).eq("id", editId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { invalidate(); setEditId(null); toast("항목을 수정했습니다", "success"); },
    onError: (e: any) => toast(e?.message || "수정 실패", "error"),
  });
  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("sub_deals").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { invalidate(); toast("항목을 삭제했습니다", "info"); },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });
  const invalidate = (madeCampaign?: boolean) => {
    qc.invalidateQueries({ queryKey: ["sub-deals", dealId] });
    qc.invalidateQueries({ queryKey: ["project-margin", dealId] });
    qc.invalidateQueries({ queryKey: ["projecthub-subdeals-roll", dealId] });
    if (madeCampaign) {
      qc.invalidateQueries({ queryKey: ["sub-deals-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
    }
  };

  // 방향 지정(레거시 파이프라인 탭)이면 그 타입만, 아니면 전체.
  const shown = direction ? subs.filter((s) => s.type === direction) : subs;
  const salesSum = subs.filter((s) => s.type === "sales").reduce((a, s) => a + Number(s.contract_amount || 0), 0);
  const purchaseSum = subs.filter((s) => s.type === "purchase").reduce((a, s) => a + Number(s.contract_amount || 0), 0);
  const margin = salesSum - purchaseSum;

  const startEdit = (s: SubDeal) => {
    setEditId(s.id);
    setEditDraft({
      name: s.name || "", sign: s.type === "purchase" ? "minus" : "plus",
      amount: s.contract_amount != null ? String(s.contract_amount) : "",
      partner_id: s.partner_id || "", ptSearch: partnerName(s.partner_id),
      vat: s.vat_type === "inclusive" ? "include" : "exclude", status: s.status || "estimate", asCampaign: false,
    });
  };

  return (
    <div className="transactions-ledger">
      <div className="subdeals-toolbar">
        <p className="text-xs text-[var(--text-muted)]">
          매출·매입 항목을 <b className="text-[var(--text)]">부호</b>로 구분합니다 — <span className="text-[var(--success)]">양수(+) 매출</span> · <span className="text-[var(--danger)]">음수(−) 매입</span>. 표에서 바로 입력하세요.
        </p>
      </div>

      <div className="subdeals-table-wrap glass-card">
        <table className="w-full text-sm border-collapse min-w-[720px]">
          <thead>
            <tr className="text-xs text-[var(--text-dim)]">
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold border-b border-[var(--border)]">항목명</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold border-b border-[var(--border)] w-[180px]">거래처</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold border-b border-[var(--border)] w-[160px]">금액 (±)</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold border-b border-[var(--border)] w-[110px]">실적원가</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[90px]">상태</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold border-b border-[var(--border)] w-[110px]">관리</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">불러오는 중…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-sm text-[var(--text-muted)]">항목이 없습니다. 아래 줄에 바로 입력하세요.</td></tr>
            ) : shown.map((s) => {
              const amt = Number(s.contract_amount || 0);
              const isPurchase = s.type === "purchase";
              if (editId === s.id) return (
                <tr key={s.id} className="subdeals-row-editing">
                  <RowInputs draft={editDraft} setDraft={setEditDraft} partners={partners} onEnter={() => editMut.mutate()} />
                  <td className="px-2 py-2 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                    <button onClick={() => editMut.mutate()} disabled={editMut.isPending} className="px-2 py-1 text-[11px] font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-50">저장</button>
                    <button onClick={() => setEditId(null)} className="ml-1 px-2 py-1 text-[11px] rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)]">취소</button>
                  </td>
                </tr>
              );
              return (
                <tr key={s.id} className="subdeals-row">
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40">
                    <button onClick={() => startEdit(s)} className="text-[var(--text)] font-medium hover:text-[var(--primary)] hover:underline text-left">{s.name}</button>
                    {s.parent_deal_id !== dealId && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] whitespace-nowrap" title="세부 프로젝트(캠페인) 소속 항목">📁 {childNameById[s.parent_deal_id] || "캠페인"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)] truncate">{partnerName(s.partner_id)}</td>
                  <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number font-semibold ${isPurchase ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                    {isPurchase ? "−" : "+"}{amt.toLocaleString("ko-KR")}
                    {s.vat_type === "inclusive" && <span className="ml-1 text-[9px] text-[var(--text-dim)] font-normal">VAT포함</span>}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text-muted)]" title="전표에서 이 항목으로 귀속한 실적원가">{actualCost(s.id) ? Number(actualCost(s.id)).toLocaleString("ko-KR") : "—"}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{STATUS_LABEL[s.status || ""] || "—"}</span></td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                    <button onClick={() => startEdit(s)} className="px-2 py-1 text-[11px] font-semibold rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]">수정</button>
                    <button onClick={async () => { if (await appConfirm(`'${s.name}' 항목을 삭제할까요?`, { danger: true })) delMut.mutate(s.id); }} className="ml-1 px-2 py-1 text-[11px] font-semibold rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                  </td>
                </tr>
              );
            })}
            {/* 인라인 추가 행 */}
            <tr className="subdeals-add-row">
              <RowInputs draft={draft} setDraft={setDraft} partners={partners} onEnter={() => addMut.mutate()} placeholderName="＋ 항목명 입력…" />
              <td className="px-2 py-2 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !draft.name.trim()} className="px-2.5 py-1 text-[11px] font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-40">추가</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="subdeals-totals-row">
              <td colSpan={2} className="px-3 py-2.5 text-xs font-bold text-[var(--text-muted)]">
                매출 <span className="text-[var(--success)] mono-number">+{salesSum.toLocaleString("ko-KR")}</span> · 매입 <span className="text-[var(--danger)] mono-number">−{purchaseSum.toLocaleString("ko-KR")}</span>
              </td>
              <td className={`px-3 py-2.5 text-right text-xs font-bold mono-number ${margin < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`} title="마진 = 매출 − 매입">
                마진 {won(margin)}
              </td>
              <td colSpan={3} className="px-3 py-2.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 캠페인으로도 생성(최상위 프로젝트에서만) */}
      {campaignInherit && (
        <label className="subdeals-campaign-toggle">
          <input type="checkbox" checked={draft.asCampaign} onChange={(e) => setDraft((d) => ({ ...d, asCampaign: e.target.checked }))} className="accent-[var(--primary)]" />
          새 항목을 세부 프로젝트(캠페인)로도 생성 <span className="text-[var(--text-dim)]">— 상단 ‘세부 프로젝트’ 탭에 같은 이름으로 표시</span>
        </label>
      )}
    </div>
  );
}

// 인라인 행의 입력 셀(항목명·거래처·금액±VAT·상태) — 추가/수정 공용.
function RowInputs({ draft, setDraft, partners, onEnter, placeholderName }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; partners: Partner[]; onEnter: () => void; placeholderName?: string;
}) {
  const [ptOpen, setPtOpen] = useState(false);
  const ptMatches = useMemo(() => {
    const t = draft.ptSearch.trim().toLowerCase();
    if (!t) return partners.slice(0, 30);
    const tn = t.replace(/-/g, "");
    return partners.filter((p) => p.name.toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)).slice(0, 100);
  }, [partners, draft.ptSearch]);
  const onAmt = (raw: string) => {
    const neg = raw.trim().startsWith("-");
    const digits = raw.replace(/[^0-9]/g, "");
    setDraft((d) => ({ ...d, amount: digits, sign: neg ? "minus" : d.sign }));
  };
  return (
    <>
      <td className="px-2 py-2 border-b border-[var(--border)]/40">
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }} placeholder={placeholderName || "항목명"}
          className="w-full h-9 px-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
      </td>
      <td className="px-2 py-2 border-b border-[var(--border)]/40 relative">
        <input value={draft.ptSearch} onChange={(e) => { setDraft((d) => ({ ...d, ptSearch: e.target.value, partner_id: "" })); setPtOpen(true); }} onFocus={() => setPtOpen(true)}
          onBlur={() => setTimeout(() => setPtOpen(false), 150)} placeholder="거래처"
          className="w-full h-9 px-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
        {ptOpen && (
          <div className="subdeals-partner-dropdown">
            {ptMatches.length === 0 ? <div className="px-3 py-2 text-xs text-[var(--text-dim)]">검색 결과 없음</div>
              : ptMatches.map((p) => (
                <button key={p.id} onMouseDown={() => { setDraft((d) => ({ ...d, partner_id: p.id, ptSearch: p.name })); setPtOpen(false); }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] text-[var(--text)]">{p.name}</button>
              ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2 border-b border-[var(--border)]/40">
        <div className="flex items-center gap-1 justify-end">
          <div className="subdeals-sign-toggle">
            <button type="button" onClick={() => setDraft((d) => ({ ...d, sign: "plus" }))} title="매출(받을 돈)"
              className={`px-1.5 h-9 text-xs font-bold ${draft.sign === "plus" ? "bg-[var(--success)] text-white" : "text-[var(--text-dim)] hover:bg-[var(--bg-surface)]"}`}>＋</button>
            <button type="button" onClick={() => setDraft((d) => ({ ...d, sign: "minus" }))} title="매입(줄 돈)"
              className={`px-1.5 h-9 text-xs font-bold border-l border-[var(--border)] ${draft.sign === "minus" ? "bg-[var(--danger)] text-white" : "text-[var(--text-dim)] hover:bg-[var(--bg-surface)]"}`}>－</button>
          </div>
          <input value={draft.amount ? Number(draft.amount).toLocaleString("ko-KR") : ""} onChange={(e) => onAmt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }} inputMode="numeric" placeholder="0"
            className={`w-24 h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)] ${draft.sign === "minus" ? "text-[var(--danger)]" : "text-[var(--success)]"}`} />
          <select value={draft.vat} onChange={(e) => setDraft((d) => ({ ...d, vat: e.target.value as "exclude" | "include" }))}
            className="h-9 px-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[10px] text-[var(--text-muted)] focus:outline-none shrink-0">
            <option value="exclude">별도</option><option value="include">포함</option>
          </select>
        </div>
      </td>
      <td className="px-2 py-2 border-b border-[var(--border)]/40"></td>
      <td className="px-2 py-2 border-b border-[var(--border)]/40 text-center">
        <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
          className="h-9 px-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] focus:outline-none">
          {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </td>
    </>
  );
}
