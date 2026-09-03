"use client";
// 시스템 상태 (2026-07-28) — 에러해석·의존성·사고기록·감사로그 4개 화면 통합.
//   비개발자 운영자의 세 질문에 답한다: ① 지금 문제 있나(신호등) ② 무슨 일이
//   있었나(사람 언어 타임라인) ③ 뭘 해야 하나(문제 항목에 색·안내).
//   30초 자동 갱신. 원본 상세(에러·사고·감사·의존성)는 상단 탭으로 이동.
//   2026-09-03 v2: pf 디자인(신호등 타일·타임라인·KPI)으로 재구성. 데이터·판정 로직은 그대로.
import { useQuery } from "@tanstack/react-query";
import { Ico } from "@/components/ui-icon";
import { supabase } from "@/lib/supabase";
import { explainError } from "@/lib/operator-error-explain";
import { useMemo, useState } from "react";
import { SystemTabs } from "../_components/system-tabs";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfKpi, PfBadge, PfSkeleton, PfEmpty, PfRows } from "../_components/pf/ui";

const db = supabase;

type Feed = {
  as_of: string; hours: number;
  health: {
    signup: { accounts: number; companies: number };
    payment: { subs_started: number; failures: number };
    errors_24h: number;
    notifications_24h: number;
    active_users_24h: number;
  };
  feed: { at: string; kind: string; who: string | null; what: string | null; extra: string | null }[];
};
type DepsHealth = {
  supabase: { errors_1h: number };
  stripe: { failed_invoices_24h: number };
  codef: { bank_tx_24h: number; card_tx_24h: number };
};

// 고객 활동(audit_logs)의 entity.action → 사람 언어
const AUDIT_LABEL: Record<string, string> = {
  "approval_request.created": "결재 요청 생성",
  "approval_request.auto_approved": "결재 자동 승인",
  "approval_step.approved": "결재 승인",
  "approval_step.rejected": "결재 반려",
  "signature_request.created": "전자계약 발송",
  "signature_request.completed": "전자계약 서명 완료",
  "employee.created": "직원 등록",
  "employee.updated": "직원 정보 수정",
  "deal.created": "프로젝트 생성",
  "invoice.issued": "세금계산서 발행",
};
const auditLabel = (code?: string | null) => {
  if (!code) return "활동";
  if (AUDIT_LABEL[code]) return AUDIT_LABEL[code];
  const [entity, action] = code.split(".");
  return `${entity || "항목"} ${action || "변경"}`;
};

const fmtKst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function feedLine(f: Feed["feed"][number]): { icon: string; text: string; sub: string; tone?: "danger" | "warn" } {
  switch (f.kind) {
    case "account":
      return { icon: "🧑", text: `계정 생성 — ${f.who}`, sub: `${f.what === "email" ? "이메일" : f.what} 가입` };
    case "company":
      return { icon: "🏢", text: `회사 개설 — ${f.who}`, sub: f.what ? `사업자번호 ${f.what}` : "" };
    case "subscription":
      return {
        icon: "💳",
        text: `${f.who} — ${f.what === "trialing" ? "무료체험 시작" : "구독 시작"}`,
        sub: f.extra ? `${f.extra} 플랜` : "",
      };
    case "audit":
      return { icon: "📋", text: `${f.who || "고객사"} — ${auditLabel(f.what)}`, sub: f.extra ? `처리: ${f.extra}` : "" };
    case "error": {
      const exp = explainError(f.what, f.extra, null);
      return { icon: "⚠️", text: `오류 — ${exp?.what || f.what || "알 수 없는 오류"}`, sub: `${f.who ? `발생: ${f.who}` : ""}${exp?.fix ? ` · 조치: ${exp.fix}` : ""}`, tone: "danger" };
    }
    case "operator":
      return { icon: "🛠️", text: `운영자 작업 — ${f.what}`, sub: f.who || "" };
    default:
      return { icon: "•", text: f.what || f.kind, sub: "" };
  }
}

type LightTone = "ok" | "warn" | "danger" | "loading";
const LIGHT_LABEL: Record<LightTone, string> = { ok: "정상", warn: "주의", danger: "문제", loading: "확인 중" };
const LIGHT_BADGE: Record<LightTone, "ok" | "warn" | "danger" | "muted"> = { ok: "ok", warn: "warn", danger: "danger", loading: "muted" };

/** 신호등 타일 — 한 항목의 지금 상태. */
function Light({ label, tone, desc, i }: { label: string; tone: LightTone; desc: string; i: number }) {
  const dot = tone === "ok" ? "pf-live" : tone === "loading" ? "pf-live pf-live-off" : "";
  const dotColor = tone === "warn" ? "#D97706" : tone === "danger" ? "var(--danger)" : undefined;
  return (
    <PfCard i={i} className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[12px] font-bold text-[var(--text)] flex items-center gap-2">
          {dot ? <span className={dot} /> : <span className="inline-block w-2 h-2 rounded-full" style={{ background: dotColor }} />}
          {label}
        </span>
        <PfBadge tone={LIGHT_BADGE[tone]}>{LIGHT_LABEL[tone]}</PfBadge>
      </div>
      <div className="text-[11px] text-[var(--text-muted)] leading-snug">{desc}</div>
    </PfCard>
  );
}

export default function PlatformHealthPage() {
  const { data, isLoading, error: feedError } = useQuery<Feed | null>({
    queryKey: ["p-activity-feed"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("platform_activity_feed", { p_hours: 48, p_limit: 120 });
      if (error) throw error;
      return data as Feed;
    },
    refetchInterval: 30_000,
    retry: 1,
  });
  const { data: deps } = useQuery<DepsHealth | null>({
    queryKey: ["op-deps-health"],
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("operator_dependencies_health");
      if (error) return null;
      return data as DepsHealth;
    },
    refetchInterval: 60_000,
  });

  const h = data?.health;
  // 신호 판정 — 실측 기반. "계정만 생기고 회사 등록이 없는 날"은 가입 흐름 점검 신호.
  const signupTone: LightTone = !h ? "loading" : h.signup.accounts > 0 && h.signup.companies === 0 ? "warn" : "ok";
  const payTone: LightTone = !h ? "loading" : h.payment.failures > 0 ? "danger" : "ok";
  const errTone: LightTone = !h ? "loading" : h.errors_24h > 10 ? "danger" : h.errors_24h > 0 ? "warn" : "ok";
  const depsTone: LightTone = !deps ? "loading" :
    (deps.supabase.errors_1h > 50 || deps.stripe.failed_invoices_24h > 5) ? "warn" : "ok";

  // 회사별 필터 (2026-07-28 사장님 요청) — 전 회사 활동이 한데 섞여 회사가 늘면 못 쓰게 되는 문제.
  //   피드에 등장한 회사명으로 드롭다운을 만들고, 선택 시 그 회사 관련 항목만 표시.
  const [companyFilter, setCompanyFilter] = useState("all");
  // 오류 행 클릭 → 무슨 오류/왜/조치 상세 펼침 (2026-07-29 사장님)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const feedCompanies = useMemo(() => {
    const set = new Set<string>();
    (data?.feed ?? []).forEach((f) => {
      if ((f.kind === "company" || f.kind === "subscription" || f.kind === "audit" || f.kind === "error") && f.who) set.add(f.who);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [data]);
  const shownFeed = useMemo(() => {
    const feed = data?.feed ?? [];
    if (companyFilter === "all") return feed;
    return feed.filter((f) => f.who === companyFilter);
  }, [data, companyFilter]);

  // 전체 판정 한 줄 — 신호등 5개 중 가장 나쁜 것
  const worst: LightTone = [signupTone, payTone, errTone, depsTone].includes("danger") ? "danger"
    : [signupTone, payTone, errTone, depsTone].includes("warn") ? "warn"
    : !h ? "loading" : "ok";
  const headline = worst === "danger" ? "지금 확인이 필요한 항목이 있어요"
    : worst === "warn" ? "대체로 정상, 주의할 항목이 있어요"
    : worst === "loading" ? "상태를 확인하는 중이에요"
    : "모든 항목이 정상이에요";

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="시스템 상태"
        desc="지금 문제가 있는지, 최근 48시간 동안 무슨 일이 있었는지 한 화면에서 봅니다. 30초마다 자동으로 새로 고칩니다."
        actions={<PfBadge tone={LIGHT_BADGE[worst]} className="h-7 px-3 text-[11px]">{headline}</PfBadge>}
      />
      <SystemTabs />

      {feedError && (
        <PfCard i={2} hover={false} className="border-[var(--danger)]/40">
          <div className="px-5 py-3 text-[12px] text-[var(--danger)]">
            <span className="font-bold"><Ico e="⚠" /> 데이터를 불러오지 못했습니다.</span>{" "}
            {/forbidden|운영자/i.test((feedError as any)?.message || "")
              ? "권한 없음 — 플랫폼 운영자 계정(creative@mo-tive.com)만 조회할 수 있습니다."
              : `조회 실패 — ${(feedError as any)?.message || "네트워크 또는 서버 오류"}`}
          </div>
        </PfCard>
      )}

      {/* ① 지금 문제 있나 — 신호등 타일 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Light i={2} label="가입" tone={signupTone}
          desc={h ? `24시간 계정 ${h.signup.accounts}명 · 회사 등록 ${h.signup.companies}곳${signupTone === "warn" ? " — 계정만 생기고 회사 등록이 없어요" : ""}` : "확인 중"} />
        <Light i={3} label="결제" tone={payTone}
          desc={h ? (h.payment.failures > 0 ? `결제 실패 ${h.payment.failures}건 — 확인이 필요해요` : `구독 시작 ${h.payment.subs_started}건 · 실패 없음`) : "확인 중"} />
        <Light i={4} label="오류" tone={errTone}
          desc={h ? (h.errors_24h === 0 ? "24시간 동안 오류 없음" : `24시간 동안 ${h.errors_24h}건`) : "확인 중"} />
        <Light i={5} label="외부 서비스" tone={depsTone}
          desc={deps ? "DB · 결제 · 은행/카드 수집 모두 정상 범위" : "확인 중"} />
        <Light i={6} label="이용" tone={h ? "ok" : "loading"}
          desc={h ? `24시간 접속 ${h.active_users_24h}명 · 알림 ${h.notifications_24h}건` : "확인 중"} />
      </div>

      {/* 숫자 요약 — 24시간 */}
      {h && (
        <div className="pf-kpi-grid">
          <PfCard i={7} className="pf-kpi-tile"><PfKpi label="24시간 접속" value={h.active_users_24h} unit="명" live={h.active_users_24h > 0} /></PfCard>
          <PfCard i={8} className="pf-kpi-tile"><PfKpi label="새 계정" value={h.signup.accounts} unit="명" /></PfCard>
          <PfCard i={9} className="pf-kpi-tile"><PfKpi label="새 회사" value={h.signup.companies} unit="곳" /></PfCard>
          <PfCard i={10} className="pf-kpi-tile"><PfKpi label="구독 시작" value={h.payment.subs_started} unit="건" /></PfCard>
          <PfCard i={11} className="pf-kpi-tile"><PfKpi label="오류" value={h.errors_24h} unit="건" accent={h.errors_24h > 0} /></PfCard>
        </div>
      )}

      {/* ② 무슨 일이 있었나 — 사람 언어 타임라인 */}
      <PfCard i={12} hover={false}>
        <PfCardHead
          title="무슨 일이 있었나"
          sub={`최근 48시간 · ${shownFeed.length}건`}
          right={
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="platform-feed-company-select"
            >
              <option value="all">전체 회사</option>
              {feedCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          }
        />
        {isLoading ? (
          <div className="px-5 pb-5"><PfSkeleton rows={6} h={14} /></div>
        ) : feedError ? (
          <PfEmpty>위 안내를 확인하세요 — 데이터 조회에 실패했습니다.</PfEmpty>
        ) : shownFeed.length === 0 ? (
          <PfEmpty>{companyFilter === "all" ? "최근 48시간 동안 기록된 활동이 없습니다." : "이 회사의 최근 활동이 없습니다."}</PfEmpty>
        ) : (
          <PfRows>
            {shownFeed.map((f, i) => {
              const l = feedLine(f);
              const isError = f.kind === "error";
              const open = isError && expandedIdx === i;
              return (
                <div key={i} className={l.tone === "danger" ? "bg-[var(--danger)]/[0.04]" : ""}>
                  <div
                    className={`pf-row ${isError ? "cursor-pointer hover:bg-[var(--bg-surface)]" : ""}`}
                    onClick={isError ? () => setExpandedIdx(open ? null : i) : undefined}
                    title={isError ? "클릭하면 무슨 오류인지 자세히 표시합니다" : undefined}
                  >
                    <span className="w-7 h-7 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[13px] shrink-0"><Ico e={l.icon} /></span>
                    <div className="flex-1 min-w-0">
                      <div className={`pf-row-title ${l.tone === "danger" ? "text-[var(--danger)]" : ""}`}>{l.text}</div>
                      {l.sub && <div className="pf-row-sub">{l.sub}</div>}
                    </div>
                    <span className="text-[11px] text-[var(--text-dim)] mono-number shrink-0">{fmtKst(f.at)}</span>
                    {isError && (
                      <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                  </div>
                  {open && (() => {
                    const exp = explainError(f.what, f.extra, null);
                    const sevLabel = exp.severity === "critical" ? "매우 높음" : exp.severity === "high" ? "높음" : exp.severity === "medium" ? "중간" : "낮음";
                    const sevTone = exp.severity === "critical" || exp.severity === "high" ? "danger" : exp.severity === "medium" ? "warn" : "ok";
                    return (
                      <div className="px-5 pb-4 pt-1 space-y-2 text-[12px]">
                        <div className="flex items-center gap-2"><PfBadge tone={sevTone}>심각도 {sevLabel}</PfBadge>{f.who && <span className="text-[11px] text-[var(--text-dim)]">발생 위치: {f.who}</span>}</div>
                        <div className="text-[14px] font-bold text-[var(--text)]">{exp.what}</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="rounded-xl px-3 py-2 bg-[var(--bg-surface)]">
                            <div className="text-[10px] font-bold text-[var(--text-dim)] mb-0.5">왜 났을까</div>
                            <div className="text-[var(--text-muted)] leading-relaxed">{exp.why}</div>
                          </div>
                          <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}>
                            <div className="text-[10px] font-bold text-[var(--primary)] mb-0.5">지금 할 일</div>
                            <div className="text-[var(--text)] leading-relaxed">{exp.fix}</div>
                          </div>
                        </div>
                        <details className="group">
                          <summary className="cursor-pointer select-none text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">기술 원문 (개발팀 전달용) · {exp.code}</summary>
                          <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-dim)] overflow-auto whitespace-pre-wrap break-words max-h-32">{f.what || "(없음)"}</pre>
                        </details>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </PfRows>
        )}
      </PfCard>
    </PfPage>
  );
}
