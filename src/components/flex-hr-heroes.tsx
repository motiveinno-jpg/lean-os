"use client";
import { logRead } from "@/lib/log-read";

// 플렉스(flex.team) 스타일 HR 세부탭 히어로 (2026-06-12).
//   급여/계약서/경비청구/휴가/증명서 탭 상단에 모듈 히어로(아이콘+설명+실데이터 지표 칩)를 얹는다.
//   기존 탭 컴포넌트(PayrollPreviewTab/ContractTab/ExpenseTab/LeaveTab/CertificateTab)는 무수정 —
//   히어로는 조망 레이어, 수치는 전부 기존 테이블에서 derive (가짜 metric 금지).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;

// ── 공통 히어로 셸 (라운드6: 흰 카드 + 인디고 포인트, 그라데이션 제거) ──
export function FlexTabHero({ icon, title, desc, chips }: {
  icon: string; title: string; desc: string;
  chips: { label: string; value: string; tone?: "violet" | "green" | "amber" | "red" | "blue" | "dim" }[];
}) {
  const toneColor: Record<string, string> = { violet: "var(--primary)", green: "var(--success)", amber: "var(--warning)", red: "var(--danger)", blue: "var(--info)", dim: "var(--text-muted)" };
  return (
    <div className="flex-tab-hero glass-card">
      <div className="hero-title-block">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 bg-[var(--primary-light)]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold text-[var(--text)]">{title}</span>
          <span className="block text-[11px] text-[var(--text-dim)] truncate">{desc}</span>
        </span>
      </div>
      <div className="hero-chips-row">
        {chips.map((c) => (
          <div key={c.label} className="hero-chip">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wide">{c.label}</div>
            <div className="text-[13px] font-bold mono-number" style={{ color: toneColor[c.tone || "violet"] }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 급여: 지급 대상·월 급여 총액·4대보험 회사부담(10.554%)·연 인건비 ──
export function payrollStats(employees: any[]) {
  const active = employees.filter((e) => ["active", "joined"].includes(String(e.status || "")));
  const monthly = active.reduce((s, e) => s + Number(e.salary || 0), 0);
  const insurance = Math.round(monthly * 0.10554); // 사업주 부담률 합계 추정 (PnL 과 동일 기준)
  return { active, monthly, insurance };
}

// ── 증명서: 이번 달 발급·누적 발급 ──
//   2026-08-18 구성원 화면이 조회 표준(결과 요약 줄)로 바뀌며 지표만 따로 쓴다 — 히어로 카드와 같은 셈.
export function useCertificateStats(companyId: string | null) {
  const monthStart = (() => { const k = new Date(Date.now() + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-01`; })();
  const { data } = useQuery({
    queryKey: ["flex-cert-hero", companyId],
    queryFn: async () => {
      const logs = logRead('components/flex-hr-heroes:logs', await db.from("certificate_logs").select("id, created_at").eq("company_id", companyId!).limit(2000));
      const all = (logs || []) as any[];
      const month = all.filter((l) => String(l.created_at || "").slice(0, 10) >= monthStart).length;
      return { total: all.length, month };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
  return data;
}
