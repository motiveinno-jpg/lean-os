"use client";

// 운영자 › 페이지 체류 (2026-09-28) — 어느 화면에서 몇 초 머물다, 어디까지 내려 보고, 어디로 갔는지·떠났는지.
//   보완할 화면을 찾는 용도: 방문은 많은데 금방 떠나는 곳, 끝까지 안 내려 보고 나가는 곳.
//   원자료는 page_views 의 체류 칸(page_view_end 가 채움) — 집계는 DB 함수 operator_page_engagement 한 곳.
//   내부(우리 팀) 방문은 빼고, 머문 시간이 기록된 방문(체류 수집 시작 이후)만 센다.

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { pageName, fmtSec } from "../_components/page-names";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfSeg, PfSkeleton, PfEmpty, PfBadge } from "../_components/pf/ui";

type Page = {
  path: string; views: number; visitors: number; median_sec: number; p75_sec: number;
  quick_exit_pct: number; leave_pct: number; avg_scroll: number | null;
  leave_scroll: Record<"0-25" | "25-50" | "50-75" | "75-100", number>;
  next_top: { path: string; n: number }[];
};
type Result = { since: string; scope: string; tracked_since: string | null; total_views: number; pages: Page[] };

const sec = fmtSec;

const BUCKETS = ["0-25", "25-50", "50-75", "75-100"] as const;
const BUCKET_LABEL: Record<(typeof BUCKETS)[number], string> = { "0-25": "위 ¼", "25-50": "¼~½", "50-75": "½~¾", "75-100": "끝까지" };

export default function EngagementPage() {
  const [scope, setScope] = useState<"public" | "app">("public");
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<Result>({
    queryKey: ["op-page-engagement", scope, days],
    queryFn: async () => {
      //   생성 타입에 아직 없는 RPC(마이그 20260928270000)
      const { data, error } = await (supabase.rpc as any)("operator_page_engagement", { p_days: Number(days), p_scope: scope });
      if (error) throw error;
      return data as Result;
    },
  });
  const pages = data?.pages || [];
  const top = pages.slice(0, 40);
  const worst = [...pages].filter((p) => p.views >= 5).sort((a, b) => b.quick_exit_pct - a.quick_exit_pct)[0];

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="페이지 체류"
        desc="어느 화면에서 몇 초 머물고, 어디까지 내려 보다 떠나는지 봅니다. 방문은 많은데 금방 떠나거나 위쪽만 보고 나가는 화면이 먼저 손볼 곳입니다. 우리 팀 방문은 빼고 셉니다."
        actions={<>
          <PfSeg value={scope} onChange={(v) => { setScope(v); setOpen(null); }} options={[{ value: "public", label: "공개 페이지(방문자)" }, { value: "app", label: "앱 화면(로그인 사용자)" }]} />
          <PfSeg value={days} onChange={setDays} options={[{ value: "7", label: "7일" }, { value: "30", label: "30일" }, { value: "90", label: "90일" }]} />
        </>}
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="체류가 기록된 방문" value={data?.total_views ?? 0} unit="회" /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="살펴본 화면 수" value={pages.length} unit="곳" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile">
          <div className="text-xs text-[var(--text-muted)]">가장 빨리 떠나는 화면 (방문 5회 이상)</div>
          <div className="text-sm font-bold mt-2">{worst ? pageName(worst.path) : "—"}</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1">{worst ? `${worst.quick_exit_pct}%가 5초 안에 나감 · 중간 ${sec(worst.median_sec)}` : "아직 자료가 적습니다"}</div>
        </PfCard>
      </div>

      <PfCard i={4} hover={false}>
        <PfCardHead title="화면별 체류" sub={`방문 많은 순 · 머문 시간은 화면이 보이던 시간만(다른 탭에 가 있던 시간 제외)${data?.tracked_since ? ` · ${new Date(data.tracked_since).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}부터 수집` : ""}`} />
        <PfCardBody>
          {isLoading ? <PfSkeleton rows={4} /> : error ? <PfEmpty>불러오지 못했습니다.</PfEmpty> : top.length === 0 ? (
            <PfEmpty>아직 체류가 기록된 방문이 없습니다. 오늘부터 쌓입니다.</PfEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>화면</th><th className="text-right">방문</th><th className="text-right">방문자</th>
                    <th className="text-right">머문 시간(중간)</th><th className="text-right">5초 안에 나감</th>
                    <th className="text-right">여기서 사이트를 떠남</th><th>떠날 때 어디까지 봤나</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((p) => {
                    const leaveTotal = BUCKETS.reduce((s, b) => s + (p.leave_scroll?.[b] || 0), 0);
                    const isOpen = open === p.path;
                    return (
                      <Fragment key={p.path}>
                        <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : p.path)} title="눌러서 다음으로 간 화면 보기">
                          <td>
                            <div className="font-semibold">{pageName(p.path)}</div>
                            <div className="text-[11px] text-[var(--text-dim)] font-mono">{p.path}</div>
                          </td>
                          <td className="text-right mono-number">{p.views.toLocaleString()}</td>
                          <td className="text-right mono-number">{p.visitors.toLocaleString()}</td>
                          <td className="text-right mono-number">{sec(p.median_sec)}</td>
                          <td className="text-right">{p.views >= 3 && p.quick_exit_pct >= 50 ? <PfBadge tone="warn">{p.quick_exit_pct}%</PfBadge> : <span className="mono-number">{p.quick_exit_pct}%</span>}</td>
                          <td className="text-right mono-number">{p.leave_pct}%</td>
                          <td className="min-w-[220px]">
                            {leaveTotal === 0 ? <span className="text-[var(--text-dim)] text-xs">—</span> : (
                              <div className="flex items-center gap-1" title={BUCKETS.map((b) => `${BUCKET_LABEL[b]} ${p.leave_scroll[b]}명`).join(" · ")}>
                                {BUCKETS.map((b) => {
                                  const n = p.leave_scroll?.[b] || 0;
                                  const pct = Math.round((n / leaveTotal) * 100);
                                  return (
                                    <div key={b} className="flex-1 text-center">
                                      <div className="h-2 rounded-sm bg-[var(--border)] overflow-hidden">
                                        <div className="h-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                                      </div>
                                      <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{BUCKET_LABEL[b]} {pct}%</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="text-xs text-[var(--text-muted)]">
                              다음으로 많이 간 화면: {p.next_top.length === 0 ? "없음(대부분 여기서 떠남)" : p.next_top.map((n) => `${pageName(n.path)} ${n.n}회`).join(" · ")}
                              {" · "}머문 시간 상위 25%는 {sec(p.p75_sec)} 이상 · 평균 스크롤 {p.avg_scroll ?? 0}%
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-dim)] mt-3">
            &lsquo;떠날 때 어디까지 봤나&rsquo;는 이 화면에서 사이트를 떠난 사람들이 떠나기 전 가장 아래까지 내려 본 위치입니다.
            &lsquo;위 ¼&rsquo;이 크면 첫 화면만 보고 나간 것 — 윗부분 문구·이미지를 먼저 손봅니다.
          </p>
        </PfCardBody>
      </PfCard>
    </PfPage>
  );
}
