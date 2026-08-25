"use client";
// 시스템 상태 (2026-07-28) — 에러해석·의존성·사고기록·감사로그 4개 화면 통합.
//   비개발자 운영자의 세 질문에 답한다: ① 지금 문제 있나(신호등) ② 무슨 일이
//   있었나(사람 언어 타임라인) ③ 뭘 해야 하나(문제 항목에 색·안내).
//   30초 자동 갱신. 원본 상세(에러·사고·감사·의존성)는 하단 링크로 유지.
import { useQuery } from "@tanstack/react-query";
import { Ico } from "@/components/ui-icon";
import { supabase } from "@/lib/supabase";
import { explainError } from "@/lib/operator-error-explain";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SystemTabs } from "../_components/system-tabs";

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

function Light({ label, tone, desc }: { label: string; tone: "ok" | "warn" | "danger" | "loading"; desc: string }) {
  const color =
    tone === "ok" ? "text-[var(--success)]" :
    tone === "warn" ? "text-[var(--warning)]" :
    tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text-dim)]";
  return (
    <div className="platform-light">
      <span className={`text-lg leading-none ${color}`}>●</span>
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-[var(--text)]">{label}</div>
        <div className="text-[11px] text-[var(--text-dim)] truncate">{desc}</div>
      </div>
    </div>
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
  const signupTone = !h ? "loading" : h.signup.accounts > 0 && h.signup.companies === 0 ? "warn" : "ok";
  const payTone = !h ? "loading" : h.payment.failures > 0 ? "danger" : "ok";
  const errTone = !h ? "loading" : h.errors_24h > 10 ? "danger" : h.errors_24h > 0 ? "warn" : "ok";
  const depsTone = !deps ? "loading" :
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

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">시스템 상태</h1>
        <p className="text-xs text-[var(--text-dim)] mt-1">30초마다 자동 갱신 · 최근 48시간의 모든 활동을 시간순으로 보여줍니다</p>
      </div>

      <SystemTabs />

      {feedError && (
        <div className="platform-check-failed-banner">
          <span className="font-bold"><Ico e="⚠" /> 데이터를 불러오지 못했습니다.</span>{" "}
          {/forbidden|운영자/i.test((feedError as any)?.message || "")
            ? "권한 없음 — 플랫폼 운영자 계정(creative@mo-tive.com)만 조회할 수 있습니다."
            : `조회 실패 — ${(feedError as any)?.message || "네트워크 또는 서버 오류"}`}
        </div>
      )}

      {/* ① 지금 문제 있나 — 신호등 */}
      <div className="platform-light-row glass-card">
        <Light label="가입" tone={signupTone as never}
          desc={h ? `24시간: 계정 ${h.signup.accounts} · 회사 등록 ${h.signup.companies}` : "확인 중"} />
        <Light label="결제" tone={payTone as never}
          desc={h ? (h.payment.failures > 0 ? `실패 ${h.payment.failures}건 — 확인 필요` : `구독 시작 ${h.payment.subs_started}건 · 실패 없음`) : "확인 중"} />
        <Light label="오류" tone={errTone as never}
          desc={h ? (h.errors_24h === 0 ? "24시간 오류 없음" : `24시간 ${h.errors_24h}건`) : "확인 중"} />
        <Light label="외부 서비스" tone={depsTone as never}
          desc={deps ? "Supabase · Stripe · CODEF 정상 범위" : "확인 중"} />
        <Light label="이용" tone={h ? "ok" : "loading"}
          desc={h ? `24시간 접속 ${h.active_users_24h}명 · 알림 ${h.notifications_24h}건` : "확인 중"} />
      </div>

      {/* ② 무슨 일이 있었나 — 사람 언어 타임라인 */}
      <div className="glass-card p-0 overflow-hidden">
        <div className="platform-card-head">
          <span className="platform-card-title">무슨 일이 있었나</span>
          <div className="flex items-center gap-2">
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="platform-feed-company-select"
            >
              <option value="all">전체 회사</option>
              {feedCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-[11px] text-[var(--text-dim)]">최근 48시간 · {shownFeed.length}건</span>
          </div>
        </div>
        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--text-dim)]">불러오는 중...</div>
        ) : feedError ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--text-dim)]">위 안내를 확인하세요 — 데이터 조회에 실패했습니다.</div>
        ) : shownFeed.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--text-dim)]">{companyFilter === "all" ? "최근 48시간 동안 기록된 활동이 없습니다." : "이 회사의 최근 활동이 없습니다."}</div>
        ) : (
          <div className="platform-rail-rows">
            {shownFeed.map((f, i) => {
              const l = feedLine(f);
              const isError = f.kind === "error";
              const open = isError && expandedIdx === i;
              return (
                <div key={i}>
                  <div
                    className={`platform-feed-row ${l.tone === "danger" ? "platform-feed-danger" : ""} ${isError ? "cursor-pointer" : ""}`}
                    onClick={isError ? () => setExpandedIdx(open ? null : i) : undefined}
                    title={isError ? "클릭하면 무슨 오류인지 자세히 표시합니다" : undefined}
                  >
                    <span className="text-sm shrink-0"><Ico e={l.icon} /></span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[13px] font-semibold truncate ${l.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{l.text}</div>
                      {l.sub && <div className="text-[11px] text-[var(--text-dim)] truncate">{l.sub}</div>}
                    </div>
                    <span className="text-[11px] text-[var(--text-dim)] mono-number shrink-0">{fmtKst(f.at)}</span>
                    {isError && (
                      <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                  </div>
                  {open && (() => {
                    const exp = explainError(f.what, f.extra, null);
                    return (
                      <div className="platform-feed-error-detail">
                        <div className="platform-feed-error-detail-item"><b>무슨 오류인가요?</b> {exp.what}</div>
                        <div className="platform-feed-error-detail-item"><b>왜 났을까요?</b> {exp.why}</div>
                        <div className="platform-feed-error-detail-item"><b>어떻게 하나요?</b> {exp.fix}</div>
                        {f.who && <div className="platform-feed-error-detail-item"><b>발생 위치</b> {f.who}</div>}
                        <div className="platform-feed-error-detail-item"><b>심각도</b> {exp.severity === "critical" ? "매우 높음" : exp.severity === "high" ? "높음" : exp.severity === "medium" ? "중간" : "낮음"} · 분류 {exp.code}</div>
                        <div className="platform-feed-error-detail-raw">원문: {f.what || "(없음)"}</div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
