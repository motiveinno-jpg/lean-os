"use client";

// 마케팅 지표 — 퍼널 실시간 시각화 (2026-08-13 사장님: "GA4 이벤트를 운영자페이지에서 편하게").
//   데이터: marketing_events (track() 이 GA4와 병행 적재, /api/track). RLS: 운영자만 SELECT.
//   GA4 리포트는 최대 하루 지연 — 여긴 실시간. 정밀 분석(체류·경로·기기)은 GA4에서.
//   2026-09-03 v2 디자인 — 조회·집계는 그대로, 표시를 pf 부품 + Bklit 차트로.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfSeg, PfSkeleton, PfEmpty, PfBadge } from "../_components/pf/ui";
import { PfTrend, PfBars, PfFunnel } from "../_components/pf/charts";

type Ev = { event: string; params: any; path: string | null; referrer: string | null; created_at: string };

const FUNNEL: { key: string; label: string; hint: string }[] = [
  { key: "page_view", label: "방문", hint: "공개 페이지 조회" },
  { key: "tool_calculate", label: "계산기 사용", hint: "무료 도구에서 결과 봄" },
  { key: "sign_up", label: "가입", hint: "회원가입 접수" },
  { key: "bank_connect", label: "계좌 연결", hint: "첫 데이터 연동 (북극성)" },
  { key: "checkout_start", label: "결제 시작", hint: "업그레이드 결제 진입" },
];
const TOOL_KO: Record<string, string> = { leave: "연차 계산기", severance: "퇴직금 계산기", insurance: "4대보험 계산기", salary: "실수령액 계산기" };

const kstDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const hostOf = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

export default function PlatformMarketingPage() {
  const [days, setDays] = useState<7 | 30>(7);

  const { data: events = [], isLoading, error } = useQuery<Ev[]>({
    queryKey: ["platform-marketing-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      // marketing_events 는 생성 타입에 아직 없다(다른 세션과의 database.ts 충돌 방지 — 재생성은 다음 라운드에)
      const data = await fetchPaged<any>("platform/marketing:events", () => (supabase as any)
        .from("marketing_events")
        .select("event, params, path, referrer, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false }), 100000);
      return (data || []) as Ev[];
    },
    staleTime: 60_000,
  });

  const view = useMemo(() => {
    const since = Date.now() - days * 86400000;
    const inRange = events.filter((e) => new Date(e.created_at).getTime() >= since);

    const counts: Record<string, number> = {};
    for (const e of inRange) counts[e.event] = (counts[e.event] || 0) + 1;

    // 일별 추이 (방문·계산기) — 최근 N일 빈 날 포함
    const byDay = new Map<string, { pv: number; tool: number }>();
    for (let i = days - 1; i >= 0; i--) {
      byDay.set(new Date(Date.now() + 9 * 3600000 - i * 86400000).toISOString().slice(0, 10), { pv: 0, tool: 0 });
    }
    for (const e of inRange) {
      const d = byDay.get(kstDay(e.created_at));
      if (!d) continue;
      if (e.event === "page_view") d.pv++;
      else if (e.event === "tool_calculate") d.tool++;
    }

    // 도구별
    const byTool: Record<string, number> = {};
    for (const e of inRange) if (e.event === "tool_calculate") {
      const t = String(e.params?.tool || "기타");
      byTool[t] = (byTool[t] || 0) + 1;
    }

    // 유입 출처 (자기 도메인 제외)
    const byRef: Record<string, number> = {};
    for (const e of inRange) if (e.event === "page_view") {
      const h = hostOf(e.referrer);
      if (!h || h.endsWith("owner-view.com")) continue;
      byRef[h] = (byRef[h] || 0) + 1;
    }

    // 인기 페이지
    const byPath: Record<string, number> = {};
    for (const e of inRange) if (e.event === "page_view" && e.path) byPath[e.path] = (byPath[e.path] || 0) + 1;

    return {
      counts,
      daily: [...byDay.entries()],
      tools: Object.entries(byTool).sort((a, b) => b[1] - a[1]),
      refs: Object.entries(byRef).sort((a, b) => b[1] - a[1]).slice(0, 8),
      paths: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [events, days]);

  // 차트용 형태 — 일별 추이(한 축에 방문·계산기), 순위 막대(가로)
  const trendData = view.daily.map(([day, v]) => ({ date: new Date(`${day}T00:00:00+09:00`), 방문: v.pv, 계산기: v.tool }));
  const toolBars = view.tools.map(([tool, n]) => ({ name: TOOL_KO[tool] || tool, 사용: n }));
  const refBars = view.refs.map(([host, n]) => ({ name: host, 방문: n }));
  const pathBars = view.paths.map(([path, n]) => ({ name: path, 조회: n }));
  const funnelStages = FUNNEL.map((s) => ({ label: s.label, value: view.counts[s.key] || 0 }));
  const funnelHasData = funnelStages.some((s) => s.value > 0);

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="마케팅 지표"
        desc="사이트 방문부터 가입·계좌 연결·결제까지, 사람들이 어디까지 오고 어디서 빠지는지를 실시간으로 봅니다."
        actions={<PfSeg value={String(days) as "7" | "30"} onChange={(v) => setDays(Number(v) as 7 | 30)} options={[{ value: "7", label: "최근 7일" }, { value: "30", label: "최근 30일" }]} />}
      />

      {isLoading ? (
        <PfCard i={1} pad><PfSkeleton rows={4} h={18} /></PfCard>
      ) : error ? (
        <PfCard i={1} pad><div className="text-sm text-[var(--danger)]">조회 실패: {String((error as any)?.message || error)}</div></PfCard>
      ) : (
        <>
          {/* 퍼널 단계 KPI — 단계별 수 + 이전 단계 대비 전환율 */}
          <div className="pf-kpi-grid">
            {FUNNEL.map((s, i) => {
              const n = view.counts[s.key] || 0;
              const prev = i > 0 ? view.counts[FUNNEL[i - 1].key] || 0 : 0;
              const rate = i > 0 && prev > 0 ? Math.round((n / prev) * 1000) / 10 : null;
              return (
                <PfCard key={s.key} i={i + 1} className="pf-kpi-tile">
                  <PfKpi label={s.label} value={n} unit="건" accent={i === 0} />
                  <div className="text-[10.5px] text-[var(--text-dim)] mt-1.5">{s.hint}</div>
                  {rate !== null && <div className="mt-1.5"><PfBadge tone={rate >= 10 ? "ok" : rate > 0 ? "warn" : "muted"}>이전 단계의 {rate}%</PfBadge></div>}
                </PfCard>
              );
            })}
          </div>

          {/* 퍼널 그림 + 일별 추이 */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <PfCard i={6} className="lg:col-span-2">
              <PfCardHead title="유입 퍼널" sub="첫 단계(방문) 대비 각 단계에 도달한 비율" />
              <PfCardBody>
                {funnelHasData ? <PfFunnel stages={funnelStages} vertical height={260} /> : <PfEmpty>아직 기록이 없습니다</PfEmpty>}
              </PfCardBody>
            </PfCard>
            <PfCard i={7} className="lg:col-span-3">
              <PfCardHead title="일별 추이" sub="방문과 계산기 사용 · 한국 시간 기준 · 그래프 위에 마우스를 올리면 그날 숫자가 보입니다" />
              <PfCardBody>
                <PfTrend
                  data={trendData}
                  height={240}
                  revealKey={String(days)}
                  series={[{ key: "방문", label: "방문" }, { key: "계산기", label: "계산기 사용" }]}
                  dateLabel={(d) => `${d.getMonth() + 1}/${d.getDate()}`}
                  empty="아직 기록이 없습니다"
                />
              </PfCardBody>
            </PfCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 도구별 사용 */}
            <PfCard i={8}>
              <PfCardHead title="무료 도구별 사용" sub="어떤 계산기를 많이 쓰는지" />
              <PfCardBody>
                {toolBars.length === 0 ? <PfEmpty>아직 기록이 없습니다</PfEmpty> : (
                  <PfBars data={toolBars} horizontal height={Math.max(140, toolBars.length * 36)} series={[{ key: "사용", label: "사용" }]} revealKey={String(days)} />
                )}
              </PfCardBody>
            </PfCard>

            {/* 유입 출처 */}
            <PfCard i={9}>
              <PfCardHead title="유입 출처 (외부)" sub="어느 사이트를 거쳐 들어왔는지 · 직접 접속·앱 내 이동은 제외" />
              <PfCardBody>
                {refBars.length === 0 ? <PfEmpty>외부 유입 기록이 없습니다 — 직접 접속·앱 내 이동뿐</PfEmpty> : (
                  <PfBars data={refBars} horizontal height={Math.max(140, refBars.length * 36)} series={[{ key: "방문", label: "방문" }]} revealKey={String(days)} />
                )}
              </PfCardBody>
            </PfCard>
          </div>

          {/* 인기 페이지 */}
          <PfCard i={10}>
            <PfCardHead title="많이 본 공개 페이지" sub="로그인 없이 볼 수 있는 페이지 중 조회수 상위 8개" />
            <PfCardBody>
              {pathBars.length === 0 ? <PfEmpty>아직 기록이 없습니다</PfEmpty> : (
                <PfBars data={pathBars} horizontal height={Math.max(160, pathBars.length * 36)} series={[{ key: "조회", label: "조회" }]} revealKey={String(days)} />
              )}
            </PfCardBody>
          </PfCard>

          <p className="text-[11px] text-[var(--text-dim)] px-1">
            수집 시작: 2026-08-13 (이전 데이터 없음) · GA4(G-18MBLDNEQD)에도 같은 이벤트가 쌓입니다 — 체류시간·기기·지역 등 정밀 분석은 GA4 보고서에서.
          </p>
        </>
      )}
    </PfPage>
  );
}
