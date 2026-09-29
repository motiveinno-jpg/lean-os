"use client";

// 운영자 대시보드 — 페이지 체류 요약 (최근 7일 · 공개 페이지). 자세한 표는 매출 › 페이지 체류.
//   집계는 DB operator_page_engagement 한 곳(체류 화면과 같은 값).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfCard, PfCardHead, PfCardBody, PfBadge, PfEmpty, PfSkeleton } from "./pf/ui";
import { pageName, fmtSec } from "./page-names";

type Row = { path: string; views: number; visitors: number; median_sec: number; quick_exit_pct: number; leave_pct: number; avg_scroll: number | null };

export function EngagementCard({ i }: { i: number }) {
  const { data, isLoading } = useQuery<{ pages: Row[]; total_views: number }>({
    queryKey: ["op-page-engagement", "public", "7"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("operator_page_engagement", { p_days: 7, p_scope: "public" });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
  const pages = data?.pages || [];
  const total = pages.reduce((s, p) => s + p.views, 0);
  const quick = total ? Math.round(pages.reduce((s, p) => s + (p.quick_exit_pct * p.views) / 100, 0) / total * 100) : 0;
  const worst = [...pages].filter((p) => p.views >= 5).sort((a, b) => b.quick_exit_pct - a.quick_exit_pct)[0];

  return (
    <PfCard i={i} hover={false}>
      <PfCardHead title="페이지 체류" sub="최근 7일 · 공개 페이지 · 우리 팀 제외" href="/platform/engagement" action="자세히 →" />
      <PfCardBody>
        {isLoading ? <PfSkeleton rows={3} /> : pages.length === 0 ? (
          <PfEmpty>아직 체류가 기록된 방문이 없습니다. 방문이 쌓이면 어느 화면에서 금방 떠나는지 보입니다.</PfEmpty>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><div className="text-[11px] text-[var(--text-muted)]">체류가 기록된 방문</div><div className="text-lg font-extrabold mono-number">{(data?.total_views ?? 0).toLocaleString()}회</div></div>
              <div><div className="text-[11px] text-[var(--text-muted)]">5초 안에 나간 비율</div><div className="text-lg font-extrabold mono-number">{quick}%</div></div>
              <div><div className="text-[11px] text-[var(--text-muted)]">가장 빨리 떠나는 화면</div><div className="text-sm font-bold mt-1 truncate" title={worst?.path}>{worst ? `${pageName(worst.path)} · ${worst.quick_exit_pct}%` : "방문 5회 넘는 화면 없음"}</div></div>
            </div>
            <table className="pf-table">
              <thead><tr><th>화면</th><th className="text-right">방문자</th><th className="text-right">머문 시간(중간)</th><th className="text-right">5초 안에 나감</th><th className="text-right">여기서 떠남</th></tr></thead>
              <tbody>
                {pages.slice(0, 5).map((p) => (
                  <tr key={p.path}>
                    <td>{pageName(p.path)}</td>
                    <td className="text-right mono-number">{p.visitors.toLocaleString()}</td>
                    <td className="text-right mono-number">{fmtSec(p.median_sec)}</td>
                    <td className="text-right">{p.views >= 3 && p.quick_exit_pct >= 50 ? <PfBadge tone="warn">{p.quick_exit_pct}%</PfBadge> : <span className="mono-number">{p.quick_exit_pct}%</span>}</td>
                    <td className="text-right mono-number">{p.leave_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages.length > 5 && <div className="text-[11px] text-[var(--text-dim)] mt-2"><Link href="/platform/engagement" className="underline">외 {pages.length - 5}개 화면 · 떠날 때 어디까지 봤는지 보기</Link></div>}
          </>
        )}
      </PfCardBody>
    </PfCard>
  );
}
