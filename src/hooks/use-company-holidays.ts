"use client";
//   달력이 보여 줄 공휴일 — 한 규칙으로 모은다.
//
//   근태·급여는 회사별 holidays 표(설정에서 고침)를 쓰는데, 대시보드 달력과 일정 화면은
//   공휴일을 아예 안 그리고 있었다(추석이 달력에 안 보인다는 지적). 같은 값을 달력도 본다.
//
//   ─ 어디서 오나 (우선순위) ───────────────────────────────────────────────
//   ① 전국 공휴일  national_holidays 캐시 — 공식 API(특일정보)가 채운다. 모든 회사 공통.
//   ② 코드 표      캐시가 비어 있으면(키 미설정·그 해 아직 미수집) holidays.ts 의 확정치로 대체.
//   ③ 회사 지정    회사 holidays 표 — 회사가 따로 넣은 임시휴무 등. 위에 **덮어쓴다**.
//   전국 공휴일은 캐시든 코드표든 항상 나오고, 회사가 더한 것만 추가로 얹힌다.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { holidaysOfYear } from "@/lib/holidays";

export function useCompanyHolidays(companyId: string | null | undefined, years: number[]) {
  const ys = [...new Set(years)].filter((y) => Number.isFinite(y));
  const key = ys.slice().sort().join(",");

  const q = useQuery({
    queryKey: ["holidays-merged", companyId, key],
    enabled: !!companyId && ys.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const from = `${Math.min(...ys)}-01-01`;
      const to = `${Math.max(...ys)}-12-31`;

      //   전국 캐시와 회사 표를 한 번에 — 전국 캐시 실패는 코드표로 대체하므로 치명적이지 않다
      const [nat, comp] = await Promise.all([
        //   national_holidays 는 새 테이블이라 생성 타입에 아직 없다(마이그 20260914170000) — 캐스트로 우회
        (supabase.from("national_holidays" as never) as any).select("date, name").gte("date", from).lte("date", to) as Promise<{ data: { date: string; name: string }[] | null; error: unknown }>,
        companyId
          ? supabase.from("holidays").select("date, name").eq("company_id", companyId).gte("date", from).lte("date", to)
          : Promise.resolve({ data: [], error: null } as { data: { date: string; name: string }[]; error: null }),
      ]);

      const out: Record<string, string> = {};

      //   ① 전국 캐시. 그 해에 캐시 행이 하나도 없으면 ② 코드표로 채운다(연도별로 판단).
      const natRows = (nat.data || []) as { date: string; name: string }[];
      const natYears = new Set(natRows.map((r) => Number(String(r.date).slice(0, 4))));
      for (const r of natRows) out[String(r.date).slice(0, 10)] = r.name;
      for (const y of ys) {
        if (natYears.has(y)) continue;
        for (const [d, name] of Object.entries(holidaysOfYear(y))) out[d] = name;
      }

      //   ③ 회사 지정이 맨 위 — 회사가 고친 이름/추가한 날이 이긴다
      for (const r of (comp.data || []) as { date: string; name: string }[]) {
        out[String(r.date).slice(0, 10)] = r.name;
      }
      return out;
    },
  });

  return q.data ?? ({} as Record<string, string>);
}
