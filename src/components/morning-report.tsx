"use client";

// 데일리 보고서 — 대시보드 첫 화면 (2026-09-03 대시보드 v3, docs/20260903_PLAN_dashboard_v3_report.md 결정 158~166)
//   History: 위젯 격자 13장이 벽처럼 서서 "정신사나움"(사장님) → 한 열 문서(아침 보고서) → 그래프를 붙였더니
//   "형식이 굳어 촌스럽다" → 사장님 참고 이미지(Lethe 판형) + "보고서스럽게, 두꺼우면 촌스럽다" → E안(결정 163·164 재개정):
//   얇은 선 한 장 안에 KPI 5칸 → 절마다 왼쪽 절 이름 열 + 오른쪽 본문. 문장이 먼저, 그림·표는 그 근거로만.
//   읽는 순서: 결론 → KPI → 01 챙길 것 → 02 자금(그림 1) → 03 매출·미수(그림 2 | 표) → 04 업무 → 05 사람 → 06 최근 처리 → 부록.
//   결정 159: 절 문장은 lib/report-lines.ts 규칙, 결론·챙길 것만 AI(MorningBrief 그대로).
//   결정 160: 절은 **개인별 메뉴 권한**이 켜고 끈다(역할 프리셋 없음) — perm 은 page 가 useMyPermissions 로 계산해 넘긴다.
//   결정 161: 부록 = 기존 DashboardGrid(크기 조절 없음·빈 위젯 접기). 펼침 상태는 기기에 기억(보기 상태).
//   결정 164: 그림은 둘(30일 잔액 전망·6개월 매출/비용)뿐. 선 1.5px, 막대 없음, 색은 primary 하나 + 상태색 글자.
//   결정 166: 사람·미수 칸은 데이터 크기에 따라 모양이 바뀐다(report-lines SCALE). 규칙 문장을 절 끝에 적는다.
//   이름은 "데일리 보고서"(2026-09-03 사장님: "아침 보고서보다 데일리 보고서 같은 명칭") — 파일명은 그대로 둔다.

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { fetchBizSummary } from "@/lib/biz-summary";
import { fetchOutlook, buildCurve, type Curve } from "@/lib/cash-outlook";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import { fetchTaxDeadlineChecks } from "@/lib/tax-deadline-checks";
import { fetchPaged } from "@/lib/fetch-paged";
import { REQUEST_TYPE_LABELS } from "@/lib/approval-workflow";
import {
  fundsLines, salesLines, peopleLines, wonK, type Line,
  peopleShape, peopleRule, recvShape, ageBucket, AGE_LABELS, SCALE,
} from "@/lib/report-lines";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReportPerm = { briefing: boolean; finance: boolean; ledger: boolean; tax: boolean; approvals: boolean; projects: boolean; inventory: boolean; people: boolean };

function Sentence({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <p key={i} className="rep-p">
          {l.map((s, j) => s.tone ? <b key={j} className={`rep-t rep-t-${s.tone} mono-number`}>{s.t}</b> : <span key={j}>{s.t}</span>)}
        </p>
      ))}
    </>
  );
}

//   절 = 왼쪽 이름 열(번호·제목·바로가기) + 오른쪽 본문. 번호는 보이는 절만 센다.
function Sec({ no, title, links, children }: { no: string; title: string; links?: { href: string; label: string }[]; children: ReactNode }) {
  return (
    <section className="rep-sec">
      <div className="rep-sec-h">
        <span className="rep-sec-no mono-number">{no}</span>
        <h2 className="rep-sec-title">{title}</h2>
        {links?.map((l) => <Link key={l.href} href={l.href} className="rep-sec-link">{l.label} →</Link>)}
      </div>
      <div className="rep-sec-b">{children}</div>
    </section>
  );
}

const fmtMd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 1,234,567 → 축 눈금용 짧은 단위 (천만·억) */
function axisWon(n: number): string {
  const a = Math.abs(n); const sign = n < 0 ? "−" : "";
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(a % 100_000_000 === 0 ? 0 : 1)}억`;
  if (a >= 10_000_000) return `${sign}${Math.round(a / 10_000_000)}천만`;
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000)}만`;
  return `${sign}${a}`;
}
/** 눈금 3개 — 범위를 예쁜 수로 */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min); const raw = span / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10;
  const lo = Math.floor(min / step) * step; const out: number[] = [];
  for (let v = lo; v <= max + step * 0.01 && out.length < 6; v += step) out.push(v);
  return out;
}

//   그림 1 — 30일 잔액 전망. 자금 전망 화면과 같은 curve(fetchOutlook + buildCurve). 선 1.5px, 큰 지출 날은 흰 점, 최저점은 빨간 점.
function ForecastFig({ curve }: { curve: Curve }) {
  const W = 760, H = 150, pl = 44, pr = 12, pt = 18, pb = 24;
  const pts = curve.points; const n = pts.length - 1;
  const vals = pts.map((p) => p.balance);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals);
  const tk = ticks(lo, hi); const mn = tk[0], mx = Math.max(tk[tk.length - 1], hi);
  const X = (i: number) => pl + (i * (W - pl - pr)) / n;
  const Y = (v: number) => pt + ((mx - v) / Math.max(1, mx - mn)) * (H - pt - pb);
  //   주석은 나가는 돈이 큰 날 상위 3개 — 같은 날 여러 건이면 종류를 묶는다
  const events = pts.filter((p) => p.items.some((it) => it.amount < 0)).map((p) => ({ p, out: p.items.filter((it) => it.amount < 0).reduce((s, it) => s + it.amount, 0), label: [...new Set(p.items.filter((it) => it.amount < 0).map((it) => it.kind))].slice(0, 2).join("·") }))
    .sort((a, b) => a.out - b.out).slice(0, 3).sort((a, b) => a.p.day - b.p.day)
    //   이웃한 날(3일 안)의 글자는 한 줄 아래로 — 겹치면 둘 다 못 읽는다
    .map((e, i, arr) => ({ ...e, dy: i > 0 && e.p.day - arr[i - 1].p.day < 3 ? 12 : 0 }));
  const path = "M" + pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.balance).toFixed(1)}`).join(" L");
  const minIsEvent = events.some((e) => e.p.day === curve.min.day);
  return (
    <svg className="rep-fig-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="30일 잔액 전망">
      {tk.map((v) => <g key={v}><line className="rep-fig-grid" x1={pl - 6} x2={W - pr} y1={Y(v)} y2={Y(v)} /><text className="rep-fig-ax" x={pl - 10} y={Y(v) + 3} textAnchor="end">{axisWon(v)}</text></g>)}
      {mn < 0 && <line className="rep-fig-zero" x1={pl - 6} x2={W - pr} y1={Y(0)} y2={Y(0)} />}
      <path className="rep-fig-ln" d={path} />
      {events.map((e) => (
        <g key={e.p.day}>
          <circle className="rep-fig-ev" cx={X(e.p.day)} cy={Y(e.p.balance)} r={3} />
          <text className="rep-fig-ev-t" x={X(e.p.day)} y={Y(e.p.balance) + 16 + e.dy} textAnchor="middle">{e.label}</text>
        </g>
      ))}
      {curve.min.day > 0 && (
        <g>
          <circle className={`rep-fig-low ${curve.min.balance < 0 ? "is-neg" : ""}`} cx={X(curve.min.day)} cy={Y(curve.min.balance)} r={3.5} />
          <text className="rep-fig-low-t" x={X(curve.min.day) + 9} y={Y(curve.min.balance) - (minIsEvent ? 8 : 8)} textAnchor={curve.min.day > n * 0.75 ? "end" : "start"}>최저 {wonK(curve.min.balance)} ({fmtMd(curve.min.date)})</text>
        </g>
      )}
      {pts.filter((p) => p.day % 5 === 0 || p.day === n).map((p) => <text key={p.day} className="rep-fig-ax" x={X(p.day)} y={H - 6} textAnchor="middle">{fmtMd(p.date)}</text>)}
    </svg>
  );
}

//   그림 2 — 6개월 매출(선)과 비용(회색 점선). 경영 요약과 같은 series.
function SalesFig({ series }: { series: { month: string; revenue: number; cost: number }[] }) {
  const W = 380, H = 120, pl = 14, pr = 64, pt = 16, pb = 22;
  const n = Math.max(1, series.length - 1);
  const all = series.flatMap((x) => [x.revenue, x.cost]); const mx = Math.max(1, ...all), mn = Math.min(0, ...all);
  const X = (i: number) => pl + (i * (W - pl - pr)) / n;
  const Y = (v: number) => pt + ((mx - v) / Math.max(1, mx - mn)) * (H - pt - pb);
  const path = (k: "revenue" | "cost") => "M" + series.map((x, i) => `${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join(" L");
  const last = series[series.length - 1];
  return (
    <svg className="rep-fig-svg rep-fig-sales" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 6개월 매출과 비용">
      <path className="rep-fig-ln-c" d={path("cost")} />
      <path className="rep-fig-ln" d={path("revenue")} />
      {series.map((x, i) => <text key={x.month} className="rep-fig-ax" x={X(i)} y={H - 6} textAnchor="middle">{Number(x.month.slice(5, 7))}월</text>)}
      {last && <>
        <circle className="rep-fig-ev" cx={X(n)} cy={Y(last.revenue)} r={3} />
        <text className="rep-fig-lbl" x={X(n) + 6} y={Y(last.revenue) + 4}>매출 {axisWon(last.revenue)}</text>
        <text className="rep-fig-lbl is-mut" x={X(n) + 6} y={Y(last.cost) + (Math.abs(Y(last.cost) - Y(last.revenue)) < 12 ? 14 : 4)}>비용 {axisWon(last.cost)}</text>
      </>}
    </svg>
  );
}

//   비율 띠 한 줄 — 미수 연령·근태 구성. 6px, 칸 사이 2px 흰 틈.
function Strip({ parts }: { parts: { label: string; value: number; cls: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <>
      <div className="rep-strip">{parts.filter((p) => p.value > 0).map((p) => <i key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />)}</div>
      <div className="rep-legend">{parts.map((p) => <span key={p.label}><i className={p.cls} />{p.label}</span>)}</div>
    </>
  );
}

const APPR_STATUS: Record<string, { label: string; tone: string }> = { pending: { label: "대기", tone: "bad" }, approved: { label: "승인", tone: "good" }, rejected: { label: "반려", tone: "warn" }, cancelled: { label: "취소", tone: "m" } };

export function MorningReport({
  companyId, userId, companyName, perm, forecast30, unclassified, approvalsPending, lead, checklist, appendix, appendixCount,
}: {
  companyId: string; userId: string | null; companyName: string; perm: ReportPerm;
  forecast30: number | null; unclassified: { bank: number; card: number }; approvalsPending: number | null;
  lead: ReactNode; checklist: ReactNode; appendix: ReactNode; appendixCount: number;
}) {
  const today = todayKst();
  const month = today.slice(0, 7);
  const isWeekend = [0, 6].includes(new Date(today + "T00:00:00").getDay());

  //   경영 요약과 같은 함수·같은 키 — KPI 띠·절 문장·그림 2 가 나눠 쓴다
  const { data: s } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId, month, userId || undefined),
    enabled: !!companyId && perm.finance, staleTime: 60_000,
  });

  // ── 그림 1: 30일 전망 — 자금 전망 화면과 같은 키(30일) ──
  const { data: outlook } = useQuery({
    queryKey: ["cash-outlook", companyId, 30], enabled: !!companyId && perm.finance, staleTime: 60_000,
    queryFn: () => fetchOutlook(companyId, 30, userId || undefined),
  });
  const curve = useMemo(() => (outlook && outlook.hasBank ? buildCurve(outlook, 30) : null), [outlook]);

  // ── 세금·납부 (납부 완료 제외) ──
  const { data: taxChecked = new Set<string>() } = useQuery({
    queryKey: ["tax-deadline-checks", companyId], enabled: !!companyId && perm.tax, staleTime: 60_000,
    queryFn: () => fetchTaxDeadlineChecks(companyId),
  });
  const taxItems = perm.tax ? getUpcomingTaxDeadlines(60).filter((t) => !taxChecked.has(t.id)).slice(0, 3) : [];

  // ── 오늘 통장 ──
  const { data: bankToday } = useQuery({
    queryKey: ["dash-bank-today", companyId, today], enabled: !!companyId && perm.finance, staleTime: 60_000,
    queryFn: async () => {
      const rows = logRead("morning-report:bank-today", await db.from("bank_transactions").select("type, amount, counterparty, description")
        .eq("company_id", companyId).gte("transaction_date", today).lt("transaction_date", `${today}T23:59:59.999`)) as any[] | null;
      let inn = 0, out = 0; const names: string[] = [];
      for (const t of rows || []) { const a = Number(t.amount || 0); const isIn = t.type === "in" || t.type === "deposit" || t.type === "income" || a > 0; if (isIn) inn += Math.abs(a); else out += Math.abs(a); if (names.length < 3) names.push(`${t.counterparty || t.description || "-"} ${isIn ? "+" : "−"}${wonK(Math.abs(a))}`); }
      return { inn, out, n: (rows || []).length, names };
    },
  });

  // ── 미수: 거래처별 + 연령 4단 (미수금 위젯과 같은 규칙: 매출 계산서 미정산) ──
  const { data: recv } = useQuery({
    queryKey: ["dash-receivables-aged", companyId], enabled: !!companyId && perm.ledger, staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 400);
      const rows = await fetchPaged<any>("morning-report:recv", () => db.from("tax_invoices")
        .select("counterparty_name, total_amount, supply_amount, settled_amount, issue_date, status")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void").gte("issue_date", since.toISOString().slice(0, 10)).order("id"), 50000);
      const todayMs = new Date(today + "T00:00:00").getTime();
      const by: Record<string, { name: string; outstanding: number; oldestDays: number; count: number }> = {};
      const age = [0, 0, 0, 0]; let over90 = 0; const over90Names = new Set<string>();
      for (const r of (rows || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0); if (bal <= 1) continue;
        const name = r.counterparty_name || "미상";
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const g = by[name] || (by[name] = { name, outstanding: 0, oldestDays: 0, count: 0 });
        g.outstanding += bal; g.count += 1; g.oldestDays = Math.max(g.oldestDays, days);
        age[ageBucket(days)] += bal; if (days > 90) { over90 += bal; over90Names.add(name); }
      }
      const list = Object.values(by).sort((a, b) => b.oldestDays - a.oldestDays || b.outstanding - a.outstanding);
      return { list, total: list.reduce((x, g) => x + g.outstanding, 0), age, over90, over90Partners: over90Names.size };
    },
  });

  // ── 업무: 프로젝트(활성·기한 지난 줄·이번 주 마감·변동 없음) · 재고 부족 ──
  const { data: proj } = useQuery({
    queryKey: ["report-projects", companyId, today], enabled: !!companyId && perm.projects, staleTime: 60_000,
    queryFn: async () => {
      const [deals, items] = await Promise.all([
        db.from("deals").select("id, name, last_activity_at, created_at").eq("company_id", companyId).is("archived_at", null).is("parent_deal_id", null),
        db.from("project_items").select("deal_id, status, due_date").eq("company_id", companyId).is("archived_at", null).not("due_date", "is", null),
      ]);
      const ds = (deals.data || []) as any[]; const its = (items.data || []) as any[];
      const week = new Date(today + "T00:00:00"); week.setDate(week.getDate() + 7); const weekStr = week.toISOString().slice(0, 10);
      const stale = new Date(today + "T00:00:00"); stale.setDate(stale.getDate() - 14); const staleMs = stale.getTime();
      let overdue = 0, dueSoon = 0; const overdueDeals = new Map<string, number>();
      for (const it of its) { if (it.status === "done") continue; const dd = String(it.due_date).slice(0, 10); if (dd < today) { overdue++; overdueDeals.set(it.deal_id, (overdueDeals.get(it.deal_id) || 0) + 1); } else if (dd <= weekStr) dueSoon++; }
      const nameOf = new Map(ds.map((d) => [d.id, d.name as string]));
      const overdueTop = [...overdueDeals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, k]) => ({ id, name: nameOf.get(id) || "프로젝트", k }));
      const staleN = ds.filter((d) => new Date(d.last_activity_at || d.created_at || today).getTime() < staleMs).length;
      return { active: ds.length, overdue, dueSoon, stale: staleN, overdueTop, overdueDeals: overdueDeals.size };
    },
  });
  const { data: inv } = useQuery({
    queryKey: ["dash-inventory-short", companyId], enabled: !!companyId && perm.inventory, staleTime: 60_000,
    queryFn: async () => {
      const [prods, onhand] = await Promise.all([
        db.from("products").select("id, sku, name, spec, safety_stock").eq("company_id", companyId).eq("is_active", true).eq("track_stock", true).not("safety_stock", "is", null),
        db.from("v_stock_onhand").select("product_id, qty").eq("company_id", companyId),
      ]);
      const qty = new Map<string, number>();
      for (const r of ((onhand.data as any[]) || [])) qty.set(r.product_id, (qty.get(r.product_id) || 0) + Number(r.qty || 0));
      const list = ((prods.data as any[]) || []).map((p) => ({ id: p.id, name: p.name, spec: p.spec, safety: Number(p.safety_stock), qty: qty.get(p.id) || 0 }))
        .filter((p) => p.qty <= p.safety).sort((a, b) => (a.qty - a.safety) - (b.qty - b.safety));
      return { list: list.slice(0, 5), count: list.length, tracked: ((prods.data as any[]) || []).length };
    },
  });

  // ── 사람: 재직 · 오늘 근태 — 사람별 상태(점)와 부서별 집계(표)를 한 번에 ──
  const { data: people } = useQuery({
    queryKey: ["report-people-v2", companyId, today], enabled: !!companyId && perm.people, staleTime: 60_000,
    queryFn: async () => {
      const [emp, att, leave] = await Promise.all([
        db.from("employees").select("id, name, department").eq("company_id", companyId).in("status", ["active", "joined"]),
        db.from("attendance_records").select("employee_id, check_in, check_out, is_late").eq("company_id", companyId).eq("date", today),
        db.from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", today).gte("end_date", today),
      ]);
      const emps = (emp.data || []) as { id: string; name: string; department: string | null }[];
      const byEmp = new Map<string, any>(); for (const r of (att.data || []) as any[]) byEmp.set(r.employee_id, r);
      const onLeaveIds = new Set(((leave.data || []) as any[]).map((l) => l.employee_id));
      type St = "working" | "done" | "leave" | "missing";
      const each = emps.map((e) => { const r = byEmp.get(e.id); const st: St = onLeaveIds.has(e.id) && !r?.check_in ? "leave" : !r?.check_in ? "missing" : r.check_out ? "done" : "working"; return { ...e, st, late: !!r?.is_late }; });
      const cnt = (st: St) => each.filter((x) => x.st === st).length;
      const depts: Record<string, { name: string; n: number; working: number; leave: number; missing: number }> = {};
      for (const x of each) { const k = x.department || "부서 없음"; const d = depts[k] || (depts[k] = { name: k, n: 0, working: 0, leave: 0, missing: 0 }); d.n++; if (x.st === "working" || x.st === "done") d.working++; if (x.st === "leave") d.leave++; if (x.st === "missing") d.missing++; }
      return {
        active: emps.length, working: cnt("working"), done: cnt("done"), late: each.filter((x) => x.late).length, missing: cnt("missing"), onLeave: cnt("leave"), overtimeOver: 0,
        each, depts: Object.values(depts).sort((a, b) => b.n - a.n),
        leaveNames: each.filter((x) => x.st === "leave").map((x) => x.name), missingNames: each.filter((x) => x.st === "missing").map((x) => x.name),
      };
    },
  });

  // ── 최근 처리: 결재(상태 무관 최신) + 매출 계산서 ──
  const { data: recent } = useQuery({
    queryKey: ["report-recent", companyId, today], enabled: !!companyId && (perm.approvals || perm.tax), staleTime: 60_000,
    queryFn: async () => {
      const [ap, ti] = await Promise.all([
        perm.approvals ? db.from("approval_requests").select("id, title, request_type, amount, status, updated_at, created_at").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
        perm.tax ? db.from("tax_invoices").select("id, counterparty_name, total_amount, type, issue_date, status, created_at").eq("company_id", companyId).neq("status", "void").order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
      ]);
      const rows = [
        ...((ap.data || []) as any[]).map((r) => ({ id: `a:${r.id}`, title: r.title || "결재 요청", kind: REQUEST_TYPE_LABELS[r.request_type as keyof typeof REQUEST_TYPE_LABELS] || "결재", at: r.updated_at || r.created_at, amount: Number(r.amount || 0), status: APPR_STATUS[r.status || ""] || { label: r.status || "-", tone: "m" }, href: "/approvals" })),
        ...((ti.data || []) as any[]).map((r) => ({ id: `t:${r.id}`, title: `${r.counterparty_name || "미상"} ${r.type === "sales" ? "매출" : "매입"} 계산서`, kind: "계산서", at: r.created_at || r.issue_date, amount: Number(r.total_amount || 0), status: r.status === "draft" ? { label: "발행 전", tone: "warn" } : { label: "발행", tone: "good" }, href: "/tax-invoices" })),
      ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 6);
      return rows;
    },
  });

  // ── 부록 펼침 (보기 상태 — 기기에 기억) ──
  const [apx, setApx] = useState(false);
  useEffect(() => { try { setApx(localStorage.getItem("dash-apx-open") === "1"); } catch { /* noop */ } }, []);
  const toggleApx = () => { const v = !apx; setApx(v); try { localStorage.setItem("dash-apx-open", v ? "1" : "0"); } catch { /* noop */ } };

  //   절 번호는 보이는 절만 센다 — 권한이 절을 지우면 번호가 이어진다
  let n = 0; const no = () => String(++n).padStart(2, "0");
  const showSales = perm.finance || perm.ledger;
  const showWork = perm.approvals || perm.projects || perm.inventory;
  const showRecent = perm.approvals || perm.tax;
  const dateLabel = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  const fmtAt = (at: string | null) => { if (!at) return "-"; const d = String(at); if (d.slice(0, 10) === today) return d.slice(11, 16) || "오늘"; const y = new Date(today + "T00:00:00"); y.setDate(y.getDate() - 1); return d.slice(0, 10) === y.toISOString().slice(0, 10) ? "어제" : fmtMd(d); };
  const revShape = recv ? recvShape(recv.list.length) : "all";
  const pplShape = people ? peopleShape(people.active) : "dots";
  const pnlPrev = s?.pnl.prev; const revRatio = s && pnlPrev && pnlPrev.revenue > 0 ? (s.pnl.cur.revenue - pnlPrev.revenue) / pnlPrev.revenue : null;

  return (
    <article className="rep">
      <header className="rep-top">
        <h1 className="rep-title">데일리 보고서</h1>
        <span className="flex-1" />
        <span className="rep-co">{dateLabel} · {companyName}{s?.cash.hasBank ? " · 통장 수집" : ""}</span>
        <button type="button" className="rep-tool" onClick={() => window.print()}>인쇄</button>
      </header>
      {perm.briefing && lead}

      <div className="rep-sheet">
        {perm.finance && s && (
          <div className="rep-kpis">
            <Link href="/bank" className="rep-kpi is-first"><span className="rep-kpi-l">오늘 잔액</span><span className="rep-kpi-v mono-number">{s.cash.hasBank ? wonK(s.cash.balance) : "통장 없음"}</span><span className="rep-kpi-s mono-number">{bankToday && bankToday.n > 0 ? `오늘 +${wonK(bankToday.inn)} −${wonK(bankToday.out)}` : "오늘 거래 없음"}</span></Link>
            <Link href="/reports/profit" className="rep-kpi"><span className="rep-kpi-l">이달 매출</span><span className="rep-kpi-v mono-number">{wonK(s.pnl.cur.revenue)}</span><span className="rep-kpi-s mono-number">{revRatio == null ? "지난달 자료 없음" : `지난달 대비 ${revRatio >= 0 ? "+" : "−"}${Math.round(Math.abs(revRatio) * 100)}%`}</span></Link>
            <Link href="/reports/profit" className="rep-kpi"><span className="rep-kpi-l">이달 손익</span><span className={`rep-kpi-v mono-number ${s.pnl.cur.operating < 0 ? "rep-t-bad" : ""}`}>{wonK(s.pnl.cur.operating)}</span><span className="rep-kpi-s mono-number">비용 {wonK(s.pnl.cur.cogs + s.pnl.cur.opex)} · 확정 전표만</span></Link>
            <Link href="/partners/ledger?type=sales" className="rep-kpi"><span className="rep-kpi-l">미수</span><span className="rep-kpi-v mono-number">{wonK(s.arap.ar)}</span><span className="rep-kpi-s mono-number">{recv ? `${recv.list.length}곳 · 90일 넘긴 곳 ${recv.over90Partners}` : s.arap.over30Partners > 0 ? `30일 넘긴 곳 ${s.arap.over30Partners}` : "30일 넘긴 곳 없음"}</span></Link>
            <Link href="/reports/outlook" className="rep-kpi"><span className="rep-kpi-l">30일 안에 낼 돈</span><span className="rep-kpi-v mono-number">{wonK(s.arap.due30)}</span><span className="rep-kpi-s mono-number">급여 {wonK(s.arap.salary)} · 정기 {wonK(s.arap.recurring)}{s.arap.vatNext && s.arap.vatNext.dday <= 30 && s.arap.vatNext.pay ? ` · 부가세 ${fmtMd(s.arap.vatNext.due)}` : ""}</span></Link>
          </div>
        )}

        {perm.briefing && (
          <Sec no={no()} title="오늘 챙길 것">{checklist}</Sec>
        )}

        {perm.finance && (
          <Sec no={no()} title="자금" links={[{ href: "/reports/outlook", label: "자금 전망" }, { href: "/bank", label: "통장" }]}>
            <Sentence lines={fundsLines(s, forecast30, unclassified)} />
            {curve && (
              <>
                <div className="rep-fig"><ForecastFig curve={curve} /></div>
                <p className="rep-cap">그림 1 · 30일 잔액 전망 — 통장 잔액에 급여·정기 지출·대출·세금·계약 회차를 날짜대로 더한 것. 점은 큰 지출이 있는 날, 빨간 점은 가장 낮은 날.{unclassified.bank + unclassified.card > 0 ? ` 미분류 ${unclassified.bank + unclassified.card}건 제외.` : ""}</p>
              </>
            )}
            {taxItems.length > 0 && (
              <p className="rep-inline"><span className="rep-inline-k">세금·납부</span>{taxItems.map((t) => <Link key={t.id} href={t.href} className="rep-link mono-number">{t.title} {fmtMd(t.date)} <b className={t.daysLeft <= 7 ? "rep-t-bad" : "m"}>{t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</b></Link>)}</p>
            )}
          </Sec>
        )}

        {showSales && (
          <Sec no={no()} title="매출·미수" links={[{ href: "/reports/profit", label: "손익" }, { href: "/partners/ledger?type=sales", label: "거래처 원장" }]}>
            <div className={`rep-cols ${perm.ledger && recv && recv.list.length > 0 ? "" : "is-one"}`}>
              <div>
                {perm.finance && <Sentence lines={salesLines(s)} />}
                {perm.finance && s && s.pnl.series.some((x) => x.revenue > 0 || x.cost > 0) && (
                  <>
                    <div className="rep-fig rep-fig-sm"><SalesFig series={s.pnl.series} /></div>
                    <p className="rep-cap">그림 2 · 최근 6개월 매출과 비용 — 확정 전표 기준. 점선은 비용.</p>
                  </>
                )}
                {perm.ledger && recv && recv.list.length > 0 && (
                  <>
                    {revShape !== "all" && (
                      <>
                        <p className="rep-p rep-p-top">미수 {wonK(recv.total)} 중 90일을 넘긴 곳이 <b className={`rep-t ${recv.over90 > recv.total * 0.3 ? "rep-t-bad" : "rep-t-warn"} mono-number`}>{recv.over90Partners}곳 {wonK(recv.over90)}</b>입니다.</p>
                        <Strip parts={recv.age.map((v, i) => ({ label: `${AGE_LABELS[i]} ${wonK(v)}`, value: v, cls: `rep-age-${i}` }))} />
                      </>
                    )}
                  </>
                )}
                {perm.ledger && recv && recv.list.length === 0 && <p className="rep-none">미수금 없음 — 발행한 세금계산서가 모두 회수됐습니다.</p>}
              </div>
              {perm.ledger && recv && recv.list.length > 0 && (
                <div>
                  <div className="rep-k">{revShape === "stripFirst" ? "90일 넘긴 미수 상위 5" : "미수 상위 5 · 오래된 순"}</div>
                  <table className="rep-tbl">
                    <thead><tr><th>거래처</th><th className="r">금액</th><th className="r">지연</th></tr></thead>
                    <tbody>{(revShape === "stripFirst" ? recv.list.filter((g) => g.oldestDays > 90) : recv.list).slice(0, 5).map((g) => (
                      <tr key={g.name}><td><Link href="/partners/ledger?type=sales" className="rep-link">{g.name}</Link>{g.count > 1 && <span className="m"> · {g.count}건</span>}</td>
                        <td className="r mono-number">{wonK(g.outstanding)}</td><td className={`r mono-number ${g.oldestDays > 90 ? "rep-t-bad" : g.oldestDays > 30 ? "rep-t-warn" : "m"}`}>{g.oldestDays}일</td></tr>
                    ))}</tbody>
                  </table>
                  <p className="rep-foot-note">
                    {revShape === "all" ? `${recv.list.length}곳 전부를 봅니다. 90일 넘긴 ${recv.over90Partners}곳은 표에 다 있습니다.`
                      : `${recv.list.length.toLocaleString("ko")}곳 중 상위 5곳이 미수의 ${Math.round(recv.list.slice(0, 5).reduce((x, g) => x + g.outstanding, 0) / Math.max(1, recv.total) * 100)}%입니다. `}
                    {recv.list.length > 5 && <Link href="/partners/ledger?type=sales" className="rep-link is-primary">나머지 {(recv.list.length - 5).toLocaleString("ko")}곳 →</Link>}
                  </p>
                </div>
              )}
            </div>
            <p className="rep-rule"><b>포함</b> 확정 계산서만 · 초안 제외 · 최근 400일 발행분.{revShape !== "all" && ` ${SCALE.recvAll + 1}곳부터는 연령 띠를 같이 보입니다.`}</p>
          </Sec>
        )}

        {showWork && (
          <Sec no={no()} title="업무" links={[...(perm.approvals ? [{ href: "/approvals", label: "결재" }] : []), ...(perm.projects ? [{ href: "/projecthub", label: "프로젝트" }] : []), ...(perm.inventory ? [{ href: "/inventory/stock", label: "재고" }] : [])]}>
            <div className="rep-cells">
              {perm.approvals && (
                <div className="rep-cell">
                  <div className="rep-k">결재</div>
                  <div className="rep-big mono-number">{approvalsPending ?? "–"}<span className="rep-k"> 건 대기</span></div>
                  <p className="rep-p">{(approvalsPending ?? 0) > 0 ? <>내 차례인 결재가 있습니다. <Link href="/approvals" className="rep-link is-primary">결재 허브</Link>에서 처리합니다.</> : "내 차례인 결재가 없습니다."}</p>
                </div>
              )}
              {perm.projects && (
                <div className="rep-cell">
                  <div className="rep-k">프로젝트</div>
                  <div className="rep-big mono-number">{proj ? proj.overdue : "–"}<span className="rep-k"> 건 마감 지남</span></div>
                  <p className="rep-p">
                    {!proj ? "읽는 중…" : proj.overdue === 0 ? `진행 ${proj.active}개 중 마감을 넘긴 일이 없습니다.` : <>{proj.overdueTop.map((d, i) => <span key={d.id}>{i > 0 && " · "}<Link href={`/projecthub/${d.id}`} className="rep-link is-primary">{d.name}</Link>({d.k})</span>)}{proj.overdueDeals > 3 && ` 외 ${proj.overdueDeals - 3}개`}. </>}
                    {proj && proj.dueSoon > 0 && ` 이번 주 마감 ${proj.dueSoon}건.`}
                    {proj && (proj.stale > 0 ? ` 2주 넘게 변동 없는 프로젝트 ${proj.stale}개.` : proj.active > 0 ? " 2주 넘게 변동 없는 프로젝트는 없습니다." : "")}
                  </p>
                </div>
              )}
              {perm.inventory && (
                <div className="rep-cell">
                  <div className="rep-k">재고</div>
                  <div className="rep-big mono-number">{inv ? inv.count : "–"}<span className="rep-k"> 품목 안전재고 아래</span></div>
                  <p className="rep-p">
                    {!inv ? "읽는 중…" : inv.count === 0 ? (inv.tracked > 0 ? "안전재고를 정한 품목이 모두 기준 위입니다." : "안전재고를 정한 품목이 없습니다.") : <>{inv.list.slice(0, 3).map((p, i) => <span key={p.id}>{i > 0 && " · "}<Link href="/inventory/stock" className="rep-link is-primary">{p.name}</Link> <b className={`mono-number ${p.qty <= 0 ? "rep-t-bad" : "rep-t-warn"}`}>{p.qty}/{p.safety}</b></span>)}{inv.count > 3 && ` 외 ${inv.count - 3}개`}.</>}
                  </p>
                </div>
              )}
            </div>
            <p className="rep-rule"><b>포함</b>{perm.projects && proj && ` 활성 프로젝트 ${proj.active}개(보관 제외)`}{perm.inventory && inv && ` · 재고는 안전재고를 정한 품목 ${inv.tracked}개만`}{perm.approvals && " · 결재는 내 차례인 것만"}.</p>
          </Sec>
        )}

        {perm.people && (
          <Sec no={no()} title="사람" links={[{ href: "/attendance", label: "근태" }]}>
            {!people ? <p className="rep-none">근태 자료를 읽는 중…</p> : people.active === 0 ? <p className="rep-none">등록된 구성원이 없습니다.</p> : isWeekend ? <Sentence lines={peopleLines(people, true)} /> : (
              <>
                <div className="rep-big mono-number">{people.active}명 중 {people.working}명 근무중</div>
                {pplShape === "dots" && (
                  <>
                    <div className="rep-dots">{people.each.map((x) => <i key={x.id} className={`is-${x.st}`} title={`${x.name} · ${x.st === "working" ? "근무중" : x.st === "done" ? "퇴근" : x.st === "leave" ? "휴가" : "기록 없음"}`} />)}</div>
                    <div className="rep-legend"><span><i className="is-working" />{people.working} 근무중</span><span><i className="is-done" />{people.done} 퇴근</span><span><i className="is-leave" />{people.onLeave} 휴가{people.leaveNames.length > 0 && ` · ${people.leaveNames.join(", ")}`}</span><span><i className="is-missing" />{people.missing} 기록 없음</span></div>
                  </>
                )}
                {pplShape !== "dots" && (
                  <>
                    <Strip parts={[{ label: `${people.working} 근무중`, value: people.working, cls: "is-working" }, { label: `${people.done} 퇴근`, value: people.done, cls: "is-done" }, { label: `${people.onLeave} 휴가`, value: people.onLeave, cls: "is-leave" }, { label: `${people.missing} 기록 없음`, value: people.missing, cls: "is-missing" }]} />
                    <table className="rep-tbl">
                      <thead><tr><th>부서</th><th className="r">인원</th><th className="r">근무</th><th className="r">휴가</th><th className="r">기록 없음</th></tr></thead>
                      <tbody>
                        {people.depts.slice(0, 4).map((d) => <tr key={d.name}><td>{d.name}</td><td className="r mono-number">{d.n}</td><td className="r mono-number">{d.working}</td><td className="r mono-number">{d.leave}</td><td className={`r mono-number ${d.missing > 0 ? "rep-t-bad" : ""}`}>{d.missing}</td></tr>)}
                        {people.depts.length > 4 && (() => { const rest = people.depts.slice(4); return <tr><td className="m">외 {rest.length}부서</td><td className="r mono-number">{rest.reduce((x, d) => x + d.n, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.working, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.leave, 0)}</td><td className="r mono-number">{rest.reduce((x, d) => x + d.missing, 0)}</td></tr>; })()}
                      </tbody>
                    </table>
                  </>
                )}
                <p className="rep-p rep-p-top">
                  {people.missing > 0 ? <>기록 없는 {people.missing}명{pplShape === "strip" && people.missingNames.length <= 5 ? `(${people.missingNames.join(", ")})` : ""}은 <Link href="/attendance" className="rep-link is-primary">근태</Link>에서 바로 확인할 수 있습니다. </> : "오늘 기록이 빠진 사람은 없습니다. "}
                  {people.late > 0 && <b className="rep-t rep-t-warn mono-number">지각 {people.late}명. </b>}
                </p>
                <p className="rep-rule"><b>규칙</b> {peopleRule(pplShape)} 재직 {people.active}명 기준 · 퇴사자 제외.</p>
              </>
            )}
          </Sec>
        )}

        {showRecent && (
          <Sec no={no()} title="최근 처리" links={[...(perm.approvals ? [{ href: "/approvals", label: "결재 허브" }] : []), ...(perm.tax ? [{ href: "/tax-invoices", label: "계산서" }] : [])]}>
            {!recent ? <p className="rep-none">읽는 중…</p> : recent.length === 0 ? <p className="rep-none">최근 처리한 결재·계산서가 없습니다.</p> : (
              <table className="rep-tbl rep-tbl-recent">
                <thead><tr><th>항목</th><th>종류</th><th>일시</th><th className="r">금액</th><th>상태</th></tr></thead>
                <tbody>{recent.map((r) => (
                  <tr key={r.id}><td><Link href={r.href} className="rep-link">{r.title}</Link></td><td className="m">{r.kind}</td><td className="m mono-number">{fmtAt(r.at)}</td><td className="r mono-number">{r.amount > 0 ? wonK(r.amount) : "-"}</td><td className={r.status.tone === "m" ? "m" : `rep-t-${r.status.tone}`}>{r.status.label}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Sec>
        )}
      </div>

      <section className={`rep-apx ${apx ? "is-open" : ""}`}>
        <div className="rep-apx-h">
          <b>부록 — 위젯 격자</b><span className="rep-apx-hint mono-number">쓸 수 있는 위젯 {appendixCount}개</span>
          <span className="rep-apx-hint">보고서로 부족하면 여기서 펼쳐 보고, 순서를 바꾸거나 켜고 끕니다</span>
          <span className="flex-1" />
          <button type="button" className="rep-apx-btn" onClick={toggleApx}>{apx ? "접기 ▴" : "펼치기 ▾"}</button>
        </div>
        {apx && <div className="rep-apx-body">{appendix}</div>}
      </section>
      <footer className="rep-foot">
        <span>이 보고서가 읽은 것: 확정 전표{s?.cash.hasBank ? " · 통장·카드 수집" : ""}{perm.projects && proj ? ` · 활성 프로젝트 ${proj.active}` : ""}{perm.people && people ? ` · 재직 ${people.active}명 · 승인된 휴가` : ""}.</span>
        <span>절 문장은 규칙, 결론과 챙길 것만 AI 제안 · 보이는 절은 내 권한에 따라 다릅니다.</span>
      </footer>
    </article>
  );
}
