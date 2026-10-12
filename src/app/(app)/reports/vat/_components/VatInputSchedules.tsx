"use client";

// ── 부가세 부속서류 B — 사람이 넣는 서류 4종 (2026-10-12 세무 2차 3단계, docs/20261012_PLAN_tax_closing_v2.md 결정 261) ──
//   부동산임대공급가액명세서 · 의제매입세액공제신고서 · 대손세액공제신고서 · 과표 및 세액경정청구서.
//   입력은 줄마다 팝업 폼(목록이 밀리지 않게), 추가·수정·삭제하면 바로 저장(tax_schedule_inputs). 계산·신고서 반영은 lib/tax-forms/vat-schedules-input.
//   마감하면 신고본 schedules 에 같이 복사된다 — 마감 뒤 고치면 신고서에 '수정신고' 표시가 뜬다.

import { useEffect, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { DateField } from "@/components/date-field";
import { appConfirm } from "@/components/global-confirm";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { saveScheduleInput, type ScheduleInputDoc } from "@/lib/tax-schedule-inputs";
import type { FormFigures } from "@/lib/tax-forms/vat-form";
import type { ScheduleRow } from "@/lib/tax-forms/vat-schedules";
import {
  leaseSummary, deemedSummary, baddebtSummary, newId, DEFAULT_LEASE_RATE, DEEMED_RATES, DEEMED_KIND_LABEL, BADDEBT_REASONS,
  type LeaseData, type LeaseRow, type DeemedData, type DeemedManual, type BaddebtData, type BaddebtRow, type RefundClaimData,
} from "@/lib/tax-forms/vat-schedules-input";

const won = (n: unknown) => `₩${Math.round(Number(n || 0)).toLocaleString("ko-KR")}`;

/** 줄 입력 팝업 — 칸 정의만 받아 그린다 */
type Field = { key: string; label: string; type: "text" | "date" | "money" | "select" | "check"; options?: readonly string[] | { value: string; label: string }[]; required?: boolean; hint?: string };
function RowDialog({ title, fields, initial, onClose, onSave }: { title: string; fields: Field[]; initial: Record<string, any>; onClose: () => void; onSave: (v: Record<string, any>) => Promise<void> }) {
  const [v, setV] = useState<Record<string, any>>(initial);
  const [busy, setBusy] = useState(false);
  useModalKeys(true, onClose);
  const missing = fields.filter((f) => f.required && !String(v[f.key] ?? "").trim()).map((f) => f.label);
  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className="rtf-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="rtf-drill-head"><b>{title}</b></div>
        <div className="rtf-form-grid">
          {fields.map((f) => (
            <label key={f.key} className={f.type === "check" ? "rtf-form-check" : "rtf-form-field"}>
              <span>{f.label}{f.required ? " *" : ""}{f.hint && <i> · {f.hint}</i>}</span>
              {f.type === "text" && <input className="field-input" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
              {f.type === "date" && <DateField className="field-input" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
              {f.type === "money" && <CurrencyInput className="field-input text-right mono-number" value={String(v[f.key] ?? "")} onValueChange={(raw) => setV({ ...v, [f.key]: raw === "" ? 0 : Number(raw) })} />}
              {f.type === "select" && (
                <select className="field-input" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                  {(f.options || []).map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {f.type === "check" && <input type="checkbox" checked={!!v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.checked })} />}
            </label>
          ))}
        </div>
        {missing.length > 0 && <p className="rtf-legend">필수: {missing.join(", ")}</p>}
        <div className="rtf-form-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || missing.length > 0}
            onClick={async () => { setBusy(true); try { await onSave(v); onClose(); } finally { setBusy(false); } }}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  doc: "lease" | "deemed" | "baddebt" | "refundClaim";
  companyId: string | null; periodKey: string; from: string; to: string; canWrite: boolean;
  rows: ScheduleRow[];
  inputs: Partial<Record<ScheduleInputDoc, any>>;
  onSaved: () => void;
  /** 경정청구 — 마지막 신고본 숫자와 지금 계산 */
  filed: { figures: FormFigures; revision: number; closed_at: string } | null;
  current: FormFigures;
};

export function VatInputSchedules(p: Props) {
  const { toast } = useToast();
  const save = async (doc: ScheduleInputDoc, data: unknown, msg = "저장했습니다") => {
    if (!p.companyId) return;
    try { await saveScheduleInput(p.companyId, p.periodKey, doc, data); p.onSaved(); toast(msg, "success"); }
    catch (e: any) { toast(friendlyError(e, "저장에 실패했습니다"), "error"); throw e; }
  };
  const [dialog, setDialog] = useState<null | { title: string; fields: Field[]; initial: Record<string, any>; onSave: (v: Record<string, any>) => Promise<void> }>(null);
  const del = async (label: string, run: () => Promise<void>) => { if (await appConfirm(`${label} 줄을 지웁니다.`, { danger: true })) await run(); };

  // ─── 부동산임대 ───
  const lease: LeaseData = { rate: DEFAULT_LEASE_RATE, rows: [], ...(p.inputs.lease || {}) };
  const LS = leaseSummary(lease, p.from, p.to);
  const leaseFields: Field[] = [
    { key: "dong", label: "동", type: "text" }, { key: "floor", label: "층", type: "text" }, { key: "ho", label: "호", type: "text" },
    { key: "use", label: "용도", type: "text" },
    { key: "tenant", label: "임차인 상호(성명)", type: "text", required: true }, { key: "tenantBizno", label: "임차인 사업자번호", type: "text" },
    { key: "start", label: "임대 시작일", type: "date", required: true }, { key: "end", label: "임대 종료일", type: "date", hint: "비우면 계속" },
    { key: "deposit", label: "보증금", type: "money" }, { key: "monthlyRent", label: "월세(공급가액)", type: "money" }, { key: "maintenance", label: "관리비(공급가액)", type: "money" },
  ];
  const [rateDraft, setRateDraft] = useState(String(lease.rate));
  useEffect(() => { setRateDraft(String(lease.rate)); }, [lease.rate, p.periodKey]);
  const leaseUpsert = (row: LeaseRow) => save("lease", { ...lease, rows: lease.rows.some((r) => r.id === row.id) ? lease.rows.map((r) => (r.id === row.id ? row : r)) : [...lease.rows, row] });
  const leaseRemove = (id: string) => save("lease", { ...lease, rows: lease.rows.filter((r) => r.id !== id) }, "지웠습니다");

  // ─── 의제매입 ───
  const deemed: DeemedData = { rate: "2/102", items: [], manual: [], ...(p.inputs.deemed || {}) };
  const cands = p.rows.filter((x) => x.vat_type === "53" || x.vat_type === "58");
  const DS = deemedSummary(deemed, cands);
  const itemOf = (id: string) => deemed.items.find((x) => x.entryId === id);
  const togglePick = (id: string, on: boolean) => save("deemed", { ...deemed, items: on ? [...deemed.items, { entryId: id }] : deemed.items.filter((x) => x.entryId !== id) }, on ? "공제 대상에 넣었습니다" : "공제 대상에서 뺐습니다");
  const setItemField = (id: string, k: "item" | "qty", val: string) => {
    const cur = itemOf(id); if (!cur || (cur[k] || "") === val) return;
    void save("deemed", { ...deemed, items: deemed.items.map((x) => (x.entryId === id ? { ...x, [k]: val } : x)) }).catch(() => {});
  };
  const deemedFields: Field[] = [
    { key: "kind", label: "구분", type: "select", options: (Object.keys(DEEMED_KIND_LABEL) as (keyof typeof DEEMED_KIND_LABEL)[]).map((k) => ({ value: k, label: DEEMED_KIND_LABEL[k] })) },
    { key: "supplier", label: "공급자(농어민 성명)", type: "text", required: true }, { key: "bizno", label: "사업자·주민번호", type: "text", hint: "농어민은 세무사 기입" },
    { key: "date", label: "매입일", type: "date", required: true }, { key: "item", label: "품명", type: "text" }, { key: "qty", label: "수량", type: "text" },
    { key: "amount", label: "매입가액", type: "money", required: true },
  ];
  const deemedUpsert = (m: DeemedManual) => save("deemed", { ...deemed, manual: deemed.manual.some((x) => x.id === m.id) ? deemed.manual.map((x) => (x.id === m.id ? m : x)) : [...deemed.manual, m] });

  // ─── 대손 ───
  const bad: BaddebtData = { rows: [], ...(p.inputs.baddebt || {}) };
  const BS = baddebtSummary(bad);
  const badFields: Field[] = [
    { key: "partner", label: "거래처 상호", type: "text", required: true }, { key: "bizno", label: "사업자번호", type: "text" }, { key: "ceo", label: "대표자", type: "text" },
    { key: "supplyDate", label: "당초 공급일", type: "date", required: true }, { key: "confirmDate", label: "대손 확정일", type: "date", required: true },
    { key: "amount", label: "대손금액(공급대가 = 공급가액+세액)", type: "money", required: true },
    { key: "reason", label: "대손 사유", type: "select", options: BADDEBT_REASONS },
    { key: "recovered", label: "대손 회수분(전에 공제받은 것을 돌려받음)", type: "check" },
  ];
  const badUpsert = (r: BaddebtRow) => save("baddebt", { ...bad, rows: bad.rows.some((x) => x.id === r.id) ? bad.rows.map((x) => (x.id === r.id ? r : x)) : [...bad.rows, r] });

  // ─── 경정청구 ───
  const claim: RefundClaimData = { ...(p.inputs.refund_claim || {}) };
  const [claimDraft, setClaimDraft] = useState<RefundClaimData>(claim);
  useEffect(() => { setClaimDraft({ ...(p.inputs.refund_claim || {}) }); }, [p.inputs.refund_claim, p.periodKey]);
  const saveClaim = (k: keyof RefundClaimData, val: string) => { if ((claim[k] || "") === val) return; void save("refund_claim", { ...claim, [k]: val }).catch(() => {}); };

  const ro = !p.canWrite;
  const view = () => {
    switch (p.doc) {
      case "lease": return (
        <>
          <table className="rtf-table">
            <thead><tr><th>구분</th><th>간주임대료</th><th>월세 등</th><th>관리비</th><th>수입금액 합계</th></tr></thead>
            <tbody><tr className="rtf-sum"><td className="rtf-label">합계 ({LS.lines.length}건)</td><td className="rtf-num">{won(LS.deemed)}</td><td className="rtf-num">{won(LS.rent)}</td><td className="rtf-num">{won(LS.maint)}</td><td className="rtf-num">{won(LS.total)}</td></tr></tbody>
          </table>
          <p className="rtf-legend">
            간주임대료 = 보증금 × 과세기간 안 임대일수 × 정기예금이자율 ÷ 365 → 신고서 <b>④ 기타</b>에 더해집니다(세액 10%). 월세·관리비는 세금계산서를 발급했다면 ①에 이미 있습니다.
            {" "}정기예금이자율 <input className="rtf-rate-input" value={rateDraft} disabled={ro} onChange={(e) => setRateDraft(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => { const r = Number(rateDraft); if (r > 0 && r !== lease.rate) void save("lease", { ...lease, rate: r }).catch(() => {}); }} />% (국세청 고시 — 바뀌면 고치세요)
          </p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>동·층·호</th><th>임차인</th><th>임대기간</th><th>보증금</th><th>월세</th><th>일수</th><th>간주임대료</th><th>월세 계</th><th>관리비 계</th><th></th></tr></thead>
              <tbody>
                {LS.lines.map(({ row: r, days, deemed: dd, rent, maint }) => (
                  <tr key={r.id}>
                    <td className="tc">{[r.dong, r.floor && `${r.floor}층`, r.ho && `${r.ho}호`].filter(Boolean).join(" ") || "—"}</td>
                    <td className="text-left">{r.tenant}{r.tenantBizno ? <span className="ev-dim"> {r.tenantBizno}</span> : null}</td>
                    <td className="tc mono-number">{r.start} ~ {r.end || "계속"}</td>
                    <td className="tr mono-number">{won(r.deposit)}</td><td className="tr mono-number">{won(r.monthlyRent)}</td><td className="tr mono-number">{days}</td>
                    <td className="tr mono-number">{won(dd)}</td><td className="tr mono-number">{won(rent)}</td><td className="tr mono-number">{won(maint)}</td>
                    <td className="tc rtf-row-actions">{!ro && <>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "임대 줄 수정", fields: leaseFields, initial: r, onSave: (v) => leaseUpsert({ ...(v as LeaseRow), id: r.id }) })}>수정</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => del(r.tenant, () => leaseRemove(r.id))}>삭제</button></>}</td>
                  </tr>
                ))}
                {!LS.lines.length && <tr><td colSpan={10} className="tc ev-dim">임대 줄이 없습니다. 부동산을 임대하지 않으면 이 서류는 내지 않습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          {!ro && <div className="rtf-add"><button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "임대 줄 추가", fields: leaseFields, initial: { start: p.from, deposit: 0, monthlyRent: 0, maintenance: 0 }, onSave: (v) => leaseUpsert({ ...(v as LeaseRow), id: newId() }) })}>+ 임대 줄 추가</button></div>}
        </>
      );
      case "deemed": return (
        <>
          <table className="rtf-table">
            <thead><tr><th>구분</th><th>매입처 수</th><th>건수</th><th>매입가액</th><th>공제율</th><th>의제매입세액</th></tr></thead>
            <tbody>
              <tr className="rtf-sum"><td className="rtf-label">합계</td><td className="rtf-num"></td><td className="rtf-num">{DS.n}</td><td className="rtf-num">{won(DS.amount)}</td><td className="rtf-rate">{DS.rate}</td><td className="rtf-num">{won(DS.tax)}</td></tr>
              {DS.groups.map((g) => <tr key={g.kind}><td className="rtf-label">{g.label}</td><td className="rtf-num">{g.suppliers}</td><td className="rtf-num">{g.n}</td><td className="rtf-num">{won(g.amount)}</td><td className="rtf-rate">{DS.rate}</td><td className="rtf-num">{won(g.tax)}</td></tr>)}
            </tbody>
          </table>
          <p className="rtf-legend">
            공제율 <select className="qk-input h-7 px-2 text-xs" disabled={ro} value={deemed.rate} aria-label="공제율" onChange={(e) => void save("deemed", { ...deemed, rate: e.target.value }).catch(() => {})}>
              {DEEMED_RATES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
            {" "}· 의제매입세액은 신고서 <b>⑮ 그 밖의 공제매입세액</b>에 더해집니다. 면세 농·축·수·임산물을 원재료로 쓴 매입만 고르세요. <b>공제 한도(과세표준 × 한도율)는 계산하지 않습니다 — 세무사 확인.</b>
          </p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>공제</th><th>일자</th><th>공급자</th><th>유형</th><th>매입가액</th><th>품명</th><th>수량</th></tr></thead>
              <tbody>
                {cands.map((x) => { const it = itemOf(x.id); return (
                  <tr key={x.id}>
                    <td className="tc"><input type="checkbox" disabled={ro} checked={!!it} onChange={(e) => void togglePick(x.id, e.target.checked).catch(() => {})} aria-label="공제 대상" /></td>
                    <td className="tc mono-number">{x.entry_date}</td><td className="text-left">{x.partnerName || "—"}</td><td className="tc">{x.vat_type === "53" ? "계산서" : "카드 면세"}</td>
                    <td className="tr mono-number">{won(x.supply_amount)}</td>
                    <td><input className="rtf-cell-input" disabled={ro || !it} defaultValue={it?.item || ""} key={`i${x.id}${it?.item}`} onBlur={(e) => setItemField(x.id, "item", e.target.value)} placeholder="품명" /></td>
                    <td><input className="rtf-cell-input" disabled={ro || !it} defaultValue={it?.qty || ""} key={`q${x.id}${it?.qty}`} onBlur={(e) => setItemField(x.id, "qty", e.target.value)} placeholder="수량" /></td>
                  </tr>); })}
                {deemed.manual.map((m) => (
                  <tr key={m.id}>
                    <td className="tc">직접</td><td className="tc mono-number">{m.date}</td><td className="text-left">{m.supplier}</td><td className="tc">{DEEMED_KIND_LABEL[m.kind]}</td>
                    <td className="tr mono-number">{won(m.amount)}</td><td className="text-left">{m.item || ""}</td>
                    <td className="tc rtf-row-actions">{m.qty || ""}{!ro && <>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "의제매입 줄 수정", fields: deemedFields, initial: m, onSave: (v) => deemedUpsert({ ...(v as DeemedManual), id: m.id }) })}>수정</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => del(m.supplier, () => save("deemed", { ...deemed, manual: deemed.manual.filter((x) => x.id !== m.id) }, "지웠습니다"))}>삭제</button></>}</td>
                  </tr>
                ))}
                {!cands.length && !deemed.manual.length && <tr><td colSpan={7} className="tc ev-dim">이 기간에 면세 매입(계산서 53·카드 면세 58) 전표가 없습니다. 농어민 직접 매입은 아래에서 넣으세요.</td></tr>}
              </tbody>
            </table>
          </div>
          {!ro && <div className="rtf-add"><button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "의제매입 줄 추가", fields: deemedFields, initial: { kind: "farmer", date: p.from, amount: 0 }, onSave: (v) => deemedUpsert({ ...(v as DeemedManual), id: newId() }) })}>+ 직접 매입 줄 추가</button></div>}
        </>
      );
      case "baddebt": return (
        <>
          <table className="rtf-table">
            <thead><tr><th>구분</th><th>건수</th><th>대손금액</th><th>공제율</th><th>대손세액</th></tr></thead>
            <tbody>
              <tr><td className="rtf-label">대손세액 공제</td><td className="rtf-num">{BS.lines.filter((x) => !x.row.recovered).length}</td><td className="rtf-num">{won(BS.deductedAmount)}</td><td className="rtf-rate">10/110</td><td className="rtf-num">{won(BS.deductedTax)}</td></tr>
              <tr><td className="rtf-label">대손금 회수</td><td className="rtf-num">{BS.lines.filter((x) => x.row.recovered).length}</td><td className="rtf-num">{won(BS.recoveredAmount)}</td><td className="rtf-rate">10/110</td><td className="rtf-num">{won(BS.recoveredTax)}</td></tr>
              <tr className="rtf-sum"><td className="rtf-label">신고서 ⑧ 대손세액 가감</td><td className="rtf-num"></td><td className="rtf-num"></td><td className="rtf-rate"></td><td className="rtf-num">{BS.line8 < 0 ? "−" : ""}{won(Math.abs(BS.line8))}</td></tr>
            </tbody>
          </table>
          <p className="rtf-legend">대손세액 = 대손금액(공급대가) × 10/110. 공제는 신고서 ⑧에서 빼고, 전에 공제받은 대손금을 돌려받으면 더합니다. 대손 사유는 부가가치세법 시행령 87조 — 증빙(파산 결정문 등)은 세무사에게 따로 보내세요.</p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>거래처</th><th>당초 공급일</th><th>대손 확정일</th><th>대손금액</th><th>대손세액</th><th>사유</th><th>구분</th><th></th></tr></thead>
              <tbody>
                {BS.lines.map(({ row: r, tax }) => (
                  <tr key={r.id}>
                    <td className="text-left">{r.partner}{r.bizno ? <span className="ev-dim"> {r.bizno}</span> : null}</td><td className="tc mono-number">{r.supplyDate}</td><td className="tc mono-number">{r.confirmDate}</td>
                    <td className="tr mono-number">{won(r.amount)}</td><td className="tr mono-number">{won(tax)}</td><td className="tc">{r.reason}</td><td className="tc">{r.recovered ? "회수" : "공제"}</td>
                    <td className="tc rtf-row-actions">{!ro && <>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "대손 줄 수정", fields: badFields, initial: r, onSave: (v) => badUpsert({ ...(v as BaddebtRow), id: r.id }) })}>수정</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => del(r.partner, () => save("baddebt", { ...bad, rows: bad.rows.filter((x) => x.id !== r.id) }, "지웠습니다"))}>삭제</button></>}</td>
                  </tr>
                ))}
                {!BS.lines.length && <tr><td colSpan={8} className="tc ev-dim">대손 줄이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          {!ro && <div className="rtf-add"><button type="button" className="btn-secondary btn-sm" onClick={() => setDialog({ title: "대손 줄 추가", fields: badFields, initial: { reason: BADDEBT_REASONS[0], confirmDate: p.to, amount: 0 }, onSave: (v) => badUpsert({ ...(v as BaddebtRow), id: newId() }) })}>+ 대손 줄 추가</button></div>}
        </>
      );
      case "refundClaim": {
        if (!p.filed) return <div className="collect-empty">이 기수는 아직 마감한 신고본이 없습니다. 경정청구는 <b>신고한 뒤</b> 세액이 줄었을 때 냅니다 — 먼저 신고서를 마감하세요.</div>;
        const f = p.filed.figures, c = p.current;
        const L = (label: string, a: number, b: number) => <tr key={label}><td className="rtf-label">{label}</td><td className="rtf-num">{won(a)}</td><td className="rtf-num">{won(b)}</td><td className="rtf-num">{a === b ? "" : `${b - a > 0 ? "+" : "−"}${won(Math.abs(b - a))}`}</td></tr>;
        const t0 = Math.round(Number(f["30"]?.tax || 0)), t1 = Math.round(Number(c["30"]?.tax || 0));
        return (
          <>
            {t1 >= t0
              ? <div className="collect-empty">지금 계산한 세액({won(t1)})이 신고한 세액({won(t0)})보다 {t1 === t0 ? "같습니다" : "많습니다"} — 경정청구 대상이 아닙니다.{t1 > t0 ? " 세액이 늘면 신고서에서 수정신고를 하세요." : ""}</div>
              : <p className="rtf-legend">신고한 뒤 세액이 줄었습니다 → <b>환급받을 세액 {won(t0 - t1)}</b>. 법정신고기한이 지난 뒤 5년 안에 낼 수 있습니다(국세기본법 45조의2). 제출은 홈택스에서.</p>}
            <table className="rtf-table">
              <thead><tr><th>구분</th><th>당초 신고 ({p.filed.revision === 0 ? "정기" : `${p.filed.revision}차 수정`})</th><th>경정 청구</th><th>차이</th></tr></thead>
              <tbody>
                {L("과세표준 (⑨ 금액)", Math.round(Number(f["9"]?.amount || 0)), Math.round(Number(c["9"]?.amount || 0)))}
                {L("매출세액 ㉮", Math.round(Number(f["9"]?.tax || 0)), Math.round(Number(c["9"]?.tax || 0)))}
                {L("매입세액 ㉯", Math.round(Number(f["18"]?.tax || 0)), Math.round(Number(c["18"]?.tax || 0)))}
                {L("가산세 ㉹", Math.round(Number(f["29"]?.tax || 0)), Math.round(Number(c["29"]?.tax || 0)))}
                {L("납부할 세액 ㉚", t0, t1)}
              </tbody>
            </table>
            <div className="rtf-claim-grid">
              <label className="rtf-form-field rtf-claim-reason"><span>경정청구 이유</span>
                <textarea className="field-input" rows={3} disabled={ro} value={claimDraft.reason || ""} onChange={(e) => setClaimDraft({ ...claimDraft, reason: e.target.value })} onBlur={(e) => saveClaim("reason", e.target.value)} placeholder="예: 매입 세금계산서 수취분 누락(○○상사 2건) 확인" /></label>
              <label className="rtf-form-field"><span>환급 은행</span><input className="field-input" disabled={ro} value={claimDraft.bank || ""} onChange={(e) => setClaimDraft({ ...claimDraft, bank: e.target.value })} onBlur={(e) => saveClaim("bank", e.target.value)} /></label>
              <label className="rtf-form-field"><span>계좌번호</span><input className="field-input" disabled={ro} value={claimDraft.account || ""} onChange={(e) => setClaimDraft({ ...claimDraft, account: e.target.value })} onBlur={(e) => saveClaim("account", e.target.value)} /></label>
              <label className="rtf-form-field"><span>예금주</span><input className="field-input" disabled={ro} value={claimDraft.holder || ""} onChange={(e) => setClaimDraft({ ...claimDraft, holder: e.target.value })} onBlur={(e) => saveClaim("holder", e.target.value)} /></label>
            </div>
            <p className="rtf-legend">경정청구 숫자는 '당초 신고본'과 '지금 계산'의 차이입니다. 신고서에서 「수정본 마감」을 하면 이 숫자도 함께 남습니다.</p>
          </>
        );
      }
    }
  };

  return (
    <>
      {view()}
      {dialog && <RowDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
