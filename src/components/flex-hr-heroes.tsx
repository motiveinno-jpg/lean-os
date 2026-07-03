"use client";

// 플렉스(flex.team) 스타일 HR 세부탭 히어로 (2026-06-12).
//   급여/계약서/경비청구/휴가/증명서 탭 상단에 모듈 히어로(아이콘+설명+실데이터 지표 칩)를 얹는다.
//   기존 탭 컴포넌트(PayrollPreviewTab/ContractTab/ExpenseTab/LeaveTab/CertificateTab)는 무수정 —
//   히어로는 조망 레이어, 수치는 전부 기존 테이블에서 derive (가짜 metric 금지).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;

// ── 공통 히어로 셸 (라운드6: 흰 카드 + 인디고 포인트, 그라데이션 제거) ──
export function FlexTabHero({ icon, title, desc, chips }: {
  icon: string; title: string; desc: string;
  chips: { label: string; value: string; tone?: "violet" | "green" | "amber" | "red" | "blue" | "dim" }[];
}) {
  const toneColor: Record<string, string> = { violet: "var(--primary)", green: "var(--success)", amber: "var(--warning)", red: "var(--danger)", blue: "var(--info)", dim: "var(--text-muted)" };
  return (
    <div className="glass-card mb-4 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 bg-[var(--primary-light)]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold text-[var(--text)]">{title}</span>
          <span className="block text-[11px] text-[var(--text-dim)] truncate">{desc}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap ml-auto">
        {chips.map((c) => (
          <div key={c.label} className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wide">{c.label}</div>
            <div className="text-[13px] font-bold mono-number" style={{ color: toneColor[c.tone || "violet"] }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 급여: 지급 대상·월 급여 총액·4대보험 회사부담(10.554%)·연 인건비 ──
export function PayrollHero({ employees }: { employees: any[] }) {
  const active = employees.filter((e) => ["active", "joined"].includes(String(e.status || "")));
  const monthly = active.reduce((s, e) => s + Number(e.salary || 0), 0);
  const insurance = Math.round(monthly * 0.10554); // 사업주 부담률 합계 추정 (PnL 과 동일 기준)
  return (
    <FlexTabHero icon="💸" title="급여" desc="명세서 생성 · 4대보험 자동 계산 · PDF 발급"
      chips={[
        { label: "지급 대상", value: `${active.length}명`, tone: "violet" },
        { label: "월 급여 총액", value: won(monthly), tone: "blue" },
        { label: "4대보험 회사부담(추정)", value: won(insurance), tone: "amber" },
        { label: "연 인건비", value: won(monthly * 12), tone: "red" },
      ]} />
  );
}

// ── 계약서: 전체·서명 대기·완료 ──
export function ContractsHero({ contracts }: { contracts: any[] }) {
  const status = (c: any) => String(c.status || "").toLowerCase();
  const done = contracts.filter((c) => ["signed", "completed", "active"].includes(status(c))).length;
  const pending = contracts.filter((c) => ["pending", "sent", "draft", "waiting"].includes(status(c))).length;
  return (
    <FlexTabHero icon="📝" title="근로계약" desc="전자 근로계약 발송 · 서명 추적 · 보관"
      chips={[
        { label: "전체 계약", value: `${contracts.length}건`, tone: "violet" },
        { label: "서명 대기", value: `${pending}건`, tone: pending > 0 ? "amber" : "dim" },
        { label: "체결 완료", value: `${done}건`, tone: "green" },
      ]} />
  );
}

// ── 경비청구: 승인 대기 건수·대기 금액·이번 달 신청 합 ──
export function ExpensesHero({ expenses }: { expenses: any[] }) {
  const pend = expenses.filter((e) => String(e.status || "") === "pending");
  const pendAmt = pend.reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthStart = (() => { const k = new Date(Date.now() + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-01`; })();
  const monthAmt = expenses.filter((e) => String(e.created_at || "").slice(0, 10) >= monthStart)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  return (
    <FlexTabHero icon="🧾" title="경비청구" desc="영수증 첨부 · 결재 승인 · 지급 처리"
      chips={[
        { label: "승인 대기", value: `${pend.length}건`, tone: pend.length > 0 ? "amber" : "dim" },
        { label: "대기 금액", value: won(pendAmt), tone: pend.length > 0 ? "red" : "dim" },
        { label: "이번 달 신청", value: won(monthAmt), tone: "blue" },
      ]} />
  );
}

// ── 휴가: 오늘 휴가중·승인 대기·올해 사용률 ──
export function LeaveHero({ companyId }: { companyId: string }) {
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const year = Number(kstToday.slice(0, 4));

  const { data } = useQuery({
    queryKey: ["flex-leave-hero", companyId, kstToday],
    queryFn: async () => {
      const [pendRes, todayRes, balRes] = await Promise.all([
        db.from("leave_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending"),
        db.from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
        db.from("leave_balances").select("total_days, used_days").eq("company_id", companyId).eq("year", year),
      ]);
      const onLeave = new Set(((todayRes.data || []) as any[]).map((r) => r.employee_id)).size;
      const totals = ((balRes.data || []) as any[]).reduce((a, b) => ({ t: a.t + Number(b.total_days || 0), u: a.u + Number(b.used_days || 0) }), { t: 0, u: 0 });
      return { pending: pendRes.count || 0, onLeave, total: totals.t, used: totals.u };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const pct = data && data.total > 0 ? Math.round((data.used / data.total) * 100) : 0;
  return (
    <FlexTabHero icon="🏖" title="휴가" desc="연차 신청 · 승인 · 잔여 관리"
      chips={[
        { label: "오늘 휴가중", value: `${data?.onLeave ?? 0}명`, tone: "green" },
        { label: "승인 대기", value: `${data?.pending ?? 0}건`, tone: (data?.pending ?? 0) > 0 ? "amber" : "dim" },
        { label: `${year} 사용률`, value: data && data.total > 0 ? `${pct}% (${data.used}/${data.total}일)` : "—", tone: "violet" },
      ]} />
  );
}

// ── 증명서: 이번 달 발급·누적 발급 ──
export function CertificatesHero({ companyId }: { companyId: string }) {
  const monthStart = (() => { const k = new Date(Date.now() + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-01`; })();
  const { data } = useQuery({
    queryKey: ["flex-cert-hero", companyId],
    queryFn: async () => {
      const { data: logs } = await db.from("certificate_logs").select("id, created_at").eq("company_id", companyId).limit(2000);
      const all = (logs || []) as any[];
      const month = all.filter((l) => String(l.created_at || "").slice(0, 10) >= monthStart).length;
      return { total: all.length, month };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
  return (
    <FlexTabHero icon="📄" title="증명서 발급" desc="재직 · 경력 증명서 즉시 발급 (PDF)"
      chips={[
        { label: "이번 달 발급", value: `${data?.month ?? 0}건`, tone: "violet" },
        { label: "누적 발급", value: `${data?.total ?? 0}건`, tone: "dim" },
      ]} />
  );
}
