"use client";

// ── 생산 전표 팝업 (결정 33, 2026-08-26) — 이번 주기 초안 상태 · 지금 만들기 · 지난 기간 만들기 · 설정(주기·계정) ──
//   초안은 자동, 확정은 사람(재무 › 현황 › 처리할 것 또는 여기 확정 버튼). 확정하면 DB 트리거가 문서에 전표를 묶는다.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { todayKst } from "@/lib/kst";
import { DateRangeField } from "@/components/date-range-field";
import {
  CYCLES, loadProdVoucherSettings, saveProdVoucherSettings, listProdDrafts, makeProdDraftNow, countUnvouchedProdDocs, decideProdDraft,
  type ProdVoucherSettings, type ProdVoucherCycle,
} from "@/lib/production-voucher";
import { docWon as won } from "./doc-editor";

const monthStart = () => todayKst().slice(0, 7) + "-01";
const STATUS: Record<string, string> = { draft: "대기", confirmed: "확정", rejected: "반려" };

export function ProdVoucherDialog({ companyId, userId, onClose }: { companyId: string; userId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKst);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<ProdVoucherSettings | null>(null);
  const { data: drafts = [], refetch } = useQuery({ queryKey: ["prod-drafts", companyId], queryFn: () => listProdDrafts(companyId) });
  const { data: unvouched = 0, refetch: refetchCount } = useQuery({ queryKey: ["prod-unvouched", companyId, from, to], queryFn: () => countUnvouchedProdDocs(companyId, from, to) });
  const { data: accounts = [] } = useQuery({ queryKey: ["prod-accts", companyId], queryFn: async () => {
    const { data } = await supabase.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).in("account_type", ["asset", "expense"]).order("code");
    return ((data || []) as { id: string; code: string | null; name: string; account_type: string }[]);
  } });
  useEffect(() => { loadProdVoucherSettings(companyId).then(setCfg); }, [companyId]);

  const refresh = () => { refetch(); refetchCount(); qc.invalidateQueries({ queryKey: ["fin-status-entries"] }); };
  const makeNow = async () => {
    setBusy(true);
    try {
      const id = await makeProdDraftNow(from, to);
      toast(id ? `${from} ~ ${to} 생산 전표 초안을 만들었습니다 — 확정은 아래 또는 재무 › 현황 › 처리할 것` : "이 기간에 전표로 만들 생산 문서가 없습니다", id ? "success" : "info");
      refresh();
    } catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const decide = async (entryId: string, st: "confirmed" | "rejected") => {
    setBusy(true);
    try { await decideProdDraft(entryId, st, userId); toast(st === "confirmed" ? "확정했습니다 — 생산 문서에 전표가 묶였습니다" : "반려했습니다 — 문서는 다음 초안이 다시 집습니다", "success"); refresh(); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const saveCfg = async () => {
    if (!cfg) return;
    setBusy(true);
    try { await saveProdVoucherSettings(companyId, cfg); toast("생산 전표 설정을 저장했습니다", "success"); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const acctPick = (key: "acct_product" | "acct_material" | "acct_scrap", label: string, fallback: string) => (
    <label className="prod-voucher-acct">
      <span className="field-label">{label}</span>
      <select className="field-input" value={cfg?.[key] || ""} onChange={(e) => setCfg((c) => c ? { ...c, [key]: e.target.value || null } : c)}>
        <option value="">자동 — 이름이 &apos;{fallback}&apos;인 계정</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ""}{a.name}</option>)}
      </select>
    </label>
  );

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">생산 전표</h3>
        <p className="inv-modal-desc">주기가 끝나면 그 기간의 <b>완제품 입고·자재 투입·불량 폐기</b> 문서를 일반전표(대체) <b>초안 한 장</b>으로 만듭니다 — 차변 제품 / 대변 원재료(자재 실투입 금액), 불량 폐기는 재고자산감모손실. <b>확정은 사람</b>이 하고, 확정하면 문서에 전표가 묶입니다.</p>

        <div className="inv-bom-base">
          <span className="field-label">지금 만들기</span>
          <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <span className="ev-dim">전표 없는 생산 문서 <b>{unvouched}</b>건</span>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !unvouched} onClick={makeNow}>초안 만들기</button>
          <em className="inv-hint">대기 초안이 있으면 기간을 합쳐 갈아끼웁니다(대기 초안은 언제나 하나). 지난 기간도 여기서 소급합니다.</em>
        </div>

        <div className="stg-table-wrap ch-ship-list">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>기간</th><th>문서</th><th>자재 투입(=제품)</th><th>완제품 평가</th><th>불량 폐기</th><th>단가 없음</th><th>상태</th><th></th></tr></thead>
            <tbody>{drafts.map((d) => (
              <tr key={d.id} className={d.status === "rejected" ? "inv-row-fix" : undefined}>
                <td className="mono-number tc">{d.period_from} ~ {d.period_to}</td><td className="tr mono-number">{d.doc_ids.length}</td>
                <td className="tr mono-number">₩{won(d.amount_material)}</td><td className="tr mono-number">₩{won(d.amount_product_valued)}</td><td className="tr mono-number">₩{won(d.amount_scrap)}</td>
                <td className="tr mono-number">{d.skipped_lines || "—"}</td>
                <td className="tc"><span className={d.status === "confirmed" ? "inv-pill inv-pill-ok" : d.status === "draft" ? "inv-pill inv-pill-warn" : "inv-pill inv-pill-danger"}>{STATUS[d.status]}</span></td>
                <td className="tc">{d.status === "draft" && d.journal_entry_id ? (
                  <span className="inline-flex gap-1.5">
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => decide(d.journal_entry_id!, "rejected")}>반려</button>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => decide(d.journal_entry_id!, "confirmed")}>확정</button>
                  </span>) : null}</td>
              </tr>
            ))}{drafts.length === 0 && <tr><td colSpan={8} className="tc ev-dim">아직 만든 초안이 없습니다</td></tr>}</tbody>
          </table>
        </div>

        {cfg && (
          <div className="prod-voucher-cfg">
            <label className="prod-voucher-acct">
              <span className="field-label">주기</span>
              <select className="field-input" value={cfg.cycle} onChange={(e) => setCfg({ ...cfg, cycle: e.target.value as ProdVoucherCycle })}>
                {CYCLES.map((c) => <option key={c.value} value={c.value}>{c.label} — {c.desc}</option>)}
              </select>
            </label>
            {acctPick("acct_product", "제품 계정", "제품")}
            {acctPick("acct_material", "원재료 계정", "원재료")}
            {acctPick("acct_scrap", "불량 폐기 손실 계정", "재고자산감모손실")}
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={saveCfg}>설정 저장</button>
          </div>
        )}

        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
