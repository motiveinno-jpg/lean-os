"use client";

// ── 결산자료입력 — 대손충당금·선급/미지급·법인세비용 결산 초안 (2026-10-14, 위하고식 기말 결산 분개) ──
//
//   History: 결산 초안은 재고자산·급여·감가상각·퇴직급여충당 넷이었다(ERP 공백 ②, production_voucher_drafts).
//   연말 재무제표를 세무사에게 넘기기 전에 하는 나머지 기말 분개(대손충당금·선급/미지급·법인세비용)는 일반전표로 손으로 했다.
//   기준: 기준일(그 달 말일, 연말이면 12/31)까지의 확정 전표 잔액. 계산·검증은 DB 함수가 다시 한다(차대 일치·회사 계정·확정본 있으면 거절).
//   확정은 사람 — 여기서는 'AI 제안' 초안만 만들고, 아래 처리할 것 목록에서 확정한다(feedback-automation-human-confirms).
//   자동으로 못 푸는 것: 외화환산(외화 잔액 자료 없음) · 대손 실제 발생(대손세액공제신고서 쪽) · 선급비용 대상(보험료·임차료 등) 고르기 — 사람.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { CurrencyInput } from "@/components/currency-input";
import { DateField } from "@/components/date-field";
import { listTaxReturns, latestClosed } from "@/lib/tax-returns";
import { computeStatements } from "@/lib/closing-snapshot";
import { citOf } from "@/lib/tax-forms/cit-form";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
type Acct = { id: string; code: string; name: string; account_type: string };
type AccrualKind = "prepaid" | "accrued_exp" | "accrued_rev" | "unearned";
const ACCRUAL_LABEL: Record<AccrualKind, string> = { prepaid: "선급비용 (미경과분)", accrued_exp: "미지급비용", accrued_rev: "미수수익", unearned: "선수수익" };
//   상대 계정(기간 귀속) — 계정과목 표준 코드
const BRIDGE: Record<AccrualKind, string> = { prepaid: "133", accrued_exp: "262", accrued_rev: "116", unearned: "263" };
type Row = { id: string; kind: AccrualKind; accountId: string; amount: string; from: string; to: string; memo: string };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

export function ClosingAdjustDialog({ mode, companyId, asof, onClose, onMade }: {
  mode: "baddebt" | "accrual" | "cit"; companyId: string; asof: string; onClose: () => void; onMade: (entryId: string | null) => void;
}) {
  const { toast } = useToast();
  useModalKeys(true, onClose);
  const [busy, setBusy] = useState(false);
  const year = Number(asof.slice(0, 4));

  // ─── 대손충당금 ───
  const [rate, setRate] = useState("1");

  // ─── 법인세비용 — 그 해 법인세 신고본(총부담세액 + 지방소득세) 우선, 없으면 오너뷰 예상 ───
  const { data: citGuess } = useQuery({
    queryKey: ["closing-cit-guess", companyId, year], enabled: mode === "cit",
    queryFn: async () => {
      const filed = latestClosed(await listTaxReturns(companyId, "cit", String(year)));
      if (filed) {
        const t = Math.round(Number(filed.figures?.TOTAL?.amount || 0)), l = Math.round(Number(filed.figures?.LOCAL?.amount || 0));
        return { amount: t + l, source: `${year}년 법인세 신고본(마감한 숫자) · 총부담 ${won(t)} + 지방소득세 ${won(l)}` };
      }
      const st = await computeStatements(companyId, `${year}-12`);
      const taxExp = (st.pnl || []).filter((p) => String(p.code || "") === "998").reduce((s, p) => s + Number(p.ytd || 0), 0);
      const base = Math.max(0, Math.round((st.totals.ytdNet || 0) + taxExp));
      const c = citOf(base).total;
      return { amount: c + Math.floor(c * 0.1), source: `오너뷰 예상(세무조정 전 · 회계이익 ${won(base)} 기준) — 세무사 확정 숫자가 있으면 세무 신고 › 법인세에서 마감하세요` };
    },
  });
  const [citAmount, setCitAmount] = useState<string>("");
  const citValue = citAmount !== "" ? Number(citAmount) : (citGuess?.amount || 0);

  // ─── 선급·미지급 ───
  const { data: accts = [] } = useQuery<Acct[]>({
    queryKey: ["closing-accts", companyId], enabled: mode === "accrual",
    queryFn: async () => (logRead("closing-adjust:accts", await (supabase as any).from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).order("code").limit(2000)) || []) as Acct[],
  });
  const [rows, setRows] = useState<Row[]>([{ id: "r1", kind: "prepaid", accountId: "", amount: "", from: `${year}-01-01`, to: `${year}-12-31`, memo: "" }]);
  const bridgeId = (k: AccrualKind) => accts.find((a) => a.code === BRIDGE[k])?.id || null;
  //   한 줄 → 귀속 금액. 선급비용은 지급액 × (기준일 다음 날 ~ 끝) 일수 ÷ 전체 일수
  const amountOf = (r: Row) => {
    const amt = Number(r.amount || 0);
    if (r.kind !== "prepaid") return Math.round(amt);
    if (!r.from || !r.to || r.from > r.to) return 0;
    const total = dayDiff(r.from, r.to);
    const nextDay = new Date(Date.parse(`${asof}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const remain = r.to < nextDay ? 0 : dayDiff(nextDay > r.from ? nextDay : r.from, r.to);
    return Math.floor((amt * remain) / total);
  };
  const lines = useMemo(() => rows.flatMap((r) => {
    const v = amountOf(r); const b = bridgeId(r.kind);
    if (!v || !r.accountId || !b) return [];
    const desc = `${ACCRUAL_LABEL[r.kind]}${r.memo ? ` · ${r.memo}` : ""}`.slice(0, 200);
    //   선급(차 선급비용/대 비용) · 미지급(차 비용/대 미지급비용) · 미수수익(차 미수수익/대 수익) · 선수수익(차 수익/대 선수수익)
    const [dr, cr] = r.kind === "prepaid" ? [b, r.accountId] : r.kind === "accrued_exp" ? [r.accountId, b] : r.kind === "accrued_rev" ? [b, r.accountId] : [r.accountId, b];
    return [{ account_id: dr, debit: v, credit: 0, description: desc }, { account_id: cr, debit: 0, credit: v, description: desc }];
  }), [rows, accts, asof]);  // eslint-disable-line react-hooks/exhaustive-deps
  const missingBridge = (["prepaid", "accrued_exp", "accrued_rev", "unearned"] as AccrualKind[]).filter((k) => rows.some((r) => r.kind === k) && !bridgeId(k));
  const pickable = (k: AccrualKind) => accts.filter((a) => (k === "prepaid" || k === "accrued_exp" ? a.account_type === "expense" : a.account_type === "revenue"));

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let id: string | null = null;
      if (mode === "baddebt") {
        const r = Number(rate);
        if (!(r > 0 && r <= 100)) { toast("설정률은 0보다 크고 100 이하입니다", "error"); return; }
        id = (await (supabase as any).rpc("make_baddebt_voucher_draft", { p_company: companyId, p_asof: asof, p_rate: r }).then((x: any) => { if (x.error) throw x.error; return x.data; })) || null;
        toast(id ? "대손충당금 초안을 만들었습니다. 아래에서 확정하세요" : "채권 잔액 기준 충당금과 장부가 이미 같습니다", id ? "success" : "info");
      } else if (mode === "cit") {
        if (!(citValue > 0)) { toast("법인세비용 금액을 넣으세요", "error"); return; }
        id = (await (supabase as any).rpc("make_cit_expense_voucher_draft", { p_company: companyId, p_asof: asof, p_amount: citValue }).then((x: any) => { if (x.error) throw x.error; return x.data; })) || null;
        toast("법인세비용 초안을 만들었습니다. 아래에서 확정하세요", "success");
      } else {
        if (!lines.length) { toast("넣을 줄이 없습니다 — 계정·금액을 채우세요", "error"); return; }
        const memo = `선급·미지급 결산 ${asof} · ${rows.filter((r) => amountOf(r) > 0 && r.accountId).length}건`;
        id = (await (supabase as any).rpc("make_accrual_voucher_draft", { p_company: companyId, p_asof: asof, p_lines: lines, p_memo: memo }).then((x: any) => { if (x.error) throw x.error; return x.data; })) || null;
        toast("선급·미지급 초안을 만들었습니다. 아래에서 확정하세요", "success");
      }
      onMade(id); onClose();
    } catch (e: any) { toast(friendlyError(e, "초안을 만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const title = mode === "baddebt" ? "대손충당금 설정" : mode === "cit" ? "법인세비용 계상" : "선급·미지급 비용";
  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className={mode === "accrual" ? "rtf-form closing-adjust-wide" : "rtf-form"} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="rtf-drill-head"><b>{title}</b><span>기준일 {asof}</span></div>
        {mode === "baddebt" && (<>
          <label className="rtf-form-field"><span>설정률(%) <i>· 채권 잔액 × 설정률 − 기존 대손충당금 = 이번에 쌓을(줄일) 금액</i></span>
            <input className="field-input text-right" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <p className="rtf-legend">외상매출금(108)·받을어음(110)·미수금(120) 잔액 기준 · 차) 대손상각비 / 대) 대손충당금. 목표보다 많이 쌓여 있으면 환입합니다.
            세법상 손금 한도는 채권 잔액의 1%(또는 대손실적률 중 큰 쪽) — 넘는 부분은 법인세 신고 때 손금불산입입니다.</p>
        </>)}
        {mode === "cit" && (<>
          <label className="rtf-form-field"><span>법인세비용 (법인세 + 지방소득세)</span>
            <CurrencyInput className="field-input text-right mono-number" value={citAmount !== "" ? citAmount : String(citGuess?.amount ?? "")} onValueChange={setCitAmount} /></label>
          <p className="rtf-legend">{citGuess ? `기본값: ${citGuess.source}.` : "기본값을 계산하는 중…"} 차) 법인세비용 / 대) 선납세금(중간예납·원천납부 잔액) · 미지급법인세(차액).
            선납세금이 더 많으면 남는 금액은 환급 대상입니다 — 세무사 확인.</p>
        </>)}
        {mode === "accrual" && (<>
          <div className="closing-accrual-rows">
            {rows.map((r, i) => (
              <div key={r.id} className="closing-accrual-row">
                <select className="field-input" value={r.kind} aria-label="종류" onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, kind: e.target.value as AccrualKind, accountId: "" } : x)))}>
                  {(Object.keys(ACCRUAL_LABEL) as AccrualKind[]).map((k) => <option key={k} value={k}>{ACCRUAL_LABEL[k]}</option>)}
                </select>
                <select className="field-input" value={r.accountId} aria-label={r.kind === "prepaid" || r.kind === "accrued_exp" ? "비용 계정" : "수익 계정"} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, accountId: e.target.value } : x)))}>
                  <option value="">{r.kind === "prepaid" || r.kind === "accrued_exp" ? "비용 계정" : "수익 계정"}</option>
                  {pickable(r.kind).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
                <CurrencyInput className="field-input text-right mono-number" value={r.amount} placeholder={r.kind === "prepaid" ? "지급액" : "금액"}
                  onValueChange={(v) => setRows(rows.map((x) => (x.id === r.id ? { ...x, amount: v } : x)))} />
                {r.kind === "prepaid" ? <>
                  <DateField className="field-input" value={r.from} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, from: e.target.value } : x)))} />
                  <DateField className="field-input" value={r.to} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, to: e.target.value } : x)))} />
                </> : <span className="closing-accrual-gap">기간 없음</span>}
                <input className="field-input" value={r.memo} placeholder="메모 (예: 자동차보험)" maxLength={80} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, memo: e.target.value } : x)))} />
                <span className="closing-accrual-amt mono-number">{won(amountOf(r))}</span>
                {rows.length > 1 && <button type="button" className="btn-secondary btn-sm" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} aria-label={`${i + 1}번 줄 지우기`}>삭제</button>}
              </div>
            ))}
          </div>
          <div className="rtf-add"><button type="button" className="btn-secondary btn-sm" onClick={() => setRows([...rows, { id: `r${Date.now()}`, kind: "accrued_exp", accountId: "", amount: "", from: `${year}-01-01`, to: `${year}-12-31`, memo: "" }])}>+ 줄 추가</button></div>
          <p className="rtf-legend">선급비용 = 지급액 × (기준일 다음 날 ~ 끝) 일수 ÷ 전체 일수 · 차) 선급비용(133) / 대) 비용. 미지급비용(262)·미수수익(116)·선수수익(263)은 넣은 금액 그대로.
            {missingBridge.length > 0 && <b className="vr-warn"> 계정과목에 {missingBridge.map((k) => `${ACCRUAL_LABEL[k]}(${BRIDGE[k]})`).join("·")}가 없습니다 — 회사설정 › 계정과목에서 추가하세요.</b>}
            {" "}합계 {won(lines.reduce((s, l) => s + l.debit, 0))}.</p>
        </>)}
        <div className="rtf-form-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          <button type="button" className="btn-primary btn-sm" onClick={run} disabled={busy || (mode === "accrual" && !lines.length)}>{busy ? "만드는 중…" : "초안 만들기"}</button>
        </div>
      </div>
    </div>
  );
}
