"use client";
//   달력이 보여 줄 공휴일 — 한 규칙으로 모은다.
//
//   근태·급여는 회사별 holidays 표(설정에서 고침)를 쓰는데, 대시보드 달력과 일정 화면은
//   공휴일을 아예 안 그리고 있었다(추석이 달력에 안 보인다는 지적). 같은 표를 달력도 본다.
//   회사 표에 그 해 행이 하나도 없으면(아직 안 채운 회사) 코드의 전국 공휴일 표로 대체해
//   어느 회사든 빈 달력이 되지 않게 한다. 회사 표에 행이 있으면 그 표가 전부다 —
//   회사가 일부러 뺀 날을 전국 표로 되살리지 않는다.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { holidaysOfYear } from "@/lib/holidays";

export function useCompanyHolidays(companyId: string | null | undefined, years: number[]) {
  const key = [...new Set(years)].sort().join(",");
  const q = useQuery({
    queryKey: ["company-holidays", companyId, key],
    enabled: !!companyId && years.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const ys = [...new Set(years)];
      const { data, error } = await supabase
        .from("holidays")
        .select("date, name")
        .eq("company_id", companyId!)
        .gte("date", `${Math.min(...ys)}-01-01`)
        .lte("date", `${Math.max(...ys)}-12-31`);
      if (error) throw error;
      const byYear = new Map<number, Record<string, string>>();
      for (const r of (data || []) as { date: string; name: string }[]) {
        const d = String(r.date).slice(0, 10); const y = Number(d.slice(0, 4));
        if (!byYear.has(y)) byYear.set(y, {});
        byYear.get(y)![d] = r.name;
      }
      const out: Record<string, string> = {};
      for (const y of ys) Object.assign(out, byYear.get(y) ?? holidaysOfYear(y));
      return out;
    },
  });
  return q.data ?? ({} as Record<string, string>);
}
