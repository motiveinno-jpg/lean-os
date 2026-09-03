"use client";
// 작업일지: 빌드 시 git 커밋 로그에서 자동 생성 (scripts/generate-release-log.mjs, 2026-07-28)
//   — 하드코딩 상수가 3월에 멈춰 있던 문제. 이제 배포가 곧 최신화다.
import releaseLogJson from "@/generated/release-log.json";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;

export default function SystemPage() {
  const [expanded, setExpanded] = useState<null | "companies" | "users">(null);
  const toggle = (k: "companies" | "users") => setExpanded((cur) => (cur === k ? null : k));

  const { data: companies = [] } = useQuery({
    queryKey: ["p-sys-companies"],
    queryFn: async () => {
      const data = logRead('system/page:data', await db
        .from("companies")
        .select("id, name, business_number, created_at")
        .order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-sys-users"],
    queryFn: async () => {
      const data = logRead('system/page:data', await db
        .from("users")
        .select("id, name, email, role, created_at, company_id")
        .order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["p-sys-plans"],
    queryFn: async () => {
      // 비활성 요금제(구버전)는 숨긴다 — 2026-07-28 이전엔 필터가 없어 지운 줄 알았던
      //   Starter·Pro 가 계속 보였다. 실제 행 삭제는 별건으로 처리함.
      const data = logRead('system/page:data', await db.from("subscription_plans")
        .select("*").eq("is_active", true).order("base_price", { ascending: true }));
      return data || [];
    },
  });

  // 이번 달 AI 비용 — 참모·브리핑 등 모든 AI 호출의 실측 합계(ai_usage_log 기반 RPC).
  //   회사별 상한($10/월 ≈ 14,000원)은 공용 호출기(claude.ts)가 강제한다 (2026-07-30 사장님).
  type AiCosts = {
    month: string; total_usd: number; total_calls: number; cap_usd: number;
    companies: { company: string | null; company_id: string; usd: number; calls: number; tokens: number; by_feature: Record<string, number> }[];
  };
  const { data: aiCosts } = useQuery<AiCosts | null>({
    queryKey: ["p-sys-ai-costs"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as any).rpc("platform_ai_costs");
      if (error) return null;
      return (data as AiCosts) ?? null;
    },
    staleTime: 60_000,
  });
  const FX = 1400; // 표시용 환산 환율(고정 안내)
  const FEATURE_LABEL: Record<string, string> = {
    owner_copilot: "AI 참모", owner_copilot_turn: "AI 참모(후속 턴)", copilot_memory: "AI 참모 기억", biz_cert_extract: "사업자등록증 판독", ai_briefing: "AI 브리핑", classify_tx: "거래 분류", settlement_match: "정산 매칭",
  };

  // 릴리스 로그 — 빌드 시 git 에서 자동 생성된 JSON. 날짜별 그룹.
  const releaseByDate = (releaseLogJson.entries as { hash: string; date: string; type: string; label: string; scope: string | null; title: string }[])
    .reduce<Record<string, typeof releaseLogJson.entries>[string][]>((acc: any, e: any) => {
      (acc[e.date] = acc[e.date] || []).push(e);
      return acc;
    }, {} as any);
  const releaseDates = Object.keys(releaseByDate).sort((a, b) => b.localeCompare(a));

  const roleCounts = users.reduce((acc: Record<string, number>, u: any) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">시스템 현황</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">플랫폼 리소스 및 요금제 설정</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DB Stats */}
        <div className="platform-db-stats-card glass-card">
          <h3 className="section-title text-[var(--text)]">데이터베이스</h3>
          <div className="space-y-3">
            {/* 총 회사 — 클릭 시 목록 토글 */}
            <button
              onClick={() => toggle("companies")}
              className="w-full flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/70 transition text-left"
            >
              <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                총 회사
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "companies" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{companies.length}</span>
            </button>
            {expanded === "companies" && (
              <div className="platform-company-list">
                {companies.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-dim)]">회사가 없습니다</div>
                ) : (
                  companies.map((c: any) => (
                    <Link
                      key={c.id}
                      href={`/platform/companies/${c.id}`}
                      className="platform-company-row"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--text)] font-medium truncate">{c.name || "(이름 없음)"}</div>
                        <div className="text-[11px] text-[var(--text-dim)]">
                          {c.business_number || "사업자번호 미등록"}
                          {c.created_at && ` · 가입 ${kstDateStr(new Date(c.created_at))}`}
                        </div>
                      </div>
                      <span className="text-[var(--text-dim)] text-xs shrink-0 ml-2">상세 →</span>
                    </Link>
                  ))
                )}
              </div>
            )}

            {/* 총 사용자 — 클릭 시 목록 토글 */}
            <button
              onClick={() => toggle("users")}
              className="w-full flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/70 transition text-left"
            >
              <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                총 사용자
                <svg className={`w-3.5 h-3.5 transition-transform ${expanded === "users" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span className="font-bold mono-number text-[var(--text)]">{users.length}</span>
            </button>
            {expanded === "users" && (
              <div className="platform-user-list">
                {users.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-dim)]">사용자가 없습니다</div>
                ) : (
                  users.map((u: any) => (
                    <Link
                      key={u.id}
                      href={`/platform/members?q=${encodeURIComponent(u.email || "")}`}
                      className="platform-user-row"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--text)] font-medium truncate">{u.name || "(이름 없음)"}</div>
                        <div className="text-[11px] text-[var(--text-dim)] truncate">{u.email || u.id}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="badge badge-muted">{u.role}</span>
                        {u.created_at && <span className="text-[10px] text-[var(--text-dim)]">{kstDateStr(new Date(u.created_at))}</span>}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            )}

            {/* 역할별 카운트 (기존 유지) */}
            {Object.entries(roleCounts).map(([role, count]) => (
              <div key={role} className="platform-role-count-row">
                <span className="text-sm text-[var(--text-dim)] capitalize">{role}</span>
                <span className="text-sm text-[var(--text-muted)]">{count as number}명</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="platform-plans-card glass-card">
          <h3 className="section-title text-[var(--text)]">요금제</h3>
          <div className="space-y-3">
            {plans.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--text-dim)]">요금제가 없습니다</div>
            ) : (
              plans.map((p: any) => (
                <div key={p.id} className="platform-plan-row">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-[var(--text)]">{p.name}</span>
                    <span className="text-sm font-bold mono-number text-[var(--primary)]">
                      {/* 엔터프라이즈는 가격 정책 미확정 — 고객용 billing 화면과 동일하게 표기 */}
                      {p.slug === "enterprise"
                        ? "별도 문의"
                        : `₩${(p.base_price || 0).toLocaleString()}/월`}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">
                    슬러그: {p.slug} · 좌석당 ₩{(p.per_seat_price || 0).toLocaleString()}/월
                    {p.max_deals && ` · 최대 프로젝트 ${p.max_deals}개`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI 비용 — 이번 달 실측(ai_usage_log) */}
        <div className="platform-ai-costs-card glass-card">
          <h3 className="section-title text-[var(--text)]">AI 비용 ({aiCosts?.month || "이번 달"})</h3>
          {!aiCosts ? (
            <div className="text-center py-8 text-sm text-[var(--text-dim)]">집계를 불러오는 중…</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)]">
                <span className="text-sm text-[var(--text-muted)]">전체 (호출 {aiCosts.total_calls}회)</span>
                <span className="font-bold mono-number text-[var(--text)]">
                  ${aiCosts.total_usd.toFixed(2)} <span className="text-xs text-[var(--text-dim)]">≈ ₩{Math.round(aiCosts.total_usd * FX).toLocaleString()}</span>
                </span>
              </div>
              {aiCosts.companies.length === 0 ? (
                <div className="text-center py-4 text-xs text-[var(--text-dim)]">이번 달 AI 사용 내역이 없습니다</div>
              ) : (
                aiCosts.companies.map((c) => (
                  <div key={c.company_id} className="platform-ai-cost-row">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-[var(--text)] truncate">{c.company || "(회사 미상)"}</span>
                      <span className="text-sm font-bold mono-number text-[var(--primary)] shrink-0">
                        ₩{Math.round(c.usd * FX).toLocaleString()}
                        <span className="text-[10px] text-[var(--text-dim)] font-normal"> / 한도 ₩{Math.round(aiCosts.cap_usd * FX / 1000)}천</span>
                      </span>
                    </div>
                    {/* 한도 대비 게이지 */}
                    <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden mb-1">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, (c.usd / aiCosts.cap_usd) * 100)}%`,
                        background: c.usd / aiCosts.cap_usd > 0.8 ? "var(--danger)" : c.usd / aiCosts.cap_usd > 0.5 ? "var(--warning)" : "var(--primary)",
                      }} />
                    </div>
                    <div className="text-xs text-[var(--text-dim)]">
                      호출 {c.calls}회 · 토큰 {Number(c.tokens || 0).toLocaleString()}
                      {c.by_feature && " · " + Object.entries(c.by_feature)
                        .map(([f, usd]) => `${FEATURE_LABEL[f] || f} ₩${Math.round(Number(usd) * FX).toLocaleString()}`)
                        .join(" · ")}
                    </div>
                  </div>
                ))
              )}
              <p className="text-[10px] text-[var(--text-dim)]">
                Anthropic 공식 단가 기반 실측 추정 · ₩ 환산은 환율 1,400 고정 표기 · 회사별 월 한도 초과 시 AI 호출이 자동 차단됩니다
              </p>
            </div>
          )}
        </div>

        {/* Environment */}
        <div className="platform-env-card glass-card">
          <h3 className="section-title text-[var(--text)]">환경 정보</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "프레임워크", value: "Next.js 16" },
              { label: "DB", value: "Supabase (PostgreSQL)" },
              { label: "호스팅", value: "Vercel" },
              { label: "도메인", value: "www.owner-view.com" },
            ].map((item) => (
              <div key={item.label} className="platform-env-item">
                <div className="text-[10px] text-[var(--text-dim)] mb-0.5">{item.label}</div>
                <div className="text-sm font-semibold text-[var(--text)]">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Release Log / 작업일지 */}
        <div className="platform-release-log-card glass-card">
          <h3 className="section-title text-[var(--text)]">작업일지 / 릴리즈 로그</h3>
          <p className="text-[11px] text-[var(--text-dim)] mb-3">배포 시 git 커밋에서 자동 생성됩니다 — 별도 입력 없이 항상 최신.</p>
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {releaseDates.map((date) => (
              <div key={date} className="platform-release-item">
                <div className="text-sm font-bold text-[var(--text)] mb-2">{date} <span className="text-[11px] font-normal text-[var(--text-dim)]">({(releaseByDate as any)[date].length}건)</span></div>
                <ul className="space-y-1.5">
                  {(releaseByDate as any)[date].map((e: any) => (
                    <li key={e.hash} className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        e.type === 'hotfix' || e.type === 'security' ? 'bg-[var(--danger-dim)] text-[var(--danger)]'
                        : e.type === 'feat' ? 'bg-[var(--info-dim)] text-[var(--info)]'
                        : e.type === 'fix' ? 'bg-[var(--warning-dim)] text-[var(--warning)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-dim)]'}`}>{e.label}</span>
                      <span className="min-w-0">{e.title}{e.scope ? ` (${e.scope})` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

