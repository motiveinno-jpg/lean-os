"use client";
import { logRead } from "@/lib/log-read";

// 근태관리 연장근무 현황 — 직원별 연장근무 횟수·총 시간 (2026-07-01)
//   출퇴근 기록(attendance_records.overtime_minutes) 기준 실제 연장시간을 연도별로 집계.
//   연장근무 신청/승인과 별개로, 실제 기록된 연장근무를 누가 몇 번·몇 시간 했는지 표로 보여줌.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

const hm = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h}시간 ${mm}분` : `${mm}분`;
};

export function OvertimeStats({ companyId }: { companyId: string }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["overtime-stats", companyId, year],
    queryFn: async () => {
      const data = logRead('components/overtime-stats:data', await db
        .from("attendance_records")
        .select("employee_id, overtime_minutes, employees(name)")
        .eq("company_id", companyId)
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`)
        .gt("overtime_minutes", 0)
        .limit(20000));
      const map = new Map<string, { name: string; count: number; minutes: number }>();
      for (const r of (data || []) as any[]) {
        const k = r.employee_id;
        if (!k) continue;
        if (!map.has(k)) map.set(k, { name: r.employees?.name || "직원", count: 0, minutes: 0 });
        const e = map.get(k)!;
        e.count += 1;
        e.minutes += Number(r.overtime_minutes || 0);
      }
      return [...map.values()].sort((a, b) => b.minutes - a.minutes);
    },
    enabled: !!companyId,
  });

  const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
  const totalCnt = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="overtime-stats-card glass-card">
      <div className="overtime-stats-header">
        <h3 className="text-sm font-bold text-[var(--text)]">
          연장근무 현황 <span className="text-xs font-normal text-[var(--text-dim)]">누가 · 몇 번 · 몇 시간</span>
        </h3>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="overtime-stats-year-select">
          {[nowYear, nowYear - 1, nowYear - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="overtime-stats-loading">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="overtime-stats-empty">{year}년 연장근무 기록이 없습니다.</div>
      ) : (
        <table className="overtime-stats-table">
          <thead className="text-[var(--text-muted)] border-b border-[var(--border)]">
            <tr>
              <th className="text-left py-2 font-semibold">직원</th>
              <th className="text-right py-2 font-semibold">연장 횟수</th>
              <th className="text-right py-2 font-semibold">총 연장시간</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="overtime-stats-row">
                <td className="py-2 text-[var(--text)]">{r.name}</td>
                <td className="py-2 text-right mono-number text-[var(--text-muted)]">{r.count}회</td>
                <td className="py-2 text-right mono-number font-semibold text-[var(--text)]">{hm(r.minutes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="overtime-stats-footer">
              <td className="py-2 font-bold text-[var(--text)]">합계</td>
              <td className="py-2 text-right font-bold mono-number text-[var(--text)]">{totalCnt}회</td>
              <td className="py-2 text-right font-bold mono-number text-[var(--primary)]">{hm(totalMin)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="overtime-stats-note">* 출퇴근 기록의 연장근무 시간(overtime) 기준 — 실제 기록된 연장근무입니다.</p>
    </div>
  );
}
