"use client";

// 대시보드 층 2 오른쪽 '오늘 한눈' — 세금·납부 / 결재 대기 / 오늘 일정·할 일을 한 카드 안 세 절로 (2026-09-03 대시보드 v2 결정 150)
//   History: 세 가지가 각각 위젯(223px)이었고 비어 있어도 그 크기를 차지했다(첫 화면 12개 중 빈 상자 3개).
//   규칙: 절은 비면 한 줄로 준다. 숫자·이름은 눌러서 그 화면으로. 색은 점(위험·주의·진행)만 — 칩 없음(결정 152).
//   자료 출처는 기존 위젯과 같다: 세금 = getUpcomingTaxDeadlines + tax_deadline_checks(납부 완료 제외),
//   결재 = 결재허브 게이트(isMaster ‖ /approvals:all → 회사 전체, 아니면 내 차례), 일정 = schedule_events 오늘 + 날짜 없는 내 할 일.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";
import { fetchTaxDeadlineChecks } from "@/lib/tax-deadline-checks";
import { REQUEST_TYPE_LABELS, getMyPendingApprovals } from "@/lib/approval-workflow";
import { getScheduleItems, getMonthEvents } from "@/lib/schedule";
import { todayKst } from "@/lib/kst";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function DashboardGlance({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const { user } = useUser();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const canFinance = isMaster || hasPerm("/dashboard:finance");
  const canApprovals = isMaster || hasPerm("/approvals");
  const companyWide = isMaster || hasPerm("/approvals:all");

  // ── 세금·납부 (재무 권한자만) ──
  const { data: taxChecked = new Set<string>() } = useQuery({
    queryKey: ["tax-deadline-checks", companyId],
    enabled: !!companyId && canFinance,
    staleTime: 60_000,
    queryFn: () => fetchTaxDeadlineChecks(companyId!),
  });
  const taxItems = canFinance ? getUpcomingTaxDeadlines(60).filter((t) => !taxChecked.has(t.id)).slice(0, 3) : [];

  // ── 결재 대기 (결재허브 위젯과 같은 게이트·같은 표) ──
  const { data: approvals } = useQuery({
    queryKey: ["dash-approvals-pending", companyId, companyWide ? "all" : user?.id || ""],
    enabled: !!companyId && canApprovals && !permLoading && (companyWide || !!user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      if (!companyWide) {
        const mine = await getMyPendingApprovals(user!.id, companyId!);
        return mine.map((m: any) => ({ id: m.stepId, title: m.title, request_type: m.requestType }));
      }
      const res = await db.from("approval_requests").select("id, title, request_type")
        .eq("company_id", companyId).eq("status", "pending").order("created_at", { ascending: false }).limit(15);
      return (res.data || []) as { id: string; title: string; request_type: string }[];
    },
  });
  const apprList = approvals || [];

  // ── 오늘 일정·할 일 (내 것: 오늘 일정 + 날짜 없는 할 일) ──
  const today = todayKst();
  const now = new Date();
  const { data: todos = [] } = useQuery({
    queryKey: ["schedule-items", companyId, userId, false, true],
    enabled: !!companyId && !!userId,
    refetchInterval: 60_000,
    queryFn: async () => (await getScheduleItems(companyId!, { mineOnly: true, userId: userId! })).filter((i) => !i.start_at),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["schedule-events", companyId, now.getFullYear(), now.getMonth(), "both", userId],
    enabled: !!companyId && !!userId,
    staleTime: 60_000,
    queryFn: () => getMonthEvents(companyId!, now.getFullYear(), now.getMonth(), { scope: "all", userId: userId! }),
  });
  const todayEvents = (events as any[]).filter((e) => !e.completed && String(e.start_at || "").slice(0, 10) === today);
  const dayItems = [
    ...todayEvents.map((e) => ({ id: e.id, title: e.title as string, when: String(e.start_at).slice(11, 16) })),
    ...(todos as any[]).map((t) => ({ id: t.id, title: t.title as string, when: "" })),
  ].slice(0, 4);

  return (
    <div className="glass-card dash-glance">
      {canFinance && (
        <section className="dash-glance-sec">
          <h3 className="dash-glance-h"><span>세금·납부</span><span className="flex-1" /><Link href="/finance/tax-filing" className="dash-glance-go">60일 →</Link></h3>
          {taxItems.length === 0
            ? <p className="dash-glance-empty">60일 안에 낼 세금이 없습니다</p>
            : taxItems.map((t) => (
              <Link key={t.id} href={t.href} className={`dash-glance-row ${t.daysLeft <= 7 ? "is-bad" : t.daysLeft <= 14 ? "is-warn" : ""}`}>
                <i className="dash-glance-dot" /><span className="dash-glance-name">{t.title}</span>
                <span className="dash-glance-r mono-number">{t.date.slice(5).replace("-", "/")} · {t.daysLeft === 0 ? "오늘" : `D-${t.daysLeft}`}</span>
              </Link>
            ))}
        </section>
      )}
      {canApprovals && (
        <section className="dash-glance-sec">
          <h3 className="dash-glance-h"><span>결재 대기</span>{apprList.length > 0 && <span className="dash-glance-cnt mono-number">{apprList.length}</span>}<span className="flex-1" /><Link href="/approvals" className="dash-glance-go">→</Link></h3>
          {apprList.length === 0
            ? <p className="dash-glance-empty">{companyWide ? "대기 중인 결재 없음" : "내가 결재할 차례인 건 없음"}</p>
            : apprList.slice(0, 3).map((r) => (
              <Link key={r.id} href="/approvals" className="dash-glance-row is-p">
                <i className="dash-glance-dot" /><span className="dash-glance-name">{r.title}</span>
                <span className="dash-glance-r">{REQUEST_TYPE_LABELS[r.request_type as keyof typeof REQUEST_TYPE_LABELS] || "결재"}</span>
              </Link>
            ))}
          {apprList.length > 3 && <Link href="/approvals" className="dash-glance-more">외 {apprList.length - 3}건 →</Link>}
        </section>
      )}
      <section className="dash-glance-sec">
        <h3 className="dash-glance-h"><span>오늘 일정 · 할 일</span>{dayItems.length > 0 && <span className="dash-glance-cnt mono-number">{dayItems.length}</span>}<span className="flex-1" /><Link href="/schedule" className="dash-glance-go">→</Link></h3>
        {dayItems.length === 0
          ? <p className="dash-glance-empty">오늘 등록된 일정 없음 · <Link href="/schedule" className="dash-glance-link">할 일 추가</Link></p>
          : dayItems.map((d) => (
            <Link key={d.id} href="/schedule" className="dash-glance-row is-p">
              <i className="dash-glance-dot" /><span className="dash-glance-name">{d.title}</span>
              {d.when && <span className="dash-glance-r mono-number">{d.when}</span>}
            </Link>
          ))}
      </section>
    </div>
  );
}
