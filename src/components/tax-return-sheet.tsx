"use client";

// ── 신고서 서식 + 세무 마감 줄 (2026-10-12 세무 2차 1단계, docs/20261012_PLAN_tax_closing_v2.md 결정 258~260) ──
//
//   한 부품이 세 가지를 한다.
//   ① 국세청 서식 칸 번호 그대로 그린다(부가세 1~30, 원천세 A01~A99). 사람이 넣는 칸은 그 자리에서 입력.
//   ② 마감 = 지금 숫자를 신고본(tax_returns)으로 저장. 자료는 잠그지 않는다(사장님 "숫자만 저장").
//   ③ 마감 뒤 지금 계산이 신고본과 다르면 '바뀐 칸 N개'를 알리고, 당초/수정을 서식 한 칸에 두 줄로 보여 준다
//      (국세청 수정신고서처럼 위 = 당초, 아래 = 수정). 세액이 늘면 수정신고, 줄면 경정청구로 적는다.
//   파란 버튼은 이 줄의 「마감」/「수정본 마감」 하나.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CurrencyInput } from "@/components/currency-input";
import { appConfirm } from "@/components/global-confirm";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { listTaxReturns, latestClosed, closeTaxReturn, cancelTaxReturn, diffFigures, diffSources, type TaxReturnKind } from "@/lib/tax-returns";
import { VAT_LINES, type FormFigures } from "@/lib/tax-forms/vat-form";
import { WHT_LINES } from "@/lib/tax-forms/wht-form";

const won = (n: unknown) => Math.round(Number(n || 0)).toLocaleString("ko-KR");

type Props = {
  layout: "vat" | "wht";
  kind: TaxReturnKind;
  companyId: string | null;
  userId: string | null;
  periodKey: string;
  /** 서식 제목 · 기간 */
  title: string;
  /** 사람이 넣은 칸 → 신고서 전 칸 */
  compute: (manual: FormFigures) => FormFigures;
  /** 근거 자료 id (전표·급여 등) — '자료 +a −b' */
  sources: Record<string, string[]>;
  /** 부속서류 숫자 — 마감 때 신고본에 같이 남긴다(2단계) */
  schedules?: Record<string, unknown>;
  /** 신고본이 없을 때 사람 칸 기본값(예: ㉓ 예정신고 미환급세액) · 출처 한 줄 */
  defaultManual?: FormFigures;
  defaultManualNote?: string;
  /** 자료를 읽는 중이면 마감을 막는다 */
  loading?: boolean;
  /** 권한 — 없으면 마감·취소 버튼을 안 그린다(RLS 도 막는다) */
  canWrite: boolean;
};

export function TaxReturnSheet(p: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const qk = ["tax-returns", p.companyId, p.kind, p.periodKey];
  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: qk, enabled: !!p.companyId,
    queryFn: () => listTaxReturns(p.companyId!, p.kind, p.periodKey),
  });
  const filed = latestClosed(list);

  //   사람 칸 — 신고본이 있으면 그 값에서, 없으면 기본값에서 시작. 기간이 바뀌면 다시 잡는다
  const [manual, setManual] = useState<FormFigures>({});
  const seeded = useRef<string>("");
  useEffect(() => {
    if (listLoading) return;
    const key = `${p.periodKey}|${filed?.id || "none"}|${JSON.stringify(p.defaultManual || {})}`;
    if (seeded.current === key) return;
    seeded.current = key;
    setManual(filed ? (filed.manual || {}) : (p.defaultManual || {}));
  }, [listLoading, filed, p.periodKey, p.defaultManual]);

  const current = useMemo(() => p.compute(manual), [p, manual]);
  const changed = useMemo(() => (filed ? diffFigures(filed.figures, current) : []), [filed, current]);
  const srcDiff = useMemo(() => {
    if (!filed) return { added: 0, removed: 0 };
    let added = 0, removed = 0;
    for (const k of new Set([...Object.keys(filed.source_ids || {}), ...Object.keys(p.sources)])) {
      const d = diffSources(filed.source_ids?.[k], p.sources[k]); added += d.added; removed += d.removed;
    }
    return { added, removed };
  }, [filed, p.sources]);
  const totalKey = p.layout === "vat" ? "30" : "A99";
  const filedTax = Math.round(Number(filed?.figures?.[totalKey]?.tax || 0));
  const nowTax = Math.round(Number(current[totalKey]?.tax || 0));
  const revisedKind = !filed || !changed.length ? null : nowTax > filedTax ? "수정신고" : nowTax < filedTax ? "경정청구" : "수정신고(세액 같음)";
  const [compare, setCompare] = useState(true);
  const showCompare = !!filed && changed.length > 0 && compare;

  const [busy, setBusy] = useState(false);
  const doClose = async () => {
    if (!p.companyId || !p.userId || busy) return;
    const msg = filed
      ? `${filed.revision + 1}차 수정본으로 마감합니다.\n당초 ${won(filedTax)}원 → 수정 ${won(nowTax)}원 (${revisedKind}).\n홈택스 제출은 따로 하셔야 합니다.`
      : `지금 숫자로 마감합니다(세액 ${won(nowTax)}원).\n자료는 잠기지 않고, 마감 뒤 자료가 바뀌면 여기서 수정신고를 만들 수 있습니다.\n홈택스 제출은 따로 하셔야 합니다.`;
    if (!(await appConfirm(msg, { title: filed ? "수정본 마감" : "신고 마감", confirmLabel: "마감" }))) return;
    setBusy(true);
    try {
      const kept: FormFigures = {};
      for (const [k, v] of Object.entries(manual)) if (Number(v?.amount || 0) || Number(v?.tax || 0)) kept[k] = v;
      await closeTaxReturn({ companyId: p.companyId, userId: p.userId, kind: p.kind, periodKey: p.periodKey, list, figures: current, manual: kept, sourceIds: p.sources, schedules: p.schedules });
      await qc.invalidateQueries({ queryKey: qk });
      toast(filed ? "수정본으로 마감했습니다" : "마감했습니다. 홈택스 제출은 따로 하세요", "success");
    } catch (e: any) { toast(friendlyError(e, "마감에 실패했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    if (!filed || !p.userId || busy) return;
    if (!(await appConfirm(`${filed.revision === 0 ? "정기" : `${filed.revision}차 수정`} 신고본 마감을 취소합니다.\n기록은 지워지지 않고 '취소'로 남습니다.`, { danger: true, confirmLabel: "마감 취소", title: "마감 취소" }))) return;
    setBusy(true);
    try { await cancelTaxReturn(filed.id, p.userId, ""); await qc.invalidateQueries({ queryKey: qk }); toast("마감을 취소했습니다", "success"); }
    catch (e: any) { toast(friendlyError(e, "취소에 실패했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const sheetRef = useRef<HTMLDivElement>(null);
  const print = () => {
    const html = sheetRef.current?.outerHTML; if (!html) return;
    const w = window.open("", "_blank"); if (!w) { toast("팝업이 막혀 인쇄 창을 못 열었습니다", "error"); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title><style>
      body{font-family:'Malgun Gothic',sans-serif;margin:16px;color:#111}h2{font-size:16px;margin:0 0 8px}
      table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #888;padding:3px 6px}th{background:#eef}
      .rtf-num{text-align:right;font-variant-numeric:tabular-nums}.rtf-no{text-align:center;background:#fde}.rtf-buy .rtf-no{background:#def}
      .rtf-orig{color:#666;display:block}.rtf-rev{display:block;font-weight:700}.rtf-chg .rtf-rev{color:#c00}input{border:0;width:100%;text-align:right;font:inherit}
      .rtf-group{writing-mode:vertical-rl;text-align:center}.rtf-src,.rtf-legend{display:none}
    </style></head><body><h2>${p.title}${filed ? ` · ${filed.revision === 0 ? "정기" : `${filed.revision}차 수정`} 마감본` : ""}</h2>${html}</body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  const cellVal = (key: string, f: "amount" | "tax" | "n") => {
    const now = current[key]?.[f];
    if (!showCompare) return <span>{won(now)}</span>;
    const before = filed!.figures?.[key]?.[f];
    const diff = Math.round(Number(before || 0)) !== Math.round(Number(now || 0));
    return <span className={diff ? "rtf-chg" : undefined}><span className="rtf-orig">{won(before)}</span><span className="rtf-rev">{won(now)}</span></span>;
  };
  const manualCell = (no: string, f: "amount" | "tax") => (
    <CurrencyInput className="rtf-input" value={String(manual[no]?.[f] ?? "")} placeholder="0"
      onValueChange={(raw) => setManual((m) => ({ ...m, [no]: { ...m[no], [f]: raw === "" ? 0 : Number(raw) } }))} />
  );
  //   사람 칸은 비교 보기에서도 '수정' 줄 자리에서 고친다 — 당초는 위 줄에 남는다
  const numCell = (no: string, f: "amount" | "tax", kind: string) => {
    if (kind !== "manual" || !p.canWrite) return cellVal(no, f);
    if (!showCompare) return manualCell(no, f);
    const before = filed!.figures?.[no]?.[f];
    const diff = Math.round(Number(before || 0)) !== Math.round(Number(current[no]?.[f] || 0));
    return <span className={diff ? "rtf-chg" : undefined}><span className="rtf-orig">{won(before)}</span>{manualCell(no, f)}</span>;
  };

  const vatTable = () => {
    const G: Record<string, string> = { sale: "과세표준 및 매출세액", buy: "매입세액", reduce: "경감·공제세액" };
    const firstOf = (i: number, key: "group" | "sub") => i === 0 || VAT_LINES[i - 1][key] !== VAT_LINES[i][key];
    const spanOf = (i: number, key: "group" | "sub") => { let n = 1; while (VAT_LINES[i + n] && VAT_LINES[i + n][key] === VAT_LINES[i][key]) n++; return n; };
    return (
      <table className="rtf-table">
        <thead><tr><th colSpan={3}>구분</th><th>칸</th><th>금액</th><th>세율</th><th>세액</th></tr></thead>
        <tbody>
          {VAT_LINES.map((l, i) => {
            const hasGroup = !!G[l.group];
            const gCell = hasGroup && firstOf(i, "group") ? <td className="rtf-group" rowSpan={spanOf(i, "group")}>{G[l.group]}</td> : null;
            const sCell = l.sub && firstOf(i, "sub") ? <td className="rtf-sub" rowSpan={spanOf(i, "sub")}>{l.sub}</td> : null;
            const labelSpan = hasGroup ? (l.sub ? 1 : 2) : 3;
            const sum = l.kind === "sum";
            return (
              <tr key={l.no} className={`${l.group === "buy" ? "rtf-buy" : ""} ${sum ? "rtf-sum" : ""} ${filed && changed.includes(l.no) ? "rtf-row-chg" : ""}`}>
                {gCell}{sCell}
                <td className="rtf-label" colSpan={labelSpan}>{l.label}{l.kind === "manual" && <span className="rtf-src">직접 입력</span>}{l.hint && l.kind !== "manual" && <span className="rtf-src">{l.hint}</span>}</td>
                <td className="rtf-no">{l.no === "da" ? "" : `(${l.no})`}</td>
                <td className="rtf-num">{l.fields.includes("amount") ? numCell(l.no, "amount", l.kind) : null}</td>
                <td className="rtf-rate">{l.rate || ""}</td>
                <td className="rtf-num">{l.fields.includes("tax") ? numCell(l.no, "tax", l.kind) : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };
  const whtTable = () => {
    const firstOf = (i: number) => i === 0 || WHT_LINES[i - 1].group !== WHT_LINES[i].group;
    const spanOf = (i: number) => { let n = 1; while (WHT_LINES[i + n] && WHT_LINES[i + n].group === WHT_LINES[i].group) n++; return n; };
    return (
      <table className="rtf-table">
        <thead><tr><th colSpan={2}>소득자 소득 구분</th><th>코드</th><th>인원</th><th>총지급액</th><th>소득세 등</th></tr></thead>
        <tbody>
          {WHT_LINES.map((l, i) => (
            <tr key={l.code} className={`${l.sum ? "rtf-sum" : ""} ${filed && changed.includes(l.code) ? "rtf-row-chg" : ""}`}>
              {l.group === l.label
                ? <td className="rtf-label" colSpan={2}>{l.label}</td>
                : <>{firstOf(i) && <td className="rtf-sub" rowSpan={spanOf(i)}>{l.group}</td>}<td className="rtf-label">{l.label}</td></>}
              <td className="rtf-no">{l.code}</td>
              <td className="rtf-num">{cellVal(l.code, "n")}</td>
              <td className="rtf-num">{cellVal(l.code, "amount")}</td>
              <td className="rtf-num">{cellVal(l.code, "tax")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  //   마감 시각은 한국 시간으로(DB 는 UTC)
  const when = (s: string) => new Date(s).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
  return (
    <div className="rtf-wrap">
      {/* 마감 줄 — 상태 한 줄 + 실행. 파란 버튼은 여기 하나 */}
      <div className={`rtf-close ${filed && changed.length ? "rtf-close-warn" : ""}`}>
        <span className="rtf-close-state">
          {listLoading ? "신고본 확인 중…"
            : !filed ? <><b>마감 전</b> · 지금 자료로 계산한 숫자입니다{list.some((r) => r.status === "cancelled") ? " (취소한 마감 기록 있음)" : ""}</>
            : <>
                <b>{filed.revision === 0 ? "정기" : `${filed.revision}차 수정`} 마감</b> · {when(filed.closed_at)} · {filed.closer?.name || "—"}
                {changed.length === 0
                  ? <> · 지금 자료와 같습니다</>
                  : <> · <b className="rtf-warn">마감 뒤 바뀐 칸 {changed.length}개</b>{(srcDiff.added || srcDiff.removed) ? ` (자료 +${srcDiff.added} −${srcDiff.removed})` : ""} → <b>{revisedKind}</b> 대상 · 당초 {won(filedTax)} → 수정 {won(nowTax)}</>}
              </>}
        </span>
        <span className="rtf-close-actions">
          {filed && changed.length > 0 && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCompare((v) => !v)}>{compare ? "수정본만 보기" : "당초·수정 비교"}</button>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={print}>인쇄</button>
          {p.canWrite && filed && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={doCancel}>마감 취소</button>}
          {p.canWrite && (!filed || changed.length > 0) && (
            <button type="button" className="btn-primary btn-sm" disabled={busy || !!p.loading || listLoading || !p.companyId}
              title="홈택스에 낸 숫자를 신고본으로 남깁니다. 제출은 홈택스에서 따로 합니다" onClick={doClose}>
              {busy ? "저장 중…" : filed ? `${filed.revision + 1}차 수정본 마감` : "마감"}
            </button>
          )}
        </span>
      </div>
      {showCompare && <p className="rtf-legend">칸마다 위 = 당초(마감한 숫자), 아래 = 수정(지금 자료). 바뀐 칸은 빨간색입니다. {revisedKind === "경정청구" ? "세액이 줄어 경정청구 대상입니다(국세기본법 45조의2)." : "세액이 늘면 수정신고 대상입니다(국세기본법 45조) — 가산세는 세무사와 확인하세요."}</p>}
      {!filed && p.defaultManualNote && <p className="rtf-legend">{p.defaultManualNote}</p>}
      <div ref={sheetRef} className="rtf-sheet">
        {p.layout === "vat" ? vatTable() : whtTable()}
      </div>
    </div>
  );
}
