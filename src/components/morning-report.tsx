"use client";

// 아침 보고서 — 대시보드 첫 화면 (2026-09-03 대시보드 v3, docs/20260903_PLAN_dashboard_v3_report.md 결정 158~162)
//   History: 위젯 격자 13장이 벽처럼 서서 "정신사나움"(사장님). 한 열 문서로 바꾼다 — 읽는 순서 고정:
//   결론 → 01 회사 상태 → 02 오늘 챙길 것 → 03 자금 → 04 매출·미수 → 05 업무 → 06 사람 → 부록(위젯 격자, 접힘).
//   결정 159: 절 문장은 lib/report-lines.ts 규칙, 결론·챙길 것만 AI(MorningBrief 그대로).
//   결정 160: 절은 **개인별 메뉴 권한**이 켜고 끈다(역할 프리셋 없음) — perm 은 page 가 useMyPermissions 로 계산해 넘긴다.
//   결정 161: 부록 = 기존 DashboardGrid(크기 조절 없음·빈 위젯 접기). 펼침 상태는 기기에 기억(보기 상태).
//   결정 162: 문서 타이포 — 날짜 26 / 절 15 / 본문 14 / 표 13. 색은 톤 글자와 링크만.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { fetchBizSummary } from "@/lib/biz-summary";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import { fetchTaxDeadlineChecks } from "@/lib/tax-deadline-checks";
import { fetchPaged } from "@/lib/fetch-paged";
import { fundsLines, salesLines, workLines, peopleLines, wonK, type Line } from "@/lib/report-lines";

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

function Sec({ no, title, links, children }: { no: string; title: string; links?: { href: string; label: string }[]; children: ReactNode }) {
  return (
    <section className="rep-sec">
      <div className="rep-sec-h">
        <span className="rep-sec-no mono-number">{no}</span>
        <h2 className="rep-sec-title">{title}</h2>
        <span className="flex-1" />
        {links?.map((l) => <Link key={l.href} href={l.href} className="rep-sec-link">{l.label} →</Link>)}
      </div>
      {children}
    </section>
  );
}

export function MorningReport({
  companyId, userId, companyName, perm, forecast30, unclassified, approvalsPending, lead, checklist, signals, appendix, appendixCount,
}: {
  companyId: string; userId: string | null; companyName: string; perm: ReportPerm;
  forecast30: number | null; unclassified: { bank: number; card: number }; approvalsPending: number | null;
  lead: ReactNode; checklist: ReactNode; signals: ReactNode; appendix: ReactNode; appendixCount: number;
}) {
  const today = todayKst();
  const month = today.slice(0, 7);
  const isWeekend = [0, 6].includes(new Date(today + "T00:00:00").getDay());

  //   경영 요약과 같은 함수·같은 키 — 신호 띠와 캐시를 나눠 쓴다
  const { data: s } = useQuery({
    queryKey: ["biz-summary", companyId, month],
    queryFn: () => fetchBizSummary(companyId, month, userId || undefined),
    enabled: !!companyId && perm.finance, staleTime: 60_000,
  });

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
      for (const t of rows || []) { const a = Number(t.amount || 0); const isIn = t.type === "in" || t.type === "deposit" || a > 0; if (isIn) inn += Math.abs(a); else out += Math.abs(a); if (names.length < 3) names.push(`${t.counterparty || t.description || "-"} ${isIn ? "+" : "−"}${wonK(Math.abs(a))}`); }
      return { inn, out, n: (rows || []).length, names };
    },
  });

  // ── 미수 상위 5곳 (미수금 위젯과 같은 규칙: 매출 계산서 미정산, 오래된 순) ──
  const { data: recv } = useQuery({
    queryKey: ["dash-receivables", companyId], enabled: !!companyId && perm.ledger, staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 400);
      const rows = await fetchPaged<any>("morning-report:recv", () => db.from("tax_invoices")
        .select("counterparty_name, total_amount, supply_amount, settled_amount, issue_date, status")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void").gte("issue_date", since.toISOString().slice(0, 10)).order("id"), 50000);
      const todayMs = new Date(today + "T00:00:00").getTime();
      const by: Record<string, { name: string; outstanding: number; oldestDays: number; count: number }> = {};
      for (const r of (rows || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0); if (bal <= 1) continue;
        const name = r.counterparty_name || "미상";
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const g = by[name] || (by[name] = { name, outstanding: 0, oldestDays: 0, count: 0 });
        g.outstanding += bal; g.count += 1; g.oldestDays = Math.max(g.oldestDays, days);
      }
      const list = Object.values(by).sort((a, b) => b.oldestDays - a.oldestDays || b.outstanding - a.outstanding);
      return { list, total: list.reduce((x, g) => x + g.outstanding, 0) };
    },
  });

  // ── 업무: 프로젝트(활성·기한 지난 줄·이번 주 마감·변동 없음) · 재고 부족 ──
  const { data: proj } = useQuery({
    queryKey: ["report-projects", companyId, today], enabled: !!companyId && perm.projects, staleTime: 60_000,
    queryFn: async () => {
      const [deals, items] = await Promise.all([
        db.from("deals").select("id, last_activity_at, created_at").eq("company_id", companyId).is("archived_at", null).is("parent_deal_id", null),
        db.from("project_items").select("deal_id, status, due_date").eq("company_id", companyId).is("archived_at", null).not("due_date", "is", null),
      ]);
      const ds = (deals.data || []) as any[]; const its = (items.data || []) as any[];
      const week = new Date(today + "T00:00:00"); week.setDate(week.getDate() + 7); const weekStr = week.toISOString().slice(0, 10);
      const stale = new Date(today + "T00:00:00"); stale.setDate(stale.getDate() - 7); const staleMs = stale.getTime();
      let overdue = 0, dueSoon = 0;
      for (const it of its) { if (it.status === "done") continue; const dd = String(it.due_date).slice(0, 10); if (dd < today) overdue++; else if (dd <= weekStr) dueSoon++; }
      const staleN = ds.filter((d) => new Date(d.last_activity_at || d.created_at || today).getTime() < staleMs).length;
      return { active: ds.length, overdue, dueSoon, stale: staleN };
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
      return { list: list.slice(0, 5), count: list.length };
    },
  });

  // ── 사람: 재직 · 오늘 근태 ──
  const { data: people } = useQuery({
    queryKey: ["report-people", companyId, today], enabled: !!companyId && perm.people, staleTime: 60_000,
    queryFn: async () => {
      const [emp, att, leave] = await Promise.all([
        db.from("employees").select("id").eq("company_id", companyId).in("status", ["active", "joined"]),
        db.from("attendance_records").select("employee_id, check_in, check_out, is_late").eq("company_id", companyId).eq("date", today),
        db.from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", today).gte("end_date", today),
      ]);
      const active = (emp.data || []).length;
      const rows = (att.data || []) as any[];
      const onLeaveIds = new Set(((leave.data || []) as any[]).map((l) => l.employee_id));
      let working = 0, done = 0, late = 0; const seen = new Set<string>();
      for (const r of rows) { seen.add(r.employee_id); if (!r.check_in) continue; if (r.check_out) done++; else working++; if (r.is_late) late++; }
      const missing = Math.max(0, active - seen.size - [...onLeaveIds].filter((id) => !seen.has(id)).length);
      return { active, working, done, late, missing, onLeave: onLeaveIds.size, overtimeOver: 0 };
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
  const dateLabel = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });

  return (
    <article className="rep">
      <header className="rep-top">
        <h1 className="rep-date">{dateLabel}</h1>
        <span className="rep-co">{companyName} · 아침 보고서</span>
        <span className="flex-1" />
        <button type="button" className="rep-tool" onClick={() => window.print()}>인쇄</button>
      </header>
      {perm.briefing && lead}

      {perm.finance && (
        <Sec no={no()} title="회사 상태" links={[{ href: "/reports/summary", label: "경영 요약" }]}>{signals}</Sec>
      )}
      {perm.briefing && (
        <Sec no={no()} title="오늘 챙길 것">{checklist}</Sec>
      )}
      {perm.finance && (
        <Sec no={no()} title="자금" links={[{ href: "/bank", label: "통장" }, { href: "/reports/outlook", label: "자금 전망" }]}>
          <Sentence lines={fundsLines(s, forecast30, unclassified)} />
          <div className="rep-cols">
            {perm.tax && (
              <div>
                <h3 className="rep-h3">세금·납부</h3>
                {taxItems.length === 0 ? <p className="rep-none">60일 안에 낼 세금 없음</p> : (
                  <table className="rep-tbl"><tbody>
                    {taxItems.map((t) => <tr key={t.id}><td><Link href={t.href} className="rep-link">{t.title}</Link></td><td className="r mono-number">{t.date.slice(5).replace("-", "/")}</td><td className={`r mono-number ${t.daysLeft <= 7 ? "rep-t-bad" : "m"}`}>{t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</td></tr>)}
                  </tbody></table>
                )}
              </div>
            )}
            <div>
              <h3 className="rep-h3">오늘 통장</h3>
              {!bankToday ? <p className="rep-none">읽는 중…</p> : bankToday.n === 0 ? <p className="rep-none">오늘 들어온 거래 없음</p> : (
                <table className="rep-tbl"><tbody>
                  <tr><td>입금</td><td className="r mono-number rep-t-good">+{wonK(bankToday.inn)}</td></tr>
                  <tr><td>출금</td><td className="r mono-number">−{wonK(bankToday.out)}</td></tr>
                  <tr><td>최근</td><td className="r m">{bankToday.names.join(" · ")}</td></tr>
                </tbody></table>
              )}
            </div>
          </div>
        </Sec>
      )}
      {showSales && (
        <Sec no={no()} title="매출·미수" links={[{ href: "/reports/profit", label: "손익 현황" }, { href: "/partners/ledger?type=sales", label: "거래처 원장" }]}>
          {perm.finance && <Sentence lines={salesLines(s)} />}
          {perm.ledger && recv && recv.list.length > 0 && (
            <>
              <p className="rep-p">오래된 순 상위 다섯 곳:</p>
              <table className="rep-tbl">
                <thead><tr><th>거래처</th><th className="r">금액</th><th className="r">지연</th></tr></thead>
                <tbody>{recv.list.slice(0, 5).map((g) => (
                  <tr key={g.name}><td><Link href="/partners/ledger?type=sales" className="rep-link">{g.name}</Link>{g.count > 1 && <span className="m"> · {g.count}건</span>}</td>
                    <td className="r mono-number">{wonK(g.outstanding)}</td><td className={`r mono-number ${g.oldestDays >= 30 ? "rep-t-bad" : "m"}`}>{g.oldestDays}일</td></tr>
                ))}</tbody>
              </table>
              {recv.list.length > 5 && <p className="rep-more"><Link href="/partners/ledger?type=sales" className="rep-link">외 {recv.list.length - 5}곳 →</Link></p>}
            </>
          )}
          {perm.ledger && recv && recv.list.length === 0 && <p className="rep-none">미수금 없음 — 발행한 세금계산서가 모두 회수됐습니다.</p>}
        </Sec>
      )}
      {showWork && (
        <Sec no={no()} title="업무" links={[...(perm.projects ? [{ href: "/projecthub", label: "프로젝트" }] : []), ...(perm.approvals ? [{ href: "/approvals", label: "결재" }] : [])]}>
          <Sentence lines={workLines({ approvals: perm.approvals ? approvalsPending : null, projects: perm.projects ? (proj ?? null) : null, inventoryShort: perm.inventory ? (inv?.count ?? null) : null })} />
          {perm.inventory && inv && inv.count > 0 && (
            <div className="rep-cols"><div>
              <h3 className="rep-h3">안전재고 아래</h3>
              <table className="rep-tbl"><tbody>{inv.list.map((p) => (
                <tr key={p.id}><td><Link href="/inventory/stock" className="rep-link">{p.name}</Link>{p.spec && <span className="m"> · {p.spec}</span>}</td><td className={`r mono-number ${p.qty <= 0 ? "rep-t-bad" : "rep-t-warn"}`}>{p.qty} / {p.safety}</td></tr>
              ))}</tbody></table>
            </div></div>
          )}
        </Sec>
      )}
      {perm.people && (
        <Sec no={no()} title="사람" links={[{ href: "/attendance", label: "근태" }]}>
          <Sentence lines={peopleLines(people ?? null, isWeekend)} />
        </Sec>
      )}

      <section className={`rep-apx ${apx ? "is-open" : ""}`}>
        <div className="rep-apx-h">
          <b>부록 — 위젯 격자</b><span className="rep-apx-hint mono-number">쓸 수 있는 위젯 {appendixCount}개</span>
          <span className="rep-apx-hint">보고서로 부족하면 여기서 펼쳐 보고, 순서를 바꾸거나 켜고 끕니다</span>
          <span className="flex-1" />
          <button type="button" className="rep-apx-btn" onClick={toggleApx}>{apx ? "접기 ▴" : "펼치기 ▾"}</button>
        </div>
        {apx && <div className="rep-apx-body">{appendix}</div>}
      </section>
      <footer className="rep-foot"><span>출처: 확정 전표 · 통장/카드 수집 · 근태 기록 · 프로젝트</span><span>절 문장은 규칙, 결론과 챙길 것만 AI 제안</span></footer>
    </article>
  );
}
