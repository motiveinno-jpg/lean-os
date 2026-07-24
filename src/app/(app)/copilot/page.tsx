"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { getCurrentUser } from "@/lib/queries";

// AI 참모 — 회사 데이터를 읽고 대표가 지금 해야 할 일을 정리하는 읽기전용 AI.
//   edge(owner-copilot)는 구조화 JSON(answer.headline/summary/actions/risks/opportunities/evidence) 반환.
//   토큰 사용량은 ai_usage_summary RPC(서버가 company 결정) + ai_usage_log Realtime 로 실시간 표시.

type Action = { priority: "high" | "medium" | "low"; title: string; detail: string; href?: string };
type Risk = { title: string; detail: string; severity: "high" | "medium" | "low" };
type Opp = { title: string; detail: string };
type Evidence = { label: string; value: string; source?: string };
type Answer = { headline: string; summary: string; actions: Action[]; risks: Risk[]; opportunities: Opp[]; evidence: Evidence[] };

// AI 답변 텍스트 정제 — 변수 토큰({{x}}·{x}·${x})·마크다운(**·`)이 그대로 노출돼 가독성이 떨어지던 문제 대응(2026-07-23).
function clean(s?: string): string {
  return (s || "")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "$1")   // {{변수}} → 변수
    .replace(/\$\{\s*([^{}]+?)\s*\}/g, "$1")       // ${변수} → 변수
    .replace(/\{\s*([\w가-힣.\-]+)\s*\}/g, "$1")   // {변수} → 변수 (단순 토큰만)
    .replace(/\*\*([^*]+)\*\*/g, "$1")             // **강조** → 강조
    .replace(/`([^`]+)`/g, "$1")                   // `코드` → 코드
    .trim();
}
type AiMsg = { role: "user"; text: string } | { role: "ai"; answer: Answer; model?: string; at: string; asOf?: string | null };

type Usage = {
  plan_slug: string; plan_name: string | null; monthly_limit: number | null;
  used_tokens: number; remaining_tokens: number; usage_percent: number | null;
  reset_at: string; as_of: string;
};

const MAX_HISTORY = 50; // DB에서 로드할 최대 대화 수

const QUICK = [
  { icon: "🎯", label: "오늘의 우선순위", q: "오늘 챙겨야 할 것 3가지를 우선순위로 정리해줘" },
  { icon: "💧", label: "현금흐름 진단", q: "지금 현금흐름 상태를 진단해줘" },
  { icon: "📥", label: "미수금 수금 순서", q: "미수금 회수 우선순위를 알려줘" },
  { icon: "📝", label: "결재·지급·서명 대기", q: "처리 안 된 결재·지급·서명을 정리해줘" },
  { icon: "📈", label: "매출 흐름", q: "이번 달 매출·영업 파이프라인 흐름을 봐줘" },
  { icon: "⚠️", label: "경영 리스크", q: "지금 챙겨야 할 경영 리스크가 있어?" },
];

const LOAD_STAGES = ["회사 데이터를 읽는 중…", "현금·미수·결재 데이터를 분석 중…", "실행 우선순위를 정리 중…"];
const AVG_Q_TOKENS = 1400; // 예상 질문 수 근사(평균 질문당 토큰)

function fmt(n: number) { return n.toLocaleString("ko-KR"); }
function kstDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}
function kstDay(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }); }
  catch { return "—"; }
}

export default function CopilotPage() {
  const { toast } = useToast();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const companyId = user?.company_id as string | undefined;

  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [planLocked, setPlanLocked] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 페이지 진입 시 DB에서 대화 기록 로드 (최근 MAX_HISTORY건)
  useEffect(() => {
    if (!companyId || historyLoaded) return;
    (async () => {
      const { data } = await supabase
        .from("ai_copilot_history")
        .select("query, answer, as_of, model, created_at")
        .order("created_at", { ascending: true })
        .limit(MAX_HISTORY);
      if (data && data.length > 0) {
        const loaded: AiMsg[] = [];
        for (const row of data) {
          loaded.push({ role: "user", text: row.query });
          const ans = row.answer as Answer | null;
          if (ans) {
            loaded.push({ role: "ai", answer: ans, model: row.model ?? undefined, at: row.created_at ?? new Date().toISOString(), asOf: row.as_of ?? null });
          }
        }
        setMessages(loaded);
      }
      setHistoryLoaded(true);
    })();
  }, [companyId, historyLoaded]);

  // 토큰 사용량 요약 (서버가 company 결정 — IDOR 불가)
  const { data: usage, refetch: refetchUsage } = useQuery<Usage | null>({
    queryKey: ["ai-usage-summary", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("ai_usage_summary");
      return (data && !(data as any).error ? (data as Usage) : null);
    },
    enabled: !!companyId,
    staleTime: 10_000,
  });

  // Realtime: ai_usage_log 변경 시 요약 재조회 + 15초 polling fallback
  useEffect(() => {
    if (!companyId) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => { if (!poll) poll = setInterval(() => refetchUsage(), 15_000); };
    const ch = supabase
      .channel(`ai-usage-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_usage_log", filter: `company_id=eq.${companyId}` }, () => refetchUsage())
      .subscribe((status) => { if (status !== "SUBSCRIBED") startPoll(); });
    // 안전망: 항상 느슨한 polling 도 병행(Realtime 실패/누락 대비)
    startPoll();
    return () => { supabase.removeChannel(ch); if (poll) clearInterval(poll); };
  }, [companyId, refetchUsage]);

  // 로딩 단계 순환
  useEffect(() => {
    if (!loading) { setStage(0); return; }
    const t = setInterval(() => setStage((s) => (s + 1) % LOAD_STAGES.length), 1200);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || loading) return;
    setLimitExceeded(false);
    setLoading(true);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    try {
      const { data, error } = await supabase.functions.invoke("owner-copilot", { body: { question: q } });
      if (error) {
        const ctx = (error as { context?: Response })?.context;
        let code: string | undefined; let msg = "AI 참모 호출에 실패했습니다.";
        try { const j = ctx ? await ctx.json() : null; code = j?.code; msg = j?.error || msg; } catch { /* ignore */ }
        if (code === "PLAN_REQUIRED" || code === "NOT_ENTITLED") setPlanLocked(true);
        else if (code === "TOKEN_LIMIT") setLimitExceeded(true);
        else toast(msg, "error");
        setMessages((m) => m.slice(0, -1)); // 실패한 질문 카드 롤백
        return;
      }
      const d = data as { answer: Answer; model?: string; as_of?: string | null };
      const now = new Date().toISOString();
      setMessages((m) => [...m, { role: "ai", answer: d.answer, model: d.model, at: now, asOf: d.as_of }]);
      setConnErr(false);
      // DB에 대화 기록 저장
      supabase.from("ai_copilot_history").insert({
        company_id: companyId!,
        query: q,
        answer: d.answer,
        as_of: d.as_of ?? null,
        model: d.model ?? null,
      }).then(({ error: dbErr }) => {
        if (dbErr) toast(`[DB저장실패] ${dbErr.message}`, "error");
      });
      refetchUsage();
    } catch {
      toast("AI 참모 호출에 실패했습니다.", "error");
      setConnErr(true);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [loading, toast, refetchUsage]);

  const locked = planLocked || usage?.monthly_limit == null;
  const pct = usage?.usage_percent ?? 0;
  const overLimit = limitExceeded || (usage != null && usage.monthly_limit != null && usage.remaining_tokens <= 0);
  const gaugeTone = pct >= 90 ? "copilot-gauge-danger" : pct >= 70 ? "copilot-gauge-warn" : "copilot-gauge-ok";
  const estQuestions = usage?.remaining_tokens != null ? Math.max(0, Math.floor(usage.remaining_tokens / AVG_Q_TOKENS)) : 0;

  return (
    <div className="copilot2-page">
      {/* Hero */}
      <div className="copilot2-hero">
        <div className="copilot2-hero-orb copilot2-hero-orb-a" aria-hidden />
        <div className="copilot2-hero-orb copilot2-hero-orb-b" aria-hidden />
        <div className="copilot2-hero-content">
          <div className="copilot2-hero-badge"><span className="copilot2-hero-spark" aria-hidden>✦</span> AI 참모</div>
          <h1 className="copilot2-hero-title">회사 데이터를 읽고, 대표가 지금 해야 할 일을 정리합니다</h1>
          <div className="copilot2-hero-meta">
            <span className={`copilot2-conn ${connErr ? "copilot2-conn-err" : "copilot2-conn-ok"}`}>
              <span className="copilot2-conn-dot" aria-hidden />{connErr ? "연결 오류" : "AI 연결됨"}
            </span>
            <span className="copilot2-hero-asof">기준 {kstDate(usage?.as_of)}</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="copilot2-clear-btn"
                aria-label="대화 초기화"
              >
                대화 초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="copilot2-lock-card">
          <div className="text-3xl mb-2" aria-hidden>🔒</div>
          <div className="copilot2-lock-title">AI 참모는 프로 이상 플랜에서 이용할 수 있습니다</div>
          <p className="copilot2-lock-desc">회사 데이터를 실시간으로 읽고 오늘 챙길 것을 정리해 드립니다. 플랜을 올리면 바로 사용할 수 있어요.</p>
          <a href="/billing" className="btn-primary btn-sm">플랜 보기 · 업그레이드</a>
        </div>
      ) : (
        <div className="copilot2-grid">
          {/* 좌: 대화 */}
          <div className="copilot2-main">
            <div className="copilot2-conv" ref={scrollRef}>
              {messages.length === 0 && !loading && (
                <div className="copilot2-empty">
                  <div className="copilot2-empty-icon" aria-hidden>✦</div>
                  <div className="copilot2-empty-title">무엇이든 물어보세요</div>
                  <div className="copilot2-empty-desc">아래 빠른 질문을 누르거나 직접 입력하면, 회사 데이터를 근거로 답합니다.</div>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="copilot2-msg-user"><div className="copilot2-bubble-user">{m.text}</div></div>
                ) : (
                  <AnswerCard key={i} msg={m} />
                ),
              )}
              {loading && <LoadingCard stage={stage} />}
            </div>

            {overLimit ? (
              <div className="copilot2-limit-card">
                <div className="font-bold text-sm text-[var(--danger)]">이번 달 AI 사용량을 모두 사용했습니다</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{usage?.reset_at ? `${kstDay(usage.reset_at)}에 초기화됩니다.` : "다음 달에 초기화됩니다."} 더 필요하면 상위 플랜을 확인하세요.</div>
                <a href="/billing" className="btn-secondary btn-sm mt-3">요금제 보기</a>
              </div>
            ) : (
              <>
                {/* 빠른 질문 카드 */}
                <div className="copilot2-quick-grid">
                  {QUICK.map((qq) => (
                    <button key={qq.label} type="button" disabled={loading} onClick={() => ask(qq.q)} className="copilot2-quick-card">
                      <span className="copilot2-quick-icon" aria-hidden>{qq.icon}</span>
                      <span className="copilot2-quick-label">{qq.label}</span>
                    </button>
                  ))}
                </div>

                {/* 입력창 */}
                <div className="copilot2-input-row">
                  <span className="copilot2-input-spark" aria-hidden>✦</span>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
                    placeholder="회사 상태에 대해 무엇이든 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                    rows={1}
                    disabled={loading}
                    className="copilot2-input"
                  />
                  <button onClick={() => ask(question)} disabled={loading || !question.trim()} className="copilot2-send" aria-label="전송">
                    {loading ? <span className="copilot2-spinner" aria-hidden /> : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 우: 토큰 사용량 */}
          <aside className="copilot2-side">
            <TokenCard usage={usage} pct={pct} gaugeTone={gaugeTone} estQuestions={estQuestions} model="Claude Sonnet" />
          </aside>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ msg }: { msg: Extract<AiMsg, { role: "ai" }> }) {
  const a = msg.answer;
  const sevCls = (s: string) => (s === "high" ? "copilot2-sev-high" : s === "medium" ? "copilot2-sev-mid" : "copilot2-sev-low");
  return (
    <div className="copilot2-answer">
      <div className="copilot2-answer-head">
        <span className="copilot2-answer-spark" aria-hidden>✦</span>
        <span className="copilot2-answer-title">AI 분석 결과</span>
        {msg.model && <span className="copilot2-answer-model">{msg.model.includes("opus") ? "Opus" : msg.model.includes("haiku") ? "Haiku" : "Sonnet"}</span>}
        <span className="copilot2-answer-time">{kstDate(msg.at)}</span>
      </div>
      {a.headline && <div className="copilot2-sec-headline">{clean(a.headline)}</div>}
      {a.summary && <div className="copilot2-sec-summary">{clean(a.summary)}</div>}

      {a.actions?.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">지금 해야 할 일</div>
          {a.actions.map((x, i) => (
            <div key={i} className="copilot2-action">
              <span className={`copilot2-pri ${sevCls(x.priority)}`}>{x.priority === "high" ? "높음" : x.priority === "medium" ? "보통" : "낮음"}</span>
              <div className="min-w-0 flex-1">
                <div className="copilot2-action-title">{clean(x.title)}{x.href && <a href={x.href} className="copilot2-action-link">바로가기 →</a>}</div>
                <div className="copilot2-action-detail">{clean(x.detail)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {a.risks?.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">위험 신호</div>
          {a.risks.map((x, i) => (
            <div key={i} className="copilot2-risk">
              <span className={`copilot2-badge ${sevCls(x.severity)}`}>{x.severity === "high" ? "위험" : x.severity === "medium" ? "주의" : "참고"}</span>
              <div className="min-w-0 flex-1"><div className="copilot2-risk-title">{clean(x.title)}</div><div className="copilot2-action-detail">{clean(x.detail)}</div></div>
            </div>
          ))}
        </div>
      )}

      {a.opportunities?.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">기회</div>
          {a.opportunities.map((x, i) => (
            <div key={i} className="copilot2-opp"><span aria-hidden>💡</span><div><div className="copilot2-risk-title">{clean(x.title)}</div><div className="copilot2-action-detail">{clean(x.detail)}</div></div></div>
          ))}
        </div>
      )}

      {a.evidence?.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">근거 데이터</div>
          <div className="copilot2-evidence-grid">
            {a.evidence.map((x, i) => (
              <div key={i} className="copilot2-evidence"><div className="copilot2-evidence-label">{clean(x.label)}</div><div className="copilot2-evidence-value">{clean(x.value)}</div></div>
            ))}
          </div>
        </div>
      )}
      {msg.asOf && <div className="copilot2-answer-foot">기준 시각 {msg.asOf} · AI 답변은 참고용이며 실행 전 확인이 필요합니다.</div>}
    </div>
  );
}

function LoadingCard({ stage }: { stage: number }) {
  return (
    <div className="copilot2-answer copilot2-answer-loading">
      <div className="copilot2-answer-head">
        <span className="copilot2-answer-spark" aria-hidden>✦</span>
        <span className="copilot2-answer-title">AI 분석 결과</span>
        <span className="copilot2-thinking" aria-hidden><i /><i /><i /></span>
      </div>
      <div className="copilot2-load-stage">{LOAD_STAGES[stage]}</div>
      <div className="copilot2-skel copilot2-skel-lg" />
      <div className="copilot2-skel" />
      <div className="copilot2-skel copilot2-skel-sm" />
    </div>
  );
}

function TokenCard({ usage, pct, gaugeTone, estQuestions, model }: { usage: Usage | null | undefined; pct: number; gaugeTone: string; estQuestions: number; model: string }) {
  const R = 52, C = 2 * Math.PI * R;
  const clamped = Math.min(100, Math.max(0, pct));
  const off = C - (clamped / 100) * C;
  return (
    <div className="copilot2-token-card">
      <div className="copilot2-token-head">
        <span className="copilot2-token-title">AI 토큰 사용량</span>
        <span className="copilot2-live"><span className="copilot2-live-dot" aria-hidden />실시간</span>
      </div>
      <div className="copilot2-token-plan">{usage?.plan_name || "—"}</div>

      <div className="copilot2-gauge-wrap">
        <svg viewBox="0 0 120 120" className="copilot2-gauge">
          <circle cx="60" cy="60" r={R} className="copilot2-gauge-track" />
          <circle cx="60" cy="60" r={R} className={`copilot2-gauge-fill ${gaugeTone}`}
            strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)" />
        </svg>
        <div className="copilot2-gauge-center">
          <div className="copilot2-gauge-pct">{usage?.usage_percent != null ? `${usage.usage_percent}%` : "—"}</div>
          <div className="copilot2-gauge-sub">사용</div>
        </div>
      </div>

      <div className="copilot2-token-nums">
        <div><span className="copilot2-token-used">{usage ? fmt(usage.used_tokens) : "—"}</span> <span className="copilot2-token-slash">/ {usage?.monthly_limit != null ? fmt(usage.monthly_limit) : "—"} tokens</span></div>
        <div className="copilot2-token-remain">{usage ? fmt(usage.remaining_tokens) : "—"} tokens 남음</div>
      </div>

      <div className="copilot2-token-rows">
        <div className="copilot2-token-row"><span>예상 질문 가능</span><b>약 {fmt(estQuestions)}회</b></div>
        <div className="copilot2-token-row"><span>현재 모델</span><b>{model}</b></div>
        <div className="copilot2-token-row"><span>초기화</span><b>{kstDay(usage?.reset_at)}</b></div>
        <div className="copilot2-token-row"><span>마지막 갱신</span><b>{usage?.as_of ? new Date(usage.as_of).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) : "—"}</b></div>
      </div>

      {usage?.usage_percent != null && usage.usage_percent >= 90 && (
        <div className="copilot2-token-warn">사용량이 {usage.usage_percent}%입니다. 곧 한도에 도달합니다.</div>
      )}
    </div>
  );
}
