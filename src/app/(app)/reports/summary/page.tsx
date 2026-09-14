"use client";

// 경영 요약 — "지금 우리 회사 괜찮나?"에 답하는 대표용 진입 화면.
//   2026-07-08 신설(문장 1줄 + 신호등 카드 + 손익 3칸 + 예정 3줄) → 2026-08-19 재편(docs/20260819_PLAN_summary_outlook_redesign.md):
//   세 신호 판(돈 있나 / 벌고 있나 / 받을 돈·낼 돈 — 신호등·숫자·왜·링크) + 이번 주 챙길 것(규칙, 사람이 체크) + 지난달과 달라진 것.
//   기준 통일: 손익=확정 전표 · 현금=통장 · 받을·낼 돈=거래처 원장(정산 반영). 계산은 전부 lib/biz-summary.ts (대시보드 위젯과 같은 함수).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportHead } from "../_components/ReportHead";
import { Stat, ExcelMenu } from "@/components/query-kit";
import { downloadCsv } from "@/lib/csv-export";
import { fetchBizSummary, type Tone, type Todo } from "@/lib/biz-summary";
import { todayKst } from "@/lib/kst";

const won = (n: number) => `${n < 0 ? "−" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const num = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
const man = (n: number) => { const a = Math.abs(n), sg = n < 0 ? "−" : ""; return a >= 1e8 ? `${sg}${(a / 1e8).toFixed(1)}억원` : `${sg}${Math.round(a / 10000).toLocaleString("ko-KR")}만원`; };
const TONE_TXT: Record<Tone, string> = { g: "안정", y: "주의", r: "위험" };
const shift = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const monthLabel = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
//   챙길 것 체크 — 이번 주(월요일 기준) 동안 숨긴다. 2026-08-31 서버(weekly_todo_checks) 저장으로 전환:
//   localStorage(사용자·PC별)는 다른 기기에서 다시 나타나거나, 미해결인데 한 기기에서만 숨겨졌다.
const weekKey = (d: string) => { const t = new Date(d + "T00:00:00"); const dow = (t.getDay() + 6) % 7; t.setDate(t.getDate() - dow); return t.toISOString().slice(0, 10); };

function Pct({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (p === 0) return <small className="bz-pct bz-pct-flat">지난달과 같음</small>;
  const good = invert ? p < 0 : p > 0;
  return <small className={`bz-pct ${good ? "bz-pct-good" : "bz-pct-bad"}`}>{p > 0 ? "▲" : "▼"}{Math.abs(p)}%</small>;
}

export default function ManagementSummaryPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const thisMonth = todayKst().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  useEffect(() => { getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } }); }, []);
  const qcW = useQueryClient();
  const wk = weekKey(todayKst());
  const { data: done = new Set<string>() } = useQuery({
    queryKey: ["weekly-todo-checks", companyId, wk],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead("reports/summary:checks", await (supabase as any).from("weekly_todo_checks")
        .select("todo_key").eq("company_id", companyId!).eq("week_key", wk));
      return new Set(((data || []) as { todo_key: string }[]).map((r) => r.todo_key));
    },
  });
  const toggleDone = async (k: string) => {
    if (!companyId) return;
    try {
      if (done.has(k)) {
        await (supabase as any).from("weekly_todo_checks").delete()
          .eq("company_id", companyId).eq("week_key", wk).eq("todo_key", k);
      } else {
        await (supabase as any).from("weekly_todo_checks").upsert(
          { company_id: companyId, week_key: wk, todo_key: k, checked_by: userId },
          { onConflict: "company_id,week_key,todo_key" });
      }
      qcW.invalidateQueries({ queryKey: ["weekly-todo-checks"] });
    } catch { /* 실패 시 다음 클릭에서 재시도 */ }
  };

  const { data: s, isLoading } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId!, month, userId || undefined),
    enabled: !!companyId, staleTime: 60_000,
  });
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => shift(thisMonth, -i)), [thisMonth]);

  if (role === "partner") return <AccessDenied detail="경영 요약은 회사 구성원 전용입니다 (외부 파트너 제외)." />;

  const todosOpen = (s?.todos || []).filter((t) => !done.has(t.key));
  const todosDone = (s?.todos || []).filter((t) => done.has(t.key));
  const excel = s ? [
    { label: "이번 주 To-do", count: s.todos.length, onClick: () => downloadCsv(`경영요약_ToDo_${month}`, ["구분", "내용", "메모", "금액", "확인"], s.todos.map((t) => [t.kind, t.text, t.sub || "", t.amount ? Math.round(t.amount) : "", done.has(t.key) ? "확인" : ""])) },
    { label: "전월 대비 주요 변동", count: s.changes.length, onClick: () => downloadCsv(`경영요약_전월대비_${month}`, ["항목", "전월", "당월", "증감"], s.changes.map((c) => [c.label, Math.round(c.prev), Math.round(c.cur), Math.round(c.cur - c.prev)])) },
  ] : [];
  const seriesMax = Math.max(1, ...(s?.pnl.series.map((x) => Math.abs(x.op)) || [1]));

  const TodoRow = ({ t }: { t: Todo }) => (
    <li className={`bz-todo ${done.has(t.key) ? "bz-todo-done" : ""}`}>
      <input type="checkbox" checked={done.has(t.key)} onChange={() => toggleDone(t.key)} aria-label="확인" />
      <span className={`bz-kind bz-kind-${t.tone}`}>{t.kind}</span>
      <span className="bz-todo-text">{t.text}{t.sub && <small> {t.sub}</small>}</span>
      {t.amount !== undefined && <b className="mono-number bz-todo-amt">{won(t.amount)}</b>}
      {t.href && <Link href={t.href} className="bz-link">보기 →</Link>}
    </li>
  );

  return (
    <>
      <ReportHead
        bar={<>
          <label className="text-xs font-semibold text-[var(--text-dim)]">기준 월</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="qk-input h-8 px-2.5 text-xs">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span className="text-[11px] text-[var(--text-dim)]">오늘 {todayKst()}</span>
        </>}
        right={<><ExcelMenu items={excel} /><button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button></>}
        stats={s ? <>
          <Stat label="종합 상태" value={<span className={`bz-tone-${s.overall.tone}`}>{s.overall.label}</span>} />
          <Stat label="통장 잔액" value={won(s.cash.balance)} />
          <Stat label={`${Number(month.slice(5))}월 영업이익`} value={won(s.pnl.cur.operating)} tone={s.pnl.cur.operating >= 0 ? "plus" : "minus"} />
          <Stat label="자금 운용 가능 기간" value={s.cash.runway >= 999 ? "무기한" : `${s.cash.runway.toFixed(1)}개월`} />
          <Stat label="미수금" value={won(s.arap.ar)} tone="plus" />
          <Stat label="30일 내 지급 예정" value={won(s.arap.due30)} tone="minus" />
        </> : <span className="text-[11px] text-[var(--text-dim)]">불러오는 중…</span>}
      />

      {isLoading || !s ? <div className="collect-empty">불러오는 중…</div> : (
        <div className="bz-body">
          {/* 손익 현황과 같은 머리 — 기준 한 줄 + 한 문장 결론 (규칙 기반, LLM 아님) */}
          <div className="pnl-basis-note">
            <b>손익 = 확정 전표 · 자금 = 통장 · 채권·채무 = 거래처 원장</b>
            {s.pnl.unposted.total > 0 ? <> — 전표 미생성 자료 <b className="text-[var(--warning)]">{s.pnl.unposted.total.toLocaleString()}건</b>은 손익 미반영 · <Link href="/collect" className="font-semibold text-[var(--primary)]">수집·전표 →</Link></> : <> — 당월 자료는 모두 전표에 반영되었습니다.</>}
          </div>
          <div className="pnl-headline">
            <b>
              {s.overall.tone === "g"
                ? `종합 상태 안정. ${Number(month.slice(5))}월 영업이익 ${won(s.pnl.cur.operating)}, 통장 잔액 ${man(s.cash.balance)} 기준 자금 운용 가능 기간 ${s.cash.runway >= 999 ? "제한 없음" : `${s.cash.runway.toFixed(1)}개월`}.`
                : `${s.overall.label} — ${[
                  s.cash.tone !== "g" ? `자금 운용 가능 기간 ${s.cash.runway.toFixed(1)}개월` : null,
                  s.pnl.tone !== "g" ? `${Number(month.slice(5))}월 영업손실 ${man(-s.pnl.cur.operating)}${s.pnl.unposted.taxInvoice > 0 ? "(미처리 전표 있음)" : ""}` : null,
                  s.arap.tone !== "g" ? (s.cash.balance < s.arap.due30 ? "30일 내 지급 예정액이 통장 잔액 초과" : `30일 초과 미수금 ${man(s.arap.over30)}`) : null,
                ].filter(Boolean).join(" · ")}`}
            </b>
            <div className="pnl-headline-sub">통장 잔액 {man(s.cash.balance)} · 당월 순현금흐름 {man(s.cash.inflow - s.cash.outflow)} · 미수금 {man(s.arap.ar)} · 30일 내 지급 예정 {man(s.arap.due30)}{s.todos.length > 0 && <> · 이번 주 To-do <b>{s.todos.length}건</b></>}</div>
          </div>
          {/* ── 세 신호 ── */}
          <div className="bz-grid3">
            <section className="pnl-panel bz-signal">
              <h3><i className={`bz-dot bz-dot-${s.cash.tone}`} />자금 현황 · 통장 <em className={`bz-tone-${s.cash.tone}`}>{TONE_TXT[s.cash.tone]}</em></h3>
              <div className="bz-big mono-number">{won(s.cash.balance)}</div>
              <dl className="bz-kv">
                <div><dt>{Number(month.slice(5))}월 입금</dt><dd className="mono-number bz-plus">+{num(s.cash.inflow)}</dd></div>
                <div><dt>{Number(month.slice(5))}월 출금</dt><dd className="mono-number bz-minus">−{num(s.cash.outflow)}</dd></div>
                <div><dt>순현금흐름</dt><dd className={`mono-number ${s.cash.inflow - s.cash.outflow >= 0 ? "bz-plus" : "bz-minus"}`}>{num(s.cash.inflow - s.cash.outflow)} <Pct cur={s.cash.inflow - s.cash.outflow} prev={s.cash.prevNet} /></dd></div>
                <div><dt>자금 운용 가능 기간</dt><dd className="mono-number">{s.cash.runway >= 999 ? "제한 없음" : `${s.cash.runway.toFixed(1)}개월`}</dd></div>
              </dl>
              <p className="bz-why">
                {!s.cash.hasBank ? <>연결된 통장이 없습니다 — <Link href="/bank" className="bz-link">통장 연결 →</Link></>
                  : <>월 고정 지출 약 {man(s.cash.burn)}(정기 지출+급여) 기준.{s.arap.vatNext && s.arap.vatNext.pay && s.cash.runwayAfterVat !== s.cash.runway && <> 부가세 {man(s.arap.vatNext.amount)}이 {s.arap.vatNext.due.slice(5).replace("-", "/")} 납부 후 <b>{s.cash.runwayAfterVat.toFixed(1)}개월</b>.</>} <Link href="/reports/outlook" className="bz-link">자금 전망 →</Link></>}
              </p>
            </section>

            <section className="pnl-panel bz-signal">
              <h3><i className={`bz-dot bz-dot-${s.pnl.tone}`} />손익 현황 · 확정 전표 <em className={`bz-tone-${s.pnl.tone}`}>{TONE_TXT[s.pnl.tone]}</em></h3>
              <div className={`bz-big mono-number ${s.pnl.cur.operating >= 0 ? "bz-plus" : "bz-minus"}`}>{won(s.pnl.cur.operating)}</div>
              <dl className="bz-kv">
                <div><dt>매출</dt><dd className="mono-number">{num(s.pnl.cur.revenue)} <Pct cur={s.pnl.cur.revenue} prev={s.pnl.prev.revenue} />{s.pnl.cur.revenue === 0 && <small className="text-[var(--text-dim)]"> (전표 없음)</small>}</dd></div>
                <div><dt>비용 (원가+판관비)</dt><dd className="mono-number">{num(s.pnl.cur.cogs + s.pnl.cur.opex)} <Pct cur={s.pnl.cur.cogs + s.pnl.cur.opex} prev={s.pnl.prev.cogs + s.pnl.prev.opex} invert /></dd></div>
                <div><dt>전월 영업이익</dt><dd className={`mono-number ${s.pnl.prev.operating >= 0 ? "bz-plus" : "bz-minus"}`}>{num(s.pnl.prev.operating)}</dd></div>
              </dl>
              <div className="bz-bars" aria-label="최근 6개월 영업이익">
                {s.pnl.series.map((x) => (
                  <Link key={x.month} href="/reports/monthly" className="bz-bar-col" title={`${x.month} ${won(x.op)}`}>
                    <i className={x.op >= 0 ? "bz-bar-p" : "bz-bar-n"} style={{ height: `${Math.max(3, (Math.abs(x.op) / seriesMax) * 40)}px` }} />
                    <small>{x.month.slice(5)}</small>
                  </Link>
                ))}
              </div>
              <p className="bz-why">
                {s.pnl.unposted.taxInvoice > 0 ? <>세금계산서 <b>{s.pnl.unposted.taxInvoice}건 미처리</b>{s.pnl.unpostedSalesAmt > 0 && <>(매출 {won(s.pnl.unpostedSalesAmt)})</>} · 전표 확정 시 금액이 반영됩니다.  <Link href="/collect" className="bz-link">수집·전표 →</Link></>
                  : s.pnl.cur.operating >= 0 ? <>이익률 {s.pnl.cur.revenue > 0 ? `${Math.round((s.pnl.cur.operating / s.pnl.cur.revenue) * 100)}%` : "—"}. <Link href="/reports/profit" className="bz-link">손익 현황 →</Link></>
                  : <>비용이 매출을 초과했습니다. <Link href="/reports/expense" className="bz-link">비용 분석 →</Link></>}
              </p>
            </section>

            <section className="pnl-panel bz-signal">
              <h3><i className={`bz-dot bz-dot-${s.arap.tone}`} />채권·채무 현황 · 거래처 원장 <em className={`bz-tone-${s.arap.tone}`}>{TONE_TXT[s.arap.tone]}</em></h3>
              <dl className="bz-kv">
                <div><dt>매출채권 (미수금)</dt><dd className="mono-number bz-plus">{num(s.arap.ar)}</dd></div>
                <div className="bz-kv-sub"><dt>└ 30일 초과 · {s.arap.over30Partners}곳</dt><dd className={`mono-number ${s.arap.over30 > 0 ? "bz-minus" : ""}`}>{num(s.arap.over30)}</dd></div>
                <div><dt>미지급금 잔액 <small className="text-[var(--text-dim)]">(만기 없음)</small></dt><dd className="mono-number">{num(s.arap.ap)}</dd></div>
                {s.arap.vatNext && <div><dt>부가세 {s.arap.vatNext.pay ? "납부" : "환급"} ({s.arap.vatNext.due.slice(5).replace("-", "/")} · D-{s.arap.vatNext.dday})</dt><dd className={`mono-number ${s.arap.vatNext.pay ? "" : "bz-plus"}`}>{s.arap.vatNext.pay ? "" : "+"}{num(s.arap.vatNext.amount)}</dd></div>}
                <div><dt>급여 (등록 급여 합계)</dt><dd className="mono-number">{num(s.arap.salary)}</dd></div>
                {s.arap.loanMonthly > 0 && <div><dt>대출 월 상환</dt><dd className="mono-number">{num(s.arap.loanMonthly)}</dd></div>}
                {s.arap.recurring > 0 && <div><dt>정기 지출</dt><dd className="mono-number">{num(s.arap.recurring)}</dd></div>}
              </dl>
              <p className="bz-why">
                30일 내 지급 예정(급여·정기 지출·대출·부가세) <b>{won(s.arap.due30)}</b>{s.cash.balance < s.arap.due30 ? <> — <b className="bz-minus">통장 잔액 초과</b>.</> : <> — 통장 잔액으로 충당 가능.</>}
                {s.arap.over30 > 0 && <> 30일 초과 미수금 {man(s.arap.over30)} 회수 시 자금 여력이 늘어납니다.</>} <Link href="/partners/ledger" className="bz-link">거래처 원장 →</Link>
              </p>
            </section>
          </div>

          {/* ── 챙길 것 · 달라진 것 ── */}
          <div className="bz-grid2">
            <section className="pnl-panel">
              <h3>이번 주 To-do <small className="text-[var(--text-dim)] font-normal">{todosOpen.length}건</small></h3>
              <p>이번 주 처리할 업무입니다. 완료 체크 시 아래로 이동합니다.</p>
              {todosOpen.length === 0 && todosDone.length === 0 ? <div className="collect-empty">이번 주 To-do가 없습니다</div> : (
                <ul className="bz-todos">
                  {todosOpen.map((t) => <TodoRow key={t.key} t={t} />)}
                  {todosDone.map((t) => <TodoRow key={t.key} t={t} />)}
                </ul>
              )}
            </section>
            <section className="pnl-panel">
              <h3>전월 대비 주요 변동</h3>
              <p>{monthLabel(s.prevMonth)} → {monthLabel(month)} · 증감액 큰 순 (확정 전표 계정 + 통장 순현금흐름). 행 클릭 시 해당 화면으로 이동합니다.</p>
              {s.changes.length === 0 ? <div className="collect-empty">전월·당월 모두 전표가 없어 비교할 항목이 없습니다</div> : (
                <div className="pnl-tbl-wrap">
                  <table className="ev-table ev-lined pnl-mini-table">
                    <thead><tr><th className="text-left">항목</th><th>전월</th><th>당월</th><th>증감</th></tr></thead>
                    <tbody>
                      {s.changes.map((c) => {
                        const d = c.cur - c.prev; const good = c.invert ? d < 0 : d > 0;
                        return (
                          <tr key={c.key} className="pnl-row-acct" onClick={() => c.href && (window.location.href = c.href)}>
                            <td className="text-left font-semibold">{c.label}</td>
                            <td className="text-right mono-number">{num(c.prev)}</td>
                            <td className="text-right mono-number">{num(c.cur)}</td>
                            <td className={`text-right mono-number font-bold ${good ? "bz-plus" : "bz-minus"}`}>{d > 0 ? "▲" : "▼"}{num(Math.abs(d))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
