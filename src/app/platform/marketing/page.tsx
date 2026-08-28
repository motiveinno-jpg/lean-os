"use client";

// 마케팅 지표 — 퍼널 실시간 시각화 (2026-08-13 사장님: "GA4 이벤트를 운영자페이지에서 편하게").
//   데이터: marketing_events (track() 이 GA4와 병행 적재, /api/track). RLS: 운영자만 SELECT.
//   GA4 리포트는 최대 하루 지연 — 여긴 실시간. 정밀 분석(체류·경로·기기)은 GA4에서.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";

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

  // 두 막대(방문·계산기)가 같은 축을 쓰므로 기준값도 둘 다 봐야 한다 (2026-08-20 사장님:
  //   "그래프가 하늘을 뚫고 넘어간다"). 방문 0 · 계산기 5 인 날 기준값이 1 이 돼 막대가
  //   500%(480px)로 카드 밖까지 솟았다.
  const maxDaily = Math.max(1, ...view.daily.map(([, v]) => Math.max(v.pv, v.tool)));
  const barPct = (n: number) => Math.min(100, Math.max(0, (n / maxDaily) * 100));

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-extrabold text-[var(--text)]">마케팅 지표</h1>
        <div className="mkt-range-toggle">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`mkt-range-btn ${days === d ? "mkt-range-on" : ""}`}>
              최근 {d}일
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">집계 중...</div>
      ) : error ? (
        <div className="glass-card p-8 text-center text-sm text-[var(--danger)]">조회 실패: {String((error as any)?.message || error)}</div>
      ) : (
        <>
          {/* 퍼널 — 단계별 수 + 이전 단계 대비 전환율 */}
          <div className="mkt-funnel-grid">
            {FUNNEL.map((s, i) => {
              const n = view.counts[s.key] || 0;
              const prev = i > 0 ? view.counts[FUNNEL[i - 1].key] || 0 : 0;
              const rate = i > 0 && prev > 0 ? Math.round((n / prev) * 1000) / 10 : null;
              return (
                <div key={s.key} className="mkt-funnel-card glass-card">
                  <div className="mkt-funnel-label">{s.label}</div>
                  <div className="mkt-funnel-value mono-number">{n.toLocaleString()}</div>
                  <div className="mkt-funnel-hint">{s.hint}</div>
                  {rate !== null && <div className="mkt-funnel-rate">이전 단계의 {rate}%</div>}
                </div>
              );
            })}
          </div>

          {/* 일별 추이 — 방문(막대) 위에 계산기 사용(진한 막대) */}
          <div className="mkt-section glass-card">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="text-sm font-bold">일별 추이</h3>
              <span className="text-[11px] text-[var(--text-dim)]">
                <span className="mkt-legend mkt-legend-pv" /> 방문 <span className="mkt-legend mkt-legend-tool" /> 계산기 사용 · KST 기준
              </span>
            </div>
            <div className="mkt-trend-row">
              {view.daily.map(([day, v]) => (
                <div key={day} className="mkt-trend-col" title={`${day} · 방문 ${v.pv} · 계산기 ${v.tool}`}>
                  <div className="mkt-trend-bars">
                    <div className="mkt-trend-bar-pv" style={{ height: `${barPct(v.pv)}%` }} />
                    <div className="mkt-trend-bar-tool" style={{ height: `${barPct(v.tool)}%` }} />
                  </div>
                  <div className="mkt-trend-day">{day.slice(8)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mkt-two-col">
            {/* 도구별 사용 */}
            <div className="mkt-section glass-card">
              <h3 className="text-sm font-bold mb-3">무료 도구별 사용</h3>
              {view.tools.length === 0 ? (
                <div className="mkt-empty">아직 기록이 없습니다</div>
              ) : (
                view.tools.map(([tool, n]) => (
                  <div key={tool} className="mkt-bar-row">
                    <span className="mkt-bar-name">{TOOL_KO[tool] || tool}</span>
                    <div className="mkt-bar-track"><div className="mkt-bar-fill" style={{ width: `${(n / view.tools[0][1]) * 100}%` }} /></div>
                    <span className="mkt-bar-n mono-number">{n.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>

            {/* 유입 출처 */}
            <div className="mkt-section glass-card">
              <h3 className="text-sm font-bold mb-3">유입 출처 (외부)</h3>
              {view.refs.length === 0 ? (
                <div className="mkt-empty">외부 유입 기록이 없습니다 — 직접 접속·앱 내 이동뿐</div>
              ) : (
                view.refs.map(([host, n]) => (
                  <div key={host} className="mkt-bar-row">
                    <span className="mkt-bar-name">{host}</span>
                    <div className="mkt-bar-track"><div className="mkt-bar-fill" style={{ width: `${(n / view.refs[0][1]) * 100}%` }} /></div>
                    <span className="mkt-bar-n mono-number">{n.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 인기 페이지 */}
          <div className="mkt-section glass-card">
            <h3 className="text-sm font-bold mb-3">많이 본 공개 페이지</h3>
            {view.paths.length === 0 ? (
              <div className="mkt-empty">아직 기록이 없습니다</div>
            ) : (
              view.paths.map(([path, n]) => (
                <div key={path} className="mkt-bar-row">
                  <span className="mkt-bar-name">{path}</span>
                  <div className="mkt-bar-track"><div className="mkt-bar-fill" style={{ width: `${(n / view.paths[0][1]) * 100}%` }} /></div>
                  <span className="mkt-bar-n mono-number">{n.toLocaleString()}</span>
                </div>
              ))
            )}
          </div>

          <p className="mkt-footnote">
            수집 시작: 2026-08-13 (이전 데이터 없음) · GA4(G-18MBLDNEQD)에도 같은 이벤트가 쌓입니다 — 체류시간·기기·지역 등 정밀 분석은 GA4 보고서에서.
          </p>
        </>
      )}
    </div>
  );
}
