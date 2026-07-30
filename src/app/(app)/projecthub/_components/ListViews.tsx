"use client";
import Link from "next/link";
import { useMemo } from "react";
import { BarList } from "@/components/charts";
import { STAGE_LABEL, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";
import { todayKst } from "@/lib/kst";

// 프로젝트 목록의 추가 보기 3종 (2026-07-30 기획 v3 3단계).
//   타임라인 = 프로젝트 기간 막대 / 차트 = 회사 전체 분석 / 캘린더 = 마감·기간을 달에 배치.
//   ⚠️ 전부 목록 화면이 이미 불러온 데이터만 쓴다 — 추가 조회 0. 새 계산은 여기서만 하고
//      숫자의 근거(무엇을 어떻게 셌는지)를 화면에 함께 적는다.

const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const ymd = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

export type ListRow = {
  id: string;
  name: string | null;
  stage: string | null;
  start_date?: string | null;
  end_date?: string | null;
  contract_total?: number | null;
  partner_id?: string | null;
  internal_manager_id?: string | null;
};

// ── 타임라인 ────────────────────────────────────────────────
//   기간이 있는 프로젝트만 막대로. 오늘 선을 같이 그려 "지금 어디" 를 한눈에 본다.
//   축 범위는 실제 데이터의 최소~최대(월 단위 정렬)로 잡는다.
export function ProjectTimeline({ rows, headlineOf, outstandingOf, onOpen }: {
  rows: ListRow[];
  headlineOf: (id: string) => { label: string; name: string; pct: number; risk: boolean } | undefined;
  outstandingOf: (id: string) => number;
  onOpen: (id: string) => void;
}) {
  const today = todayKst();
  const scale = useMemo(() => {
    const dates: string[] = [];
    for (const r of rows) {
      const s = ymd(r.start_date), e = ymd(r.end_date);
      if (s) dates.push(s);
      if (e) dates.push(e);
    }
    if (dates.length === 0) return null;
    dates.push(today);
    dates.sort();
    // 월 경계로 넓혀 축을 깔끔하게
    const first = new Date(`${dates[0].slice(0, 7)}-01T00:00:00`);
    const lastD = new Date(`${dates[dates.length - 1]}T00:00:00`);
    const last = new Date(lastD.getFullYear(), lastD.getMonth() + 1, 0);
    const span = Math.max(1, (last.getTime() - first.getTime()) / 86_400_000);
    const months: { label: string; leftPct: number }[] = [];
    const cur = new Date(first);
    while (cur <= last) {
      months.push({
        label: `${cur.getMonth() + 1}월`,
        leftPct: ((cur.getTime() - first.getTime()) / 86_400_000 / span) * 100,
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    const pctOf = (d: string) => ((new Date(`${d}T00:00:00`).getTime() - first.getTime()) / 86_400_000 / span) * 100;
    return { first, last, span, months, pctOf };
  }, [rows, today]);

  const dated = rows.filter((r) => ymd(r.start_date) || ymd(r.end_date));
  const undated = rows.length - dated.length;

  if (!scale || dated.length === 0) {
    return <p className="ph-view-empty">기간(시작일·종료일)이 있는 프로젝트가 없어요. 프로젝트 수정에서 기간을 넣으면 여기에 막대로 표시돼요.</p>;
  }

  const todayPct = scale.pctOf(today);
  return (
    <div className="ph-timeline glass-card">
      <div className="ph-timeline-axis">
        {scale.months.map((m) => (
          <span key={m.label + m.leftPct} className="ph-timeline-tick" style={{ left: `${m.leftPct}%` }}>{m.label}</span>
        ))}
      </div>
      <div className="ph-timeline-rows">
        {dated.map((r) => {
          const s = ymd(r.start_date) || ymd(r.end_date)!;
          const e = ymd(r.end_date) || ymd(r.start_date)!;
          const left = Math.max(0, scale.pctOf(s));
          const right = Math.min(100, scale.pctOf(e));
          const width = Math.max(1.2, right - left);
          const h = headlineOf(r.id);
          const overdue = !!ymd(r.end_date) && ymd(r.end_date)! < today && r.stage !== "completed" && r.stage !== "settlement";
          const doneStage = r.stage === "completed" || r.stage === "settlement";
          const out = outstandingOf(r.id);
          return (
            <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="ph-timeline-row">
              <span className="ph-timeline-name">{r.name || "(이름 없음)"}</span>
              <span className="ph-timeline-track">
                <span className={`ph-timeline-bar ${overdue ? "ph-timeline-bar-late" : doneStage ? "ph-timeline-bar-done" : ""}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${s} ~ ${e}${h ? ` · ${h.name} ${h.label}` : ""}`} />
                <span className="ph-timeline-today" style={{ left: `${todayPct}%` }} />
              </span>
              <span className="ph-timeline-meta">
                {h && h.label !== "—" ? h.label : ""}
                {out > 1 && <b className="ph-timeline-out">미수</b>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ph-legend">
        <span><i className="ph-legend-dot ph-legend-run" />진행</span>
        <span><i className="ph-legend-dot ph-legend-done" />완료·정산</span>
        <span><i className="ph-legend-dot ph-legend-late" />기한 초과</span>
        <span><i className="ph-legend-dot ph-legend-today" />오늘</span>
        {undated > 0 && <span className="ph-legend-note">기간 미입력 {undated}건은 표시되지 않았어요</span>}
      </div>
    </div>
  );
}

// ── 차트(회사 전체 분석) ────────────────────────────────────
//   ① 단계별 파이프라인 금액 ② 프로젝트별 마진 순위(낮은 순) ③ 미수 에이징 ④ 담당자별 건수
export function PortfolioCharts({ rows, pnlOf, outstandingOf, agingBuckets, userName }: {
  rows: ListRow[];
  pnlOf: (id: string) => { revenue?: number; direct_cost?: number } | undefined;
  outstandingOf: (id: string) => number;
  agingBuckets: { label: string; amount: number; count: number }[];
  userName: (id: string | null | undefined) => string;
}) {
  // ① 단계별 파이프라인 — 계약금액 합. 어디서 막히는지 본다.
  const funnel = useMemo(() => {
    const m: Record<string, { amount: number; count: number }> = {};
    for (const r of rows) {
      const st = (STAGE_ORDER as string[]).includes(String(r.stage)) ? String(r.stage) : "estimate";
      (m[st] ||= { amount: 0, count: 0 });
      m[st].amount += Number(r.contract_total || 0);
      m[st].count += 1;
    }
    return STAGE_ORDER.map((st) => ({
      label: `${STAGE_LABEL[st as ProjectStage]} ${m[st]?.count || 0}건`,
      value: m[st]?.amount || 0,
    }));
  }, [rows]);

  // ② 마진 순위 — 매출>0 인 프로젝트만(0 매출은 마진 계산 불가). 낮은 순 = 위험한 것부터.
  const margins = useMemo(() => {
    const out: { label: string; value: number; pct: number }[] = [];
    for (const r of rows) {
      const p = pnlOf(r.id);
      const revenue = Number(r.contract_total || 0) || Number(p?.revenue || 0);
      if (revenue <= 0) continue;
      const cost = Number(p?.direct_cost || 0);
      const pct = Math.round(((revenue - cost) / revenue) * 100);
      out.push({ label: r.name || "(이름 없음)", value: Math.max(0, pct), pct });
    }
    return out.sort((a, b) => a.pct - b.pct).slice(0, 8);
  }, [rows, pnlOf]);

  // ④ 담당자별 진행 건수(완료·정산 제외)
  const byManager = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      if (r.stage === "completed" || r.stage === "settlement") continue;
      const k = userName(r.internal_manager_id) || "미지정";
      m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows, userName]);

  const agingTotal = agingBuckets.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="ph-charts">
      <div className="ph-chart glass-card">
        <div className="ph-chart-head"><b>단계별 파이프라인</b><span>계약금액 합계</span></div>
        <BarList items={funnel} unit="원" emptyText="프로젝트가 없어요" />
        <p className="ph-chart-note">어느 단계에 돈이 묶여 있는지 봐요. 견적에만 쌓여 있으면 계약 전환이 막힌 거예요.</p>
      </div>

      <div className="ph-chart glass-card">
        <div className="ph-chart-head"><b>마진 낮은 순</b><span>매출이 있는 프로젝트만</span></div>
        {margins.length === 0 ? (
          <p className="ph-view-empty">계약금액이나 매출이 잡힌 프로젝트가 없어요.</p>
        ) : (
          <div className="ph-rank">
            {margins.map((m) => (
              <div key={m.label} className="ph-rank-row">
                <span className="ph-rank-label" title={m.label}>{m.label}</span>
                <span className="ph-rank-bar"><i style={{ width: `${Math.min(100, Math.max(2, m.value))}%` }}
                  className={m.pct < 0 ? "ph-rank-bad" : m.pct < 20 ? "ph-rank-warn" : "ph-rank-ok"} /></span>
                <span className={`ph-rank-val ${m.pct < 0 ? "ph-rank-val-bad" : ""}`}>{m.pct}%</span>
              </div>
            ))}
          </div>
        )}
        <p className="ph-chart-note">마진 = (매출 − 태그된 원가) ÷ 매출. 적자가 맨 위로 올라와요.</p>
      </div>

      <div className="ph-chart glass-card">
        <div className="ph-chart-head"><b>미수 에이징</b><span>발행 후 경과일 · 합계 {won(agingTotal)}</span></div>
        {agingTotal <= 0 ? (
          <p className="ph-view-empty">미수가 없어요. 발행한 계산서가 전부 입금됐어요.</p>
        ) : (
          <div className="ph-aging">
            {agingBuckets.map((b) => {
              const h = agingTotal > 0 ? Math.round((b.amount / agingTotal) * 100) : 0;
              return (
                <div key={b.label} className="ph-aging-col">
                  <span className="ph-aging-amt">{b.amount > 0 ? won(b.amount) : "—"}</span>
                  <span className={`ph-aging-bar ph-aging-${b.label.replace(/[^0-9a-z]/gi, "")}`} style={{ height: `${Math.max(b.amount > 0 ? 6 : 2, h)}%` }} />
                  <span className="ph-aging-label">{b.label}<br /><em>{b.count}건</em></span>
                </div>
              );
            })}
          </div>
        )}
        <p className="ph-chart-note">계산서 발행액 − 실입금(통장 자동 매칭)으로 계산해요. 오래된 쪽부터 회수해요.</p>
      </div>

      <div className="ph-chart glass-card">
        <div className="ph-chart-head"><b>담당자별 진행 건수</b><span>완료·정산 제외</span></div>
        <BarList items={byManager} unit="건" emptyText="진행 중인 프로젝트가 없어요" />
        <p className="ph-chart-note">한 사람에게 몰려 있으면 재배정을 검토해요.</p>
      </div>
    </div>
  );
}

// ── 캘린더 ──────────────────────────────────────────────────
//   이번 달 기준. 표시 대상: 프로젝트 시작일·종료일(마감). 청구일·서명 기한은 후속 단계에서 추가.
export function ProjectCalendar({ rows, monthOffset, onMonth, onOpen }: {
  rows: ListRow[];
  monthOffset: number;
  onMonth: (delta: number) => void;
  onOpen: (id: string) => void;
}) {
  const today = todayKst();
  const base = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return new Date(y, (m - 1) + monthOffset, 1);
  }, [today, monthOffset]);

  const grid = useMemo(() => {
    const year = base.getFullYear(), month = base.getMonth();
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // 월요일 시작
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < lead; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(month + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push({ date: `${year}-${mm}-${dd}`, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    return cells;
  }, [base]);

  const events = useMemo(() => {
    const m: Record<string, { id: string; name: string; kind: "start" | "end"; late: boolean }[]> = {};
    for (const r of rows) {
      const s = ymd(r.start_date), e = ymd(r.end_date);
      const doneStage = r.stage === "completed" || r.stage === "settlement";
      if (s) (m[s] ||= []).push({ id: r.id, name: r.name || "(이름 없음)", kind: "start", late: false });
      if (e) (m[e] ||= []).push({ id: r.id, name: r.name || "(이름 없음)", kind: "end", late: e < today && !doneStage });
    }
    return m;
  }, [rows, today]);

  const title = `${base.getFullYear()}년 ${base.getMonth() + 1}월`;
  return (
    <div className="ph-cal glass-card">
      <div className="ph-cal-head">
        <button type="button" onClick={() => onMonth(-1)} className="ph-cal-nav" aria-label="이전 달">←</button>
        <b>{title}</b>
        <button type="button" onClick={() => onMonth(1)} className="ph-cal-nav" aria-label="다음 달">→</button>
        <span className="ph-cal-hint">프로젝트 시작일과 마감일이에요. 청구일·서명 기한은 다음 단계에서 추가돼요.</span>
      </div>
      <div className="ph-cal-grid">
        {["월", "화", "수", "목", "금", "토", "일"].map((d) => <span key={d} className="ph-cal-dow">{d}</span>)}
        {grid.map((c, i) => (
          <div key={i} className={`ph-cal-day ${!c.date ? "ph-cal-day-off" : ""} ${c.date === today ? "ph-cal-day-today" : ""}`}>
            {c.day && <b>{c.day}</b>}
            {c.date && (events[c.date] || []).slice(0, 3).map((ev, j) => (
              <button key={j} type="button" onClick={() => onOpen(ev.id)}
                className={`ph-cal-ev ${ev.kind === "end" ? (ev.late ? "ph-cal-ev-late" : "ph-cal-ev-end") : "ph-cal-ev-start"}`}
                title={`${ev.name} — ${ev.kind === "end" ? "마감" : "시작"}`}>
                {ev.kind === "end" ? "마감 " : "시작 "}{ev.name}
              </button>
            ))}
            {c.date && (events[c.date] || []).length > 3 && (
              <span className="ph-cal-more">+{(events[c.date] || []).length - 3}</span>
            )}
          </div>
        ))}
      </div>
      <div className="ph-legend">
        <span><i className="ph-legend-dot ph-legend-run" />시작</span>
        <span><i className="ph-legend-dot ph-legend-done" />마감</span>
        <span><i className="ph-legend-dot ph-legend-late" />기한 초과</span>
        <Link href="/schedule" className="ph-legend-note">회사 일정 전체 보기 →</Link>
      </div>
    </div>
  );
}
