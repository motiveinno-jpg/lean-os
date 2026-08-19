"use client";

// 손익 현황 › 요약 — "이번 달 벌었나, 무엇이 달라졌나, 살펴볼 것" (2026-08-19 기획, docs/20260819_PLAN_pnl_status_redesign.md)
//   기준 = 확정 전표(손익계산서와 같은 숫자). 머리 = 기간·비교 ‖ 엑셀·인쇄 + 핵심 지표 5.
//   본문 = ① 한 문장 상태 ② 손익 구조(폭포수) ③ 무엇이 달라졌나(항목별 증감 표) ④ 살펴볼 것(규칙 4개, 처리는 사람).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { WaterfallChart } from "@/components/charts/kit";
import { downloadCsv } from "@/lib/csv-export";
import { groupByAccount, fetchReceivables, pnlAmount, rangeLabel, type JournalLine } from "@/lib/pnl-status";
import { usePnlStatus, PnlHead, BasisNote, CoreStats, Delta, DrillModal, won, num, cmpRangeLabel, type Drill } from "../_components/PnlStatusKit";

const SECTIONS: { key: JournalLine["section"]; label: string; sign: 1 | -1 }[] = [
  { key: "revenue", label: "매출", sign: 1 },
  { key: "cogs", label: "매출원가", sign: -1 },
  { key: "opex", label: "판매비와관리비", sign: -1 },
  { key: "nonop_income", label: "영업외수익", sign: 1 },
  { key: "nonop_expense", label: "영업외비용", sign: -1 },
  { key: "tax", label: "법인세 등", sign: -1 },
];

export default function ProfitSummaryPage() {
  const { role } = useUser();
  const s = usePnlStatus();
  const [drill, setDrill] = useState<Drill | null>(null);
  const [openSec, setOpenSec] = useState<Set<string>>(new Set(["opex"]));

  const { data: ar } = useQuery({ queryKey: ["pnl-status-ar", s.companyId], queryFn: () => fetchReceivables(s.companyId!), enabled: !!s.companyId, staleTime: 60_000 });

  //   항목별 이번 기간 / 비교 기간 — 구역(매출·원가·판관비…) 아래 계정 줄
  const rowsBySection = useMemo(() => {
    const curBy = new Map<string, number>(), cmpBy = new Map<string, number>(), name = new Map<string, string>();
    for (const l of s.curLines) { curBy.set(l.accountId, (curBy.get(l.accountId) || 0) + pnlAmount(l)); name.set(l.accountId, l.name); }
    for (const l of s.cmpLines) { cmpBy.set(l.accountId, (cmpBy.get(l.accountId) || 0) + pnlAmount(l)); name.set(l.accountId, l.name); }
    const secOf = new Map<string, JournalLine["section"]>();
    for (const l of [...s.curLines, ...s.cmpLines]) secOf.set(l.accountId, l.section);
    return SECTIONS.map((sec) => {
      const ids = [...new Set([...curBy.keys(), ...cmpBy.keys()])].filter((id) => secOf.get(id) === sec.key);
      const accts = ids.map((id) => ({ id, name: name.get(id) || "", cur: curBy.get(id) || 0, cmp: cmpBy.get(id) || 0 })).sort((a, b) => Math.abs(b.cur) - Math.abs(a.cur));
      return { ...sec, accts, cur: accts.reduce((x, a) => x + a.cur, 0), cmp: accts.reduce((x, a) => x + a.cmp, 0) };
    });
  }, [s.curLines, s.cmpLines]);

  //   살펴볼 것 규칙 ① 급증 비용: 전월 대비 +50% 이상 · 판관비의 5% 이상 · 상위 5
  const spikes = useMemo(() => {
    const opex = rowsBySection.find((r) => r.key === "opex");
    if (!opex || s.cur.opex <= 0) return [];
    return opex.accts.filter((a) => a.cmp > 0 && a.cur >= a.cmp * 1.5 && a.cur >= s.cur.opex * 0.05).sort((a, b) => (b.cur - b.cmp) - (a.cur - a.cmp)).slice(0, 5);
  }, [rowsBySection, s.cur.opex]);

  if (role === "partner") return <AccessDenied detail="손익 현황은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const cur = s.cur, cmp = s.cmp;
  const rate = cur.revenue > 0 ? Math.round((cur.operating / cur.revenue) * 1000) / 10 : null; // 매출 0 이하면 이익률은 뜻이 없다 → '—'
  const man = (n: number) => `${Math.round(Math.abs(n) / 10000).toLocaleString("ko-KR")}만원`;
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));
  const revP = pct(cur.revenue, cmp.revenue), opexP = pct(cur.opex, cmp.opex);
  const headline = s.loading ? "불러오는 중…" : cur.lines === 0
    ? `${rangeLabel(s.range)}에는 확정 전표가 없습니다 — 수집·전표에서 전표를 만들면 여기 손익이 채워집니다.`
    : `${rangeLabel(s.range)}은 ${cur.operating >= 0 ? `${man(cur.operating)} 남았습니다` : `${man(cur.operating)} 손실입니다`} — 매출은 ${s.cmpLabel}보다 ${revP === null ? "비교할 값이 없고" : revP > 0 ? `${revP}% 늘고` : revP < 0 ? `${Math.abs(revP)}% 줄고` : "비슷하고"}, 판관비는 ${opexP === null ? "비교할 값이 없습니다" : opexP > 0 ? `${opexP}% 늘었습니다` : opexP < 0 ? `${Math.abs(opexP)}% 줄었습니다` : "비슷합니다"}.`;
  const subline = spikes.length > 0
    ? `${spikes.slice(0, 2).map((a) => `${a.name}(+${man(a.cur - a.cmp)})`).join("·")}이 늘어난 것이 판관비 변화의 큰 부분입니다.`
    : cur.lines > 0 ? "전월 대비 크게 늘어난 비용 계정은 없습니다." : "";

  const openDrill = (title: string, filter: (l: JournalLine) => boolean) => setDrill({ title, sub: rangeLabel(s.range), lines: s.curLines.filter(filter) });
  const toggleSec = (k: string) => setOpenSec((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const excel = [{
    label: "무엇이 달라졌나 표", count: rowsBySection.reduce((n, r) => n + r.accts.length + 1, 0),
    onClick: () => downloadCsv(`손익요약_${s.range.fromYm}_${s.range.toYm}`, ["구분", "항목", rangeLabel(s.range), cmpRangeLabel(s), "증감"],
      rowsBySection.flatMap((r) => [[r.label, "합계", Math.round(r.cur), Math.round(r.cmp), Math.round(r.cur - r.cmp)], ...r.accts.map((a) => [r.label, a.name, Math.round(a.cur), Math.round(a.cmp), Math.round(a.cur - a.cmp)])])),
  }];

  return (
    <>
      <PnlHead s={s} stats={<CoreStats cur={cur} cmp={cmp} />} excel={excel} />
      <BasisNote s={s} />

      {/* ① 한 문장 상태 */}
      <div className="pnl-headline">
        <b>{headline}</b>
        {subline && <div className="pnl-headline-sub">{subline}{ar && ar.over30 > 0 && <> 30일 넘은 미수금 {man(ar.over30)}({ar.over30Partners}곳)은 회수가 필요합니다.</>}</div>}
      </div>

      <div className="pnl-grid2">
        {/* ② 손익 구조 */}
        <section className="pnl-panel">
          <h3>손익 구조</h3>
          <p>매출에서 무엇이 빠져 영업이익이 남는지 · 영업이익률 {rate === null ? "—" : `${rate}%`}</p>
          {cur.lines === 0 ? <div className="collect-empty">전표가 없어 그릴 것이 없습니다</div> : (
            <WaterfallChart height={200} unit="원" steps={[
              { label: "매출", value: cur.revenue, kind: "add" },
              { label: "매출원가", value: cur.cogs, kind: "sub" },
              { label: "매출총이익", value: cur.gross, kind: "total" },
              { label: "판관비", value: cur.opex, kind: "sub" },
              { label: "영업이익", value: cur.operating, kind: "total" },
            ]} />
          )}
        </section>

        {/* ③ 무엇이 달라졌나 */}
        <section className="pnl-panel">
          <h3>무엇이 달라졌나</h3>
          <p>{rangeLabel(s.range)} vs {cmpRangeLabel(s)}({s.cmpLabel}) · 항목별 증감 — 구분을 누르면 계정이 펼쳐지고, 계정을 누르면 원천 전표</p>
          <div className="pnl-tbl-wrap">
            <table className="ev-table ev-lined pnl-diff-table">
              <thead><tr><th className="text-left">항목</th><th>{rangeLabel(s.range)}</th><th>{cmpRangeLabel(s)}</th><th>증감</th><th>%</th></tr></thead>
              <tbody>
                {rowsBySection.map((r) => (
                  <RowGroup key={String(r.key)} r={r} open={openSec.has(String(r.key))} onToggle={() => toggleSec(String(r.key))}
                    onDrill={(a) => openDrill(a ? a.name : r.label, (l) => (a ? l.accountId === a.id : l.section === r.key))} />
                ))}
                <tr className="pnl-row-total"><td className="text-left">영업이익</td><td className="text-right mono-number">{num(cur.operating)}</td><td className="text-right mono-number">{num(cmp.operating)}</td><td className="text-right mono-number">{num(cur.operating - cmp.operating)}</td><td className="text-center"><Delta cur={cur.operating} prev={cmp.operating} /></td></tr>
                <tr className="pnl-row-total"><td className="text-left">당기순이익</td><td className="text-right mono-number">{num(cur.net)}</td><td className="text-right mono-number">{num(cmp.net)}</td><td className="text-right mono-number">{num(cur.net - cmp.net)}</td><td className="text-center"><Delta cur={cur.net} prev={cmp.net} /></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ④ 살펴볼 것 — 규칙 4개, 링크만 */}
      <section className="pnl-panel">
        <h3>살펴볼 것</h3>
        <p>규칙 4개로만 고릅니다(출처를 적습니다) — 처리는 사람이 합니다</p>
        <ul className="pnl-watch">
          {spikes.map((a) => (
            <li key={a.id}><span className="pnl-flag">급증</span><span>{a.name} — {s.cmpLabel} 대비 <b>+{Math.round(((a.cur - a.cmp) / a.cmp) * 100)}%</b> ({won(a.cur - a.cmp)})</span><em>장부 대조</em><button type="button" className="pnl-watch-link" onClick={() => openDrill(a.name, (l) => l.accountId === a.id)}>원천 전표 →</button></li>
          ))}
          {ar && ar.over30 > 0 && (
            <li><span className="pnl-flag">미수금</span><span>30일 넘은 미수금 <b>{won(ar.over30)}</b> · {ar.over30Partners}곳</span><em>세금계산서 상태</em><Link href="/partners/ledger" className="pnl-watch-link">거래처 원장 →</Link></li>
          )}
          {s.data && s.data.unclassified.count > 0 && (
            <li><span className="pnl-flag pnl-flag-w">미분류</span><span>계정 없는 통장 출금 <b>{won(s.data.unclassified.amount)}</b> · {s.data.unclassified.count}건 — 판관비에 안 들어가 있음</span><em>통장</em><Link href="/collect?tab=bank" className="pnl-watch-link">수집·전표 →</Link></li>
          )}
          {s.data && s.data.unposted.total > 0 && (
            <li><span className="pnl-flag pnl-flag-w">전표 미처리</span><span>세금계산서 {s.data.unposted.taxInvoice.toLocaleString()} · 카드 {s.data.unposted.card.toLocaleString()} · 통장 {s.data.unposted.bank.toLocaleString()}건</span><em>수집 현황</em><Link href="/collect" className="pnl-watch-link">수집·전표 →</Link></li>
          )}
          {!s.loading && spikes.length === 0 && !(ar && ar.over30 > 0) && !(s.data && (s.data.unclassified.count > 0 || s.data.unposted.total > 0)) && (
            <li className="text-[var(--text-dim)]">살펴볼 것이 없습니다.</li>
          )}
        </ul>
      </section>

      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}

function RowGroup({ r, open, onToggle, onDrill }: {
  r: { key: JournalLine["section"]; label: string; sign: 1 | -1; cur: number; cmp: number; accts: { id: string; name: string; cur: number; cmp: number }[] };
  open: boolean; onToggle: () => void; onDrill: (a?: { id: string; name: string; cur: number; cmp: number }) => void;
}) {
  if (r.accts.length === 0 && r.cur === 0 && r.cmp === 0) return null;
  const invert = r.sign === -1;
  return (
    <>
      <tr className="pnl-row-sec" onClick={onToggle}>
        <td className="text-left"><span className={`bs-caret ${open ? "rotate-90" : ""}`}>▸</span>{r.label}<em className="bs-cnt">{r.accts.length}</em></td>
        <td className="text-right mono-number">{num(r.cur)}</td>
        <td className="text-right mono-number">{num(r.cmp)}</td>
        <td className={`text-right mono-number ${r.cur - r.cmp === 0 ? "" : (r.cur - r.cmp > 0) !== invert ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{num(r.cur - r.cmp)}</td>
        <td className="text-center"><Delta cur={r.cur} prev={r.cmp} invert={invert} /></td>
      </tr>
      {open && r.accts.map((a) => (
        <tr key={a.id} className="pnl-row-acct" onClick={() => onDrill(a)} title="원천 전표 보기">
          <td className="text-left"><span className="pl-6">{a.name}</span></td>
          <td className="text-right mono-number">{num(a.cur)}</td>
          <td className="text-right mono-number">{num(a.cmp)}</td>
          <td className={`text-right mono-number ${a.cur - a.cmp === 0 ? "" : (a.cur - a.cmp > 0) !== invert ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{num(a.cur - a.cmp)}</td>
          <td className="text-center"><Delta cur={a.cur} prev={a.cmp} invert={invert} size="xs" /></td>
        </tr>
      ))}
    </>
  );
}
