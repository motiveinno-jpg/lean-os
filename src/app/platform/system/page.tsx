"use client";
// 시스템 현황 — 2026-09-03 v2 pf 디자인. 조회(companies/users/subscription_plans, RPC platform_ai_costs)와
//   작업일지(빌드 시 git 커밋에서 자동 생성 — scripts/generate-release-log.mjs)는 그대로.
import releaseLogJson from "@/generated/release-log.json";
import { kstDateStr } from "@/lib/kst";
import { fetchPaged } from "@/lib/fetch-paged";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfBar, PfRows, PfRow, PfEmpty, PfState } from "../_components/pf/ui";
import { PfDonut } from "../_components/pf/charts";
import { dropTestCompanies } from "../_components/test-companies";

const db = supabase;

const ROLE_LABEL: Record<string, string> = { owner: "대표", master: "마스터", admin: "관리자", employee: "직원", partner: "파트너", advisor: "세무 파트너", member: "멤버" };

export default function SystemPage() {
  const [expanded, setExpanded] = useState<null | "companies" | "users">(null);
  const toggle = (k: "companies" | "users") => setExpanded((cur) => (cur === k ? null : k));

  // 회사·사용자 전체 — 1,000행 상한에 잘리지 않게 끝까지 넘겨 받는다
  const { data: companies = [], isLoading: companiesLoading, error: companiesError, refetch: refetchCompanies } = useQuery({
    queryKey: ["p-sys-companies"],
    queryFn: async () => {
      const data = await fetchPaged<any>("system/page:companies", () => db
        .from("companies")
        .select("id, name, business_number, created_at")
        .order("created_at", { ascending: false })
        .order("id"), 100000, { strict: true });
      // 테스트 회사(자동 QA)는 데이터 규모 집계에서 뺀다
      return dropTestCompanies(data, (c: any) => c.id);
    },
  });

  const { data: users = [], isLoading: usersLoading, error: usersError, refetch: refetchUsers } = useQuery({
    queryKey: ["p-sys-users"],
    queryFn: async () => {
      const data = await fetchPaged<any>("system/page:users", () => db
        .from("users")
        .select("id, name, email, role, created_at, company_id")
        .order("created_at", { ascending: false })
        .order("id"), 100000, { strict: true });
      return dropTestCompanies(data);
    },
  });

  const { data: plans = [], isLoading: plansLoading, error: plansError, refetch: refetchPlans } = useQuery({
    queryKey: ["p-sys-plans"],
    queryFn: async () => {
      // 판매하지 않는 요금제(자사 전용 울트라)는 숨긴다.
      const { data, error } = await db.from("subscription_plans")
        .select("*").eq("is_active", true).order("base_price", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // 이번 달 AI 비용 · 참모·브리핑 등 모든 AI 호출의 실측 합계(ai_usage_log 기반 RPC).
  //   회사별 상한($10/월 ≈ 14,000원)은 공용 호출기(claude.ts)가 강제한다.
  type AiCosts =  {
    month: string; total_usd: number; total_calls: number; cap_usd: number;
    // 합계에서 뺀 테스트 회사(자동 QA) 사용액 — 실제로 나간 돈이라 따로 밝힌다
    excluded_test_usd?: number;
    companies: { company: string | null; company_id: string; usd: number; calls: number; tokens: number; by_feature: Record<string, number> }[];
  };
  const { data: aiCosts, isLoading: aiLoading, error: aiError, refetch: refetchAi } = useQuery<AiCosts | null>({
    queryKey: ["p-sys-ai-costs"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as any).rpc("platform_ai_costs");
      if (error) throw error;
      return (data as AiCosts) ?? null;
    },
    staleTime: 60_000,
  });
  const FX = 1400; // 표시용 환산 환율(고정 안내)
  const FEATURE_LABEL: Record<string, string> = {
    owner_copilot: "AI 참모", owner_copilot_turn: "AI 참모(후속 턴)", copilot_memory: "AI 참모 기억", biz_cert_extract: "사업자등록증 판독", ai_briefing: "AI 브리핑", classify_tx: "거래 분류", settlement_match: "정산 매칭",
  };

  // 릴리스 로그 · 빌드 시 git 에서 자동 생성된 JSON. 날짜별 그룹.
  const releaseByDate = (releaseLogJson.entries as  { hash: string; date: string; type: string; label: string; scope: string | null; title: string }[])
    .reduce<Record<string, typeof releaseLogJson.entries>[string][]>((acc: any, e: any) => {
      (acc[e.date] = acc[e.date] || []).push(e);
      return acc;
    }, {} as any);
  const releaseDates = Object.keys(releaseByDate).sort((a, b) => b.localeCompare(a));

  const roleCounts = users.reduce((acc: Record<string, number>, u: any) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});
  const roleSlices = Object.entries(roleCounts).map(([role, n]) => ({ label: ROLE_LABEL[role] || role, value: n as number }));

  const aiTotalKrw = aiCosts ? Math.round(aiCosts.total_usd * FX) : 0;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="시스템"
        title="시스템 현황"
        desc="오너뷰에 쌓인 데이터 규모, 판매 중인 요금제, 이번 달 AI 비용, 그리고 배포 기록을 봅니다."
      />

      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="가입 회사" value={companies.length} unit="곳" /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="사용자" value={users.length} unit="명" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="판매 중 요금제" value={plans.length} unit="개" /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label={`AI 비용 (${aiCosts?.month || "이번 달"})`} value={aiTotalKrw} prefix="₩" accent /></PfCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 데이터 규모 */}
        <PfCard i={5} hover={false}>
          <PfCardHead title="데이터 규모" sub="숫자를 누르면 목록이 펼쳐집니다" />
          <PfCardBody className="space-y-3">
            <button
              type="button"
              onClick={() => toggle("companies")}
              className="w-full flex justify-between items-center px-3 h-11 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition text-left"
            >
              <span className="text-[12px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                가입 회사
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "companies" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{companies.length}곳</span>
            </button>
            {expanded === "companies" && (
              <div className="rounded-xl border border-[var(--border)]/60 max-h-72 overflow-y-auto">
                <PfState loading={companiesLoading} error={companiesError} onRetry={() => refetchCompanies()} empty={companies.length === 0} emptyText="회사가 없습니다" skeletonRows={3}>
                  <PfRows>
                    {companies.map((c: any) => (
                      <PfRow key={c.id} href={`/platform/companies/${c.id}`} className="px-3">
                        <div className="min-w-0 flex-1">
                          <div className="pf-row-title">{c.name || "(이름 없음)"}</div>
                          <div className="pf-row-sub">
                            {c.business_number || "사업자번호 미등록"}
                            {c.created_at && ` · 가입 ${kstDateStr(new Date(c.created_at))}`}
                          </div>
                        </div>
                        <span className="text-[var(--text-dim)] text-[11px] shrink-0">상세 →</span>
                      </PfRow>
                    ))}
                  </PfRows>
                </PfState>
              </div>
            )}

            <button
              type="button"
              onClick={() => toggle("users")}
              className="w-full flex justify-between items-center px-3 h-11 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition text-left"
            >
              <span className="text-[12px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                사용자
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "users" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{users.length}명</span>
            </button>
            {expanded === "users" && (
              <div className="rounded-xl border border-[var(--border)]/60 max-h-72 overflow-y-auto">
                <PfState loading={usersLoading} error={usersError} onRetry={() => refetchUsers()} empty={users.length === 0} emptyText="사용자가 없습니다" skeletonRows={3}>
                  <PfRows>
                    {users.map((u: any) => (
                      <PfRow key={u.id} href={`/platform/members?q=${encodeURIComponent(u.email || "")}`} className="px-3">
                        <div className="min-w-0 flex-1">
                          <div className="pf-row-title">{u.name || "(이름 없음)"}</div>
                          <div className="pf-row-sub">{u.email || u.id}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <PfBadge tone="muted">{ROLE_LABEL[u.role] || u.role}</PfBadge>
                          {u.created_at && <span className="text-[10px] text-[var(--text-dim)] mono-number">{kstDateStr(new Date(u.created_at))}</span>}
                        </div>
                      </PfRow>
                    ))}
                  </PfRows>
                </PfState>
              </div>
            )}

            {roleSlices.length > 0 && (
              <div className="pt-2">
                <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">역할별 사용자</div>
                <PfDonut slices={roleSlices} size={140} centerLabel="사용자" formatCenter={(t) => `${t}명`} />
              </div>
            )}
          </PfCardBody>
        </PfCard>

        {/* 요금제 */}
        <PfCard i={6} hover={false}>
          <PfCardHead title="요금제" sub="지금 판매 중인 것만 보입니다" />
          <PfCardBody className="space-y-2">
            <PfState loading={plansLoading} error={plansError} onRetry={() => refetchPlans()} empty={plans.length === 0} emptyText="요금제가 없습니다" skeletonRows={3} pad={false}>
              {plans.map((p: any) => (
                <div key={p.id} className="rounded-xl px-3 py-2.5 bg-[var(--bg-surface)]">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-[13px] text-[var(--text)]">{p.name}</span>
                    <span className="text-[13px] font-bold mono-number text-[var(--primary)]">
                      {`₩${(p.base_price || 0).toLocaleString()}/월`}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text-dim)]">
                    기본 {p.included_seats ?? 5}명 포함 · 추가 1명 ₩{(p.per_seat_price || 0).toLocaleString()}/월
                    {p.max_deals && ` · 최대 프로젝트 ${p.max_deals}개`}
                    <span className="font-mono"> · {p.slug}</span>
                  </div>
                </div>
              ))}
            </PfState>
          </PfCardBody>
        </PfCard>

        {/* AI 비용 — 이번 달 실측(ai_usage_log) */}
        <PfCard i={7} hover={false}>
          <PfCardHead title={`AI 비용 (${aiCosts?.month || "이번 달"})`} sub="회사마다 월 한도가 있고, 넘으면 AI 호출이 자동으로 막힙니다" />
          <PfCardBody className="space-y-3">
            {aiLoading || aiError || !aiCosts ? (
              <PfState loading={aiLoading} error={aiError} onRetry={() => refetchAi()} empty={!aiCosts} emptyText="AI 비용 집계가 없습니다" skeletonRows={3} pad={false} />
            ) : (
              <>
                <div className="flex justify-between items-center px-3 h-11 rounded-xl bg-[var(--bg-surface)]">
                  <span className="text-[12px] font-semibold text-[var(--text-muted)]">전체 (호출 {aiCosts.total_calls}회)</span>
                  <span className="font-bold mono-number text-[var(--text)]">
                    ₩{Math.round(aiCosts.total_usd * FX).toLocaleString()} <span className="text-[10px] text-[var(--text-dim)] font-normal">(${aiCosts.total_usd.toFixed(2)})</span>
                  </span>
                </div>
                {(aiCosts.excluded_test_usd ?? 0) > 0 && (
                  <p className="px-3 text-[11px] text-[var(--text-dim)]">
                    테스트 회사 사용분 ₩{Math.round((aiCosts.excluded_test_usd ?? 0) * FX).toLocaleString()} (${(aiCosts.excluded_test_usd ?? 0).toFixed(2)})은 합계와 목록에서 뺐습니다
                  </p>
                )}
                {aiCosts.companies.length === 0 ? (
                  <PfEmpty>이번 달 AI 사용 내역이 없습니다</PfEmpty>
                ) : (
                  aiCosts.companies.map((c) => {
                    const ratio = c.usd / aiCosts.cap_usd;
                    const tone = ratio > 0.8 ? "danger" : ratio > 0.5 ? "warn" : "info";
                    return (
                      <div key={c.company_id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[12px] text-[var(--text)] truncate">{c.company || "(회사 미상)"}</span>
                          <span className="text-[12px] font-bold mono-number text-[var(--text)] shrink-0">
                            ₩{Math.round(c.usd * FX).toLocaleString()}
                            <span className="text-[10px] text-[var(--text-dim)] font-normal"> / 한도 ₩{Math.round(aiCosts.cap_usd * FX / 1000)}천</span>
                          </span>
                        </div>
                        <PfBar pct={Math.min(100, ratio * 100)} tone={tone} />
                        <div className="text-[10.5px] text-[var(--text-dim)]">
                          호출 {c.calls}회 · 토큰 {Number(c.tokens || 0).toLocaleString()}
                          {c.by_feature && " · " + Object.entries(c.by_feature)
                            .map(([f, usd]) => `${FEATURE_LABEL[f] || f} ₩${Math.round(Number(usd) * FX).toLocaleString()}`)
                            .join(" · ")}
                        </div>
                      </div>
                    );
                  })
                )}
                <p className="text-[10px] text-[var(--text-dim)]">
                  AI 공급사 공식 단가로 추정한 값 · 원화는 환율 1,400 고정 표기
                </p>
              </>
            )}
          </PfCardBody>
        </PfCard>

        {/* 환경 정보 */}
        <PfCard i={8} hover={false}>
          <PfCardHead title="오너뷰가 돌아가는 곳" />
          <PfCardBody>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "화면·서버", value: "Next.js 16 · Vercel" },
                { label: "데이터베이스", value: "Supabase (PostgreSQL)" },
                { label: "주소", value: "www.owner-view.com" },
                { label: "배포 기록", value: `${releaseLogJson.entries.length}건` },
              ].map((item) => (
                <div key={item.label} className="rounded-xl px-3 py-2.5 bg-[var(--bg-surface)]">
                  <div className="text-[10px] text-[var(--text-dim)] mb-0.5">{item.label}</div>
                  <div className="text-[12px] font-semibold text-[var(--text)]">{item.value}</div>
                </div>
              ))}
            </div>
          </PfCardBody>
        </PfCard>

        {/* Release Log / 작업일지 */}
        <PfCard i={9} hover={false} className="md:col-span-2">
          <PfCardHead title="작업일지 / 배포 기록" sub="배포할 때마다 코드 변경 기록에서 자동으로 만들어집니다. 따로 적지 않아도 항상 최신" />
          <PfCardBody>
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
              {releaseDates.map((date) => (
                <div key={date}>
                  <div className="text-[12px] font-bold text-[var(--text)] mb-1.5 sticky top-0 bg-[var(--bg-card)]/90 backdrop-blur py-1">{date} <span className="text-[10px] font-normal text-[var(--text-dim)]">({(releaseByDate as any)[date].length}건)</span></div>
                  <ul className="space-y-1">
                    {(releaseByDate as any)[date].map((e: any) => (
                      <li key={e.hash} className="flex items-start gap-2 text-[12px] text-[var(--text-muted)]">
                        <PfBadge tone={e.type === "hotfix" || e.type === "security" ? "danger" : e.type === "feat" ? "info" : e.type === "fix" ? "warn" : "muted"} className="mt-0.5">{e.label}</PfBadge>
                        <span className="min-w-0">{e.title}{e.scope ? ` (${e.scope})` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </PfCardBody>
        </PfCard>
      </div>
    </PfPage>
  );
}
