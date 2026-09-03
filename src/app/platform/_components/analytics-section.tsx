"use client";

// 성장 분석 섹션 (2026-07-29 리디자인 · 2026-09-03 v2: Bklit 차트 + pf 부품) — 기존 "트래픽·이용 현황" 을 대체.
//   일/월/년 단위로 방문자·페이지뷰·신규 가입자·신규 회사·체험 시작을 한 화면에서.
//   데이터는 platform_analytics RPC(운영자 게이트 내장, 빈 버킷 0 채움) 하나로 받는다.
//
// 차트 설계 원칙(dataviz):
//   - 단일 시리즈만 그린다 — 지표 타일을 클릭해 바꾸는 방식. 이중축 금지.
//   - 색은 검증된 팔레트 1번(--chart-1) 한 색(순차적 역할). 텍스트는 텍스트 토큰만 쓴다.
//   - 막대는 4px 라운드·간격 유지, 그리드는 배경색으로 물러나게. 호버 툴팁 + 하단 표(테이블 뷰) 병행.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { countPlanKinds } from "./plan-kind";
import { PfCard, PfCardHead, PfCardBody, PfSeg, PfBar, PfEmpty, PfSkeleton } from "./pf/ui";
import { PfBars, PfDonut } from "./pf/charts";

type Bucket = {
  start: string;      // 'YYYY-MM-DD' (버킷 시작, KST)
  visitors: number; views: number; guests: number;
  internal?: number;  // 이 버킷에서 제외된 내부 방문자 (2026-08-25)
  accounts: number; companies: number; trials: number;
};
type Analytics = { as_of: string; granularity: string; scope?: Scope; page_views_since: string | null; buckets: Bucket[] };

type Gran = "day" | "month" | "year";
const GRANS: { key: Gran; label: string; buckets: number }[] = [
  { key: "day", label: "일간", buckets: 30 },
  { key: "month", label: "월간", buckets: 12 },
  { key: "year", label: "연간", buckets: 3 },
];

// 집계 범위 (2026-08-25 사장님 지적으로 신설 — "이 25명 다 우리가 테스트한 것 아니냐").
//   visitor_key 가 localStorage 난수라 우리 팀이 시크릿 창을 열 때마다 새 방문자가 됐다.
//   '검색 유입' 은 검색엔진 리퍼러가 찍힌 방문자 — 우리가 만들어낼 수 없는 기록이라
//   신뢰할 수 있는 하한선으로 쓴다.
type Scope = "all" | "external" | "search";
const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: "external", label: "외부", hint: "우리 팀 방문을 뺀 숫자입니다. 평소에는 이 값을 보세요." },
  { key: "search", label: "검색 유입", hint: "검색엔진을 타고 들어온 방문자만. 가장 확실한 숫자입니다." },
  { key: "all", label: "전체", hint: "우리 팀 방문까지 포함한 원래 숫자입니다." },
];

type MetricKey = "visitors" | "views" | "guests" | "accounts" | "companies" | "trials";
const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  // 범위 토글에 '전체' 가 생겨서(2026-08-25) 라벨의 "(전체)" 가 그 뜻으로 읽힌다 — 표현만 정리.
  { key: "visitors", label: "방문자", unit: "명" },
  { key: "guests", label: "비로그인 방문자", unit: "명" },
  { key: "views", label: "페이지뷰", unit: "회" },
  { key: "accounts", label: "신규 가입자", unit: "명" },
  { key: "companies", label: "신규 회사", unit: "곳" },
  { key: "trials", label: "체험 시작", unit: "건" },
];

const fmt = (n: number) => n.toLocaleString("ko-KR");

// ── 경로 → 한국어 페이지명 (2026-08-04 사장님: 현황판에서 주소 대신 이름으로) ──
const PATH_LABELS: Record<string, string> = {
  "": "랜딩페이지",
  dashboard: "대시보드",
  projecthub: "프로젝트허브",
  approvals: "결재",
  signatures: "전자서명",
  sign: "서명하기",
  documents: "문서함",
  vault: "보관함",
  auth: "로그인",
  "auth/verify": "이메일 인증",
  "auth/reset": "비밀번호 재설정",
  notifications: "알림",
  board: "게시판",
  announcements: "공지사항",
  employees: "직원 관리",
  attendance: "근태",
  schedule: "일정",
  leave: "연차",
  "hr-templates": "인사 서식",
  "my-contracts": "내 계약",
  contracts: "계약",
  team: "팀",
  mypage: "마이페이지",
  chat: "채팅",
  copilot: "AI 참모",
  bank: "통장",
  transactions: "거래내역",
  cards: "카드",
  loans: "대출",
  "tax-invoices": "세금계산서",
  "cash-receipts": "현금영수증",
  reports: "리포트",
  partners: "파트너",
  deals: "영업 딜",
  matching: "매칭",
  billing: "구독 관리",
  payments: "결제",
  subscriptions: "구독",
  settings: "설정",
  onboarding: "온보딩",
  "company-setup": "회사 등록",
  invite: "초대",
  "join-pending": "가입 대기",
  support: "고객센터",
  guide: "이용 가이드",
  pricing: "요금제",
  features: "기능 소개",
  ai: "AI 소개",
  demo: "데모",
  quote: "견적",
  share: "공유 문서",
  portal: "포털",
  platform: "운영자 대시보드",
  "operator-users": "운영자 회원관리",
  "error-logs": "에러 로그",
  terms: "이용약관",
  privacy: "개인정보처리방침",
  refund: "환불정책",
  status: "상태 페이지",
  maintenance: "점검",
};
/** "/projecthub/uuid/" → "프로젝트허브 · 상세" 처럼 사람이 읽는 이름으로. 모르는 경로는 원문 유지. */
function pageLabel(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "").split("?")[0];
  if (clean in PATH_LABELS) return PATH_LABELS[clean];
  const segs = clean.split("/");
  const root = PATH_LABELS[segs[0]];
  if (root) return segs.length > 1 ? `${root} · 상세` : root;
  return path;
}

function bucketLabel(start: string, gran: Gran, long = false): string {
  const [y, m, d] = start.split("-");
  if (gran === "year") return `${y}년`;
  if (gran === "month") return long ? `${y}년 ${Number(m)}월` : `${Number(m)}월`;
  return long ? `${Number(m)}월 ${Number(d)}일` : `${m}.${d}`;
}

/** 가로 막대 목록 — 값이 큰 순서, 등장 시 왼쪽에서 자란다. */
function HBarList({ rows, unit = "" }: { rows: { label: string; v: number; title?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="space-y-2">
      {rows.map((x) => (
        <div key={x.label} className="grid grid-cols-[minmax(0,1fr)_88px_52px] items-center gap-2 text-[12px]" title={x.title}>
          <span className="truncate text-[var(--text-muted)]">{x.label}</span>
          <PfBar pct={(x.v / max) * 100} />
          <span className="text-right font-bold mono-number text-[var(--text)]">{fmt(x.v)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsSection({ usage, traffic, companies, companyActivity, testData }: {
  // page.tsx 의 기존 쿼리를 그대로 받는다 — 활동 사용자·인기 페이지·유입 경로 표시용.
  usage: { accounts: { dau: number; wau: number; mau: number; active_90d?: number; active_365d?: number; active_1095d?: number; never_signed_in: number; total: number } } | null;
  traffic: {
    top_paths: { path: string; views: number }[];
    top_referrers: { host: string; visitors: number }[];
    breakdown?: {
      internal_visitors: number; external_visitors: number; search_visitors: number;
      raw_views: number; deduped_views: number;
    };
  } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companies: any[];
  // 이용 형태 기간 연동용 — 회사별 마지막 활동 (platform_company_activity)
  companyActivity?: { company_id: string; last_activity: string | null }[];
  /** 시각 검증·테스트용 — 주면 RPC 를 부르지 않고 이 데이터로 렌더한다. */
  testData?: Analytics;
}) {
  // 사이드 카드(활동 사용자·이용 형태·많이 본 페이지·유입) 기간 창 — 상단 일간/월간/연간 토글과
  // 같은 범위를 본다 (2026-08-20 사장님: 토글 눌렀을 때 사이드도 맞게 적용).
  const SIDE_WINDOW_DAYS: Record<Gran, number> = { day: 30, month: 365, year: 1095 };
  const SIDE_WINDOW_LABEL: Record<Gran, string> = { day: "최근 30일", month: "최근 12개월", year: "최근 3년" };
  // 많이 본 페이지·유입 경로는 말 그대로 일간=오늘 / 월간=한 달 / 연간=1년 (2026-08-20 사장님 정정)
  const TRAFFIC_WINDOW_DAYS: Record<Gran, number> = { day: 1, month: 30, year: 365 };
  const TRAFFIC_WINDOW_LABEL: Record<Gran, string> = { day: "오늘", month: "최근 30일", year: "최근 1년" };
  const [gran, setGran] = useState<Gran>("day");
  const [scope, setScope] = useState<Scope>("external");
  const [metric, setMetric] = useState<MetricKey>("visitors");

  const { data, isLoading } = useQuery<Analytics | null>({
    queryKey: ["p-analytics", gran, scope],
    initialData: testData ?? undefined,
    enabled: !testData,
    queryFn: async () => {
      const cfg = GRANS.find((g) => g.key === gran)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: d, error } = await (supabase as any).rpc("platform_analytics", {
        p_granularity: gran, p_buckets: cfg.buckets, p_scope: scope,
      });
      if (error) return null;
      return d as Analytics;
    },
    refetchInterval: 60_000,
  });

  const buckets = useMemo(() => data?.buckets ?? [], [data]);
  // 많이 본 페이지·유입 — 토글 기간 창으로 재조회 (page.tsx 의 traffic 은 14일 고정이라 폴백으로만)
  const { data: granTraffic } = useQuery({
    queryKey: ["p-traffic-side", gran, scope],
    enabled: !testData,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: d, error } = await (supabase as any).rpc("platform_traffic_stats", {
        p_days: TRAFFIC_WINDOW_DAYS[gran], p_scope: scope,
      });
      if (error) return null;
      return d as NonNullable<typeof traffic>;
    },
  });
  const sideTraffic = granTraffic ?? traffic;

  // 이용 형태 — 기간 창 안에 활동한 가입사 기준 (활동 데이터가 없으면 전체 스냅샷 유지)
  const kinds = useMemo(() => {
    const winMs = SIDE_WINDOW_DAYS[gran] * 86400000;
    const nowMs = Date.now();
    if (!companyActivity || companyActivity.length === 0) return countPlanKinds(companies);
    const act = new Map(companyActivity.map((x) => [x.company_id, x.last_activity]));
    const scoped = companies.filter((c: { id: string }) => {
      const la = act.get(c.id);
      return la && nowMs - new Date(la).getTime() <= winMs;
    });
    return countPlanKinds(scoped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, companyActivity, gran]);

  // 타일 수치: 현재 버킷(오늘/이번 달/올해) + 직전 버킷 대비 증감
  const tiles = METRICS.map((m) => {
    const cur = buckets.length ? buckets[buckets.length - 1][m.key] : 0;
    const prev = buckets.length > 1 ? buckets[buckets.length - 2][m.key] : 0;
    const total = buckets.reduce((s, b) => s + b[m.key], 0);
    return { ...m, cur, prev, total, delta: cur - prev };
  });

  const n = Math.max(1, buckets.length);
  const metricMeta = METRICS.find((m) => m.key === metric)!;
  const curLabel = gran === "day" ? "오늘" : gran === "month" ? "이번 달" : "올해";
  const prevLabel = gran === "day" ? "어제" : gran === "month" ? "지난달" : "작년";
  const allZero = buckets.every((b) => b[metric] === 0);
  // 차트 데이터 — 막대 x축은 짧은 라벨, 툴팁은 긴 라벨(별도 키)
  const chartRows = useMemo(() => buckets.map((b) => ({ name: bucketLabel(b.start, gran), long: bucketLabel(b.start, gran, true), value: b[metric] })), [buckets, gran, metric]);

  const acc = usage?.accounts;
  // 토글 기간에 맞춘 창 — 일간: 오늘/주간/월간, 월간: 월간/분기/연간, 연간: 연간/3년/전체 활동
  const activeRows = gran === "day"
    ? [{ label: "오늘", v: acc?.dau ?? 0 }, { label: "주간", v: acc?.wau ?? 0 }, { label: "월간", v: acc?.mau ?? 0 }]
    : gran === "month"
    ? [{ label: "월간", v: acc?.mau ?? 0 }, { label: "분기", v: acc?.active_90d ?? 0 }, { label: "연간", v: acc?.active_365d ?? 0 }]
    : [{ label: "연간", v: acc?.active_365d ?? 0 }, { label: "3년", v: acc?.active_1095d ?? 0 }, { label: "전체 활동", v: Math.max(0, (acc?.total ?? 0) - (acc?.never_signed_in ?? 0)) }];

  return (
    <section className="space-y-4">
      {/* 헤더: 제목 + 집계 범위 + 기간 전환 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-[var(--text)]">성장 분석</h2>
          <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
            방문자·페이지뷰는 {data?.page_views_since ? new Date(data.page_views_since).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "2026-07-28"}부터 수집 · 가입 지표는 전 기간
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {SCOPES.find((s) => s.key === scope)!.hint}
            {sideTraffic?.breakdown && (
              <span className="text-[var(--text-dim)]">
                {" "}· 내부 {sideTraffic.breakdown.internal_visitors}명 제외 · 중복 뷰{" "}
                {sideTraffic.breakdown.raw_views - sideTraffic.breakdown.deduped_views}회 접음
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PfSeg value={scope} onChange={setScope} options={SCOPES.map((s) => ({ value: s.key, label: s.label }))} />
          <PfSeg value={gran} onChange={setGran} options={GRANS.map((g) => ({ value: g.key, label: g.label }))} />
        </div>
      </div>

      {/* 지표 타일 — 클릭하면 차트가 그 지표로 바뀐다 */}
      <div className="pf-kpi-grid">
        {tiles.map((t, i) => {
          const on = metric === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setMetric(t.key)}
              className={`pf-card pf-card-hover pf-in p-4 text-left ${on ? "ring-2 ring-[var(--primary)]/60" : ""}`} style={{ ["--pf-i" as string]: i }}>
              <span className="pf-kpi-label">{t.label}</span>
              <div className={`pf-kpi-value mono-number mt-1 ${on ? "pf-kpi-accent" : ""}`}>{fmt(t.cur)}<span className="text-[12px] font-semibold text-[var(--text-dim)] ml-0.5">{t.unit}</span></div>
              <div className="mt-1.5">
                {t.prev > 0 || t.cur > 0 ? (
                  <span className={`pf-kpi-delta ${t.delta > 0 ? "pf-kpi-delta-up" : t.delta < 0 ? "pf-kpi-delta-down" : "pf-kpi-delta-flat"}`}>
                    {t.delta > 0 ? "▲" : t.delta < 0 ? "▼" : "•"} {t.delta === 0 ? `${prevLabel} 동일` : `${fmt(Math.abs(t.delta))} (${prevLabel} ${fmt(t.prev)})`}
                  </span>
                ) : (
                  <span className="pf-kpi-delta pf-kpi-delta-flat">기간 내 없음</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
        {/* 왼쪽: 차트 + 기간별 상세 표 (표가 차트의 테이블 뷰를 겸한다) */}
        <div className="space-y-4 min-w-0">
          <PfCard i={0}>
            <PfCardHead
              title={<>{metricMeta.label} 추이 <span className="text-[10px] font-normal text-[var(--text-dim)]">최근 {n}{gran === "day" ? "일" : gran === "month" ? "개월" : "년"}</span></>}
              right={<span className="text-[11px] text-[var(--text-muted)]">{curLabel} <b className="mono-number text-[var(--text)]">{fmt(tiles.find((t) => t.key === metric)?.cur ?? 0)}</b>{metricMeta.unit}</span>}
            />
            <PfCardBody>
              {isLoading ? (
                <PfSkeleton h={200} />
              ) : allZero ? (
                <PfEmpty>
                  이 기간에는 {metricMeta.label} 기록이 없습니다.
                  {(metric === "visitors" || metric === "views" || metric === "guests") && <><br /><span className="text-[10px]">방문 수집은 2026-07-28에 시작됐습니다.</span></>}
                </PfEmpty>
              ) : (
                <PfBars data={chartRows} xKey="name" series={[{ key: "value", label: metricMeta.label, format: (v) => `${fmt(v)}${metricMeta.unit}` }]} height={240} revealKey={`${gran}-${scope}-${metric}`} />
              )}
            </PfCardBody>
          </PfCard>

          {/* 기간별 상세 표 — 차트의 테이블 뷰(접근성) 겸 정밀 수치 확인용 */}
          <PfCard i={1} hover={false}>
            <div className="pf-table-wrap max-h-[360px] overflow-y-auto">
              <table className="pf-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>기간</th>
                    <th className="text-right">방문자</th>
                    <th className="text-right">페이지뷰</th>
                    <th className="text-right">비로그인</th>
                    <th className="text-right">신규 가입자</th>
                    <th className="text-right">신규 회사</th>
                    <th className="text-right">체험 시작</th>
                  </tr>
                </thead>
                <tbody>
                  {[...buckets].reverse().map((b, ri) => (
                    <tr key={b.start} className={ri === 0 ? "bg-[var(--primary)]/5" : ""}>
                      <td className="whitespace-nowrap">{bucketLabel(b.start, gran, true)}{ri === 0 && <span className="pf-badge pf-badge-info ml-1.5">{curLabel}</span>}</td>
                      <td className="text-right mono-number">{fmt(b.visitors)}</td>
                      <td className="text-right mono-number">{fmt(b.views)}</td>
                      <td className="text-right mono-number">{fmt(b.guests)}</td>
                      <td className="text-right mono-number">{fmt(b.accounts)}</td>
                      <td className="text-right mono-number">{fmt(b.companies)}</td>
                      <td className="text-right mono-number">{fmt(b.trials)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PfCard>
        </div>

        {/* 사이드: 활동 사용자 · 이용 형태 · 인기 페이지 · 유입 */}
        <div className="space-y-4 min-w-0">
          <PfCard i={2}>
            <PfCardHead title="활동 사용자" sub={`미로그인 계정 ${fmt(usage?.accounts.never_signed_in ?? 0)} / 전체 ${fmt(usage?.accounts.total ?? 0)}`} />
            <PfCardBody><HBarList rows={activeRows} unit="명" /></PfCardBody>
          </PfCard>

          <PfCard i={3}>
            <PfCardHead title="이용 형태" sub={`${SIDE_WINDOW_LABEL[gran]} 활동 가입사`} />
            <PfCardBody>
              <PfDonut
                size={150}
                centerLabel="활동 가입사"
                slices={[
                  { label: "유료", value: kinds.paid, color: "var(--success)" },
                  { label: "체험 중", value: kinds.trial, color: "var(--chart-2)" },
                  { label: "체험 만료", value: kinds.expired, color: "var(--danger)" },
                  { label: "미구독", value: kinds.free, color: "var(--chart-5)" },
                ]}
              />
            </PfCardBody>
          </PfCard>

          <PfCard i={4}>
            <PfCardHead title="많이 본 페이지" sub={TRAFFIC_WINDOW_LABEL[gran]} />
            <PfCardBody>
              {(sideTraffic?.top_paths?.length ?? 0) === 0
                ? <PfEmpty>수집 대기 중</PfEmpty>
                : <HBarList rows={sideTraffic!.top_paths.slice(0, 5).map((p) => ({ label: pageLabel(p.path), v: p.views, title: p.path }))} unit="회" />}
              <div className="pf-card-title mt-5 mb-2">유입 경로 <span className="text-[10px] font-normal text-[var(--text-dim)]">{TRAFFIC_WINDOW_LABEL[gran]}</span></div>
              {(sideTraffic?.top_referrers?.length ?? 0) === 0
                ? <PfEmpty>수집 대기 중</PfEmpty>
                : <HBarList rows={sideTraffic!.top_referrers.slice(0, 4).map((r) => ({ label: r.host, v: r.visitors }))} unit="명" />}
            </PfCardBody>
          </PfCard>
        </div>
      </div>
    </section>
  );
}
