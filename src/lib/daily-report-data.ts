// 데일리 보고서 자료 훅 (2026-09-03) — E안(morning-report.tsx)과 G안(daily-report.tsx)이 같은 숫자를 읽는다.
//   History: 질의가 morning-report.tsx 안에 있었는데 G안(카드형, feature_rollout 'dashboard_g' 모티브 먼저)을
//   나란히 두게 되어 여기로 뺐다. 화면은 모양만 다르고 숫자는 하나여야 한다 — 두 파일이 각자 질의하면 갈라진다.
//   전부 useQuery — 권한(perm)이 꺼진 절은 질의도 안 한다.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { fetchBizSummary } from "@/lib/biz-summary";
import { fetchOutlook, buildCurve } from "@/lib/cash-outlook";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import { fetchTaxDeadlineChecks } from "@/lib/tax-deadline-checks";
import { fetchPaged } from "@/lib/fetch-paged";
import { REQUEST_TYPE_LABELS } from "@/lib/approval-workflow";
import { ageBucket, wonK } from "@/lib/report-lines";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReportPerm = { briefing: boolean; finance: boolean; ledger: boolean; tax: boolean; approvals: boolean; projects: boolean; inventory: boolean; people: boolean };

export type PeopleState = "working" | "done" | "leave" | "missing";
export type RecentRow = { id: string; title: string; kind: string; at: string | null; amount: number; status: { label: string; tone: string }; href: string; who?: string | null };
export type ReportOpts = { horizon?: 30 | 60 | 90; day?: string | null; snapshot?: boolean };
const SNAP_MIN_GAP_MS = 30 * 60 * 1000;
/** 'YYYY-MM-DD' 에 n일 더하기 — 로컬 Date + toISOString 은 KST 자정이 전날 15:00Z 가 되어 하루 밀린다(2026-09-04 실측). UTC 산술로만. */
export const shiftDay = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

const APPR_STATUS: Record<string, { label: string; tone: string }> = { pending: { label: "대기", tone: "bad" }, approved: { label: "승인", tone: "good" }, rejected: { label: "반려", tone: "warn" }, cancelled: { label: "취소", tone: "m" } };

export function useDailyReportData(companyId: string, userId: string | null, perm: ReportPerm, opts?: ReportOpts) {
  const today = todayKst();
  const month = today.slice(0, 7);
  //   G안 옵션(2026-09-04 결정 168): horizon = 자금 전망 일수, day = 보는 날(오늘이 아니면 스냅샷만 읽고 질의는 안 한다),
  //   snapshot = 오늘 숫자를 daily_report_snapshots 에 남길지(게이트 켜진 회사만 true).
  const horizon = opts?.horizon ?? 30;
  const day = opts?.day || today;
  const past = day !== today;
  const snapOn = !!opts?.snapshot;
  const live = !past;

  //   경영 요약과 같은 함수·같은 키 — KPI·절 문장·6개월 그림이 나눠 쓴다
  const { data: s } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId, month, userId || undefined),
    enabled: !!companyId && perm.finance && live, staleTime: 60_000,
  });

  // ── 30일 전망 — 자금 전망 화면과 같은 키(30일) ──
  const { data: outlook } = useQuery({
    queryKey: ["cash-outlook", companyId, horizon], enabled: !!companyId && perm.finance && live, staleTime: 60_000,
    queryFn: () => fetchOutlook(companyId, horizon, userId || undefined),
  });
  const curve = useMemo(() => (outlook && outlook.hasBank ? buildCurve(outlook, horizon) : null), [outlook, horizon]);

  // ── 세금·납부 (납부 완료 제외) ──
  const { data: taxChecked = new Set<string>() } = useQuery({
    queryKey: ["tax-deadline-checks", companyId], enabled: !!companyId && perm.tax && live, staleTime: 60_000,
    queryFn: () => fetchTaxDeadlineChecks(companyId),
  });
  const taxItems = perm.tax ? getUpcomingTaxDeadlines(60).filter((t) => !taxChecked.has(t.id)).slice(0, 3) : [];

  // ── 오늘 통장 + 지난 30일 잔액 추세(G안 KPI 스파크라인) ──
  //   잔액 이력 표가 없어 오늘 잔액에서 일별 순증감을 거꾸로 빼 만든다(통장 요약과 같은 type 판정).
  const { data: bankToday } = useQuery({
    queryKey: ["dash-bank-today-v2", companyId, today], enabled: !!companyId && perm.finance && live, staleTime: 60_000,
    queryFn: async () => {
      const sinceStr = shiftDay(today, -30);
      const rows = logRead("daily-report:bank-30d", await db.from("bank_transactions").select("type, amount, counterparty, description, transaction_date")
        .eq("company_id", companyId).gte("transaction_date", sinceStr).lt("transaction_date", `${today}T23:59:59.999`)) as any[] | null;
      let inn = 0, out = 0, n = 0; const names: string[] = []; const netByDay = new Map<string, number>();
      for (const t of rows || []) {
        const a = Math.abs(Number(t.amount || 0)); const isIn = t.type === "income" || t.type === "in" || t.type === "deposit";
        const d = String(t.transaction_date).slice(0, 10);
        netByDay.set(d, (netByDay.get(d) || 0) + (isIn ? a : -a));
        if (d === today) { n++; if (isIn) inn += a; else out += a; if (names.length < 3) names.push(`${t.counterparty || t.description || "-"} ${isIn ? "+" : "−"}${wonK(a)}`); }
      }
      return { inn, out, n, names, netByDay };
    },
  });

  // ── 미수: 거래처별 + 연령 4단 (미수금 위젯과 같은 규칙: 매출 계산서 미정산) ──
  const { data: recv } = useQuery({
    queryKey: ["dash-receivables-aged", companyId], enabled: !!companyId && perm.ledger && live, staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 400);
      const rows = await fetchPaged<any>("daily-report:recv", () => db.from("tax_invoices")
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
      const byAmount = [...list].sort((a, b) => b.outstanding - a.outstanding);
      return { list, byAmount, total: list.reduce((x, g) => x + g.outstanding, 0), age, over90, over90Partners: over90Names.size };
    },
  });

  // ── 업무: 프로젝트(활성·기한 지난 줄·이번 주 마감·변동 없음) · 재고 부족 ──
  const { data: proj } = useQuery({
    queryKey: ["report-projects", companyId, today], enabled: !!companyId && perm.projects && live, staleTime: 60_000,
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
    queryKey: ["dash-inventory-short", companyId], enabled: !!companyId && perm.inventory && live, staleTime: 60_000,
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
    queryKey: ["report-people-v2", companyId, today], enabled: !!companyId && perm.people && live, staleTime: 60_000,
    queryFn: async () => {
      const [emp, att, leave] = await Promise.all([
        db.from("employees").select("id, name, department").eq("company_id", companyId).in("status", ["active", "joined"]),
        db.from("attendance_records").select("employee_id, check_in, check_out, is_late").eq("company_id", companyId).eq("date", today),
        db.from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", today).gte("end_date", today),
      ]);
      const emps = (emp.data || []) as { id: string; name: string; department: string | null }[];
      const byEmp = new Map<string, any>(); for (const r of (att.data || []) as any[]) byEmp.set(r.employee_id, r);
      const onLeaveIds = new Set(((leave.data || []) as any[]).map((l) => l.employee_id));
      const each = emps.map((e) => { const r = byEmp.get(e.id); const st: PeopleState = onLeaveIds.has(e.id) && !r?.check_in ? "leave" : !r?.check_in ? "missing" : r.check_out ? "done" : "working"; return { ...e, st, late: !!r?.is_late }; });
      const cnt = (st: PeopleState) => each.filter((x) => x.st === st).length;
      const depts: Record<string, { name: string; n: number; working: number; leave: number; missing: number }> = {};
      for (const x of each) { const k = x.department || "부서 없음"; const d = depts[k] || (depts[k] = { name: k, n: 0, working: 0, leave: 0, missing: 0 }); d.n++; if (x.st === "working" || x.st === "done") d.working++; if (x.st === "leave") d.leave++; if (x.st === "missing") d.missing++; }
      return {
        active: emps.length, working: cnt("working"), done: cnt("done"), late: each.filter((x) => x.late).length, missing: cnt("missing"), onLeave: cnt("leave"), overtimeOver: 0,
        each, depts: Object.values(depts).sort((a, b) => b.n - a.n),
        leaveNames: each.filter((x) => x.st === "leave").map((x) => x.name), missingNames: each.filter((x) => x.st === "missing").map((x) => x.name),
      };
    },
  });

  // ── 최근 처리: 결재(상태 무관 최신) + 계산서 — G안 표는 쪽을 나누므로 넉넉히 ──
  const { data: recent } = useQuery({
    queryKey: ["report-recent-v3", companyId, today], enabled: !!companyId && (perm.approvals || perm.tax) && live, staleTime: 60_000,
    queryFn: async (): Promise<RecentRow[]> => {
      const [ap, ti] = await Promise.all([
        perm.approvals ? db.from("approval_requests").select("id, title, request_type, amount, status, updated_at, created_at, requester_id").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
        perm.tax ? db.from("tax_invoices").select("id, counterparty_name, total_amount, type, issue_date, status, created_at").eq("company_id", companyId).neq("status", "void").order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
      ]);
      //   누가 올렸나 — 결재 요청자만 이름을 안다(계산서는 작성자 칸이 없어 비움). users 는 같은 회사만 읽힌다.
      const ids = [...new Set(((ap.data || []) as any[]).map((r) => r.requester_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (ids.length) { const u = await db.from("users").select("id, name").in("id", ids); for (const r of (u.data || []) as any[]) if (r.name) names.set(r.id, r.name); }
      return [
        ...((ap.data || []) as any[]).map((r) => ({ id: `a:${r.id}`, title: r.title || "결재 요청", kind: REQUEST_TYPE_LABELS[r.request_type as keyof typeof REQUEST_TYPE_LABELS] || "결재", at: r.updated_at || r.created_at, amount: Number(r.amount || 0), status: APPR_STATUS[r.status || ""] || { label: r.status || "-", tone: "m" }, href: "/approvals", who: names.get(r.requester_id) || null })),
        ...((ti.data || []) as any[]).map((r) => ({ id: `t:${r.id}`, title: `${r.counterparty_name || "미상"} ${r.type === "sales" ? "매출" : "매입"} 계산서`, kind: "계산서", at: r.created_at || r.issue_date, amount: Number(r.total_amount || 0), status: r.status === "draft" ? { label: "발행 전", tone: "warn" } : { label: "발행", tone: "good" }, href: "/tax-invoices" })),
      ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 18);
    },
  });

  // ── 스냅샷 (결정 168): 지난 날은 저장본만 읽는다 ──
  const { data: snap, isFetched: snapFetched } = useQuery({
    queryKey: ["dg-snapshot", companyId, day], enabled: !!companyId && snapOn && past, staleTime: 5 * 60_000,
    queryFn: async () => { const { data } = await db.from("daily_report_snapshots").select("payload, updated_at").eq("company_id", companyId).eq("day", day).maybeSingle(); return (data as { payload: any; updated_at: string } | null) ?? null; },
  });
  //   잔액 이력 — 지난 30일 스냅샷의 balance (없는 날은 화면이 역산으로 채운다)
  const { data: balHistory } = useQuery({
    queryKey: ["dg-snap-balance", companyId, today], enabled: !!companyId && snapOn && perm.finance, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await db.from("daily_report_snapshots").select("day, payload->balance").eq("company_id", companyId).gte("day", shiftDay(today, -30)).order("day");
      const m = new Map<string, number>(); for (const r of (data || []) as any[]) { const b = Number(r.balance); if (isFinite(b)) m.set(String(r.day).slice(0, 10), b); } return m;
    },
  });
  //   오늘 숫자를 남긴다 — 화면이 읽은 것만, 30분에 한 번. 실패해도 화면엔 영향 없음(조용히).
  const ready = live && (!perm.finance || (s !== undefined && outlook !== undefined && bankToday !== undefined)) && (!perm.ledger || recv !== undefined)
    && (!perm.projects || proj !== undefined) && (!perm.inventory || inv !== undefined) && (!perm.people || people !== undefined) && (!(perm.approvals || perm.tax) || recent !== undefined);
  useEffect(() => {
    if (!snapOn || !ready || !companyId) return;
    const key = `dg-snap:${companyId}:${today}`;
    try { const last = Number(localStorage.getItem(key) || 0); if (Date.now() - last < SNAP_MIN_GAP_MS) return; } catch { /* noop */ }
    const payload = {
      version: 1, savedAt: new Date().toISOString(), balance: s?.cash.balance ?? null, horizon,
      s: s ?? null, curve: curve ?? null, taxItems,
      bankToday: bankToday ? { inn: bankToday.inn, out: bankToday.out, n: bankToday.n, names: bankToday.names } : null,
      recv: recv ? { ...recv, list: recv.list.slice(0, 100), byAmount: recv.byAmount.slice(0, 20) } : null,
      proj: proj ?? null, inv: inv ?? null, people: people ?? null, recent: recent ?? null,
    };
    db.from("daily_report_snapshots").upsert({ company_id: companyId, day: today, payload, updated_at: new Date().toISOString() }, { onConflict: "company_id,day" })
      .then(({ error }: { error: unknown }) => { if (!error) { try { localStorage.setItem(key, String(Date.now())); } catch { /* noop */ } } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapOn, ready, companyId, today]);

  if (past) {
    const pl = snap?.payload;
    const bt = pl?.bankToday ? { ...pl.bankToday, netByDay: new Map<string, number>() } : undefined;
    return {
      today, day, past, snapshotMissing: snapFetched && !snap, savedAt: snap?.payload?.savedAt as string | undefined, balHistory,
      s: (pl?.s ?? undefined) as typeof s, curve: (pl?.curve ?? null) as typeof curve, taxItems: (pl?.taxItems ?? []) as typeof taxItems,
      bankToday: bt as typeof bankToday, recv: (pl?.recv ?? undefined) as typeof recv, proj: (pl?.proj ?? undefined) as typeof proj,
      inv: (pl?.inv ?? undefined) as typeof inv, people: (pl?.people ?? undefined) as typeof people, recent: (pl?.recent ?? undefined) as typeof recent,
    };
  }
  return { today, day, past, snapshotMissing: false, savedAt: undefined as string | undefined, balHistory, s, curve, taxItems, bankToday, recv, proj, inv, people, recent };
}
