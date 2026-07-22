"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

// AI 대표 참모 — 읽기전용 경영 참모. owner-copilot edge 함수 호출(서버가 회사 스코프 스냅샷 생성).
const SUGGESTED = [
  "오늘 챙겨야 할 것 3가지 브리핑해줘",
  "지금 현금흐름 상태 어때?",
  "미수금이랑 수금 우선순위 알려줘",
  "이번 달 처리 안 된 결재·지급·서명 정리해줘",
];

type CopilotResult = { answer: string; as_of: string | null; remaining_tokens?: number };

export default function CopilotPage() {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [planBlocked, setPlanBlocked] = useState(false);

  async function ask(q: string) {
    const query = q.trim();
    if (loading) return;
    setLoading(true);
    setResult(null);
    setPlanBlocked(false);
    try {
      const { data, error } = await supabase.functions.invoke("owner-copilot", {
        body: { question: query },
      });
      if (error) {
        // edge 가 비200 이면 FunctionsHttpError — 본문 코드 파싱
        const ctx = (error as { context?: Response })?.context;
        let code: string | undefined;
        let msg = "AI 참모 호출에 실패했습니다.";
        try {
          const j = ctx ? await ctx.json() : null;
          code = j?.code; msg = j?.error || msg;
        } catch { /* ignore */ }
        if (code === "PLAN_REQUIRED" || code === "NOT_ENTITLED") {
          setPlanBlocked(true);
        } else {
          toast(msg, "error");
        }
        return;
      }
      setResult(data as CopilotResult);
    } catch (err) {
      toast(friendlyError(err, "AI 참모 호출에 실패했습니다."), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="copilot-page">
      <div className="copilot-header">
        <h1 className="copilot-title">AI 대표 참모</h1>
        <p className="copilot-subtitle">
          회사의 실시간 데이터를 근거로 답하는 읽기 전용 경영 참모입니다. 자금·미수·처리 대기·영업 현황을 물어보세요.
        </p>
      </div>

      {planBlocked ? (
        <div className="copilot-upsell">
          <div className="copilot-upsell-title">울트라 · 엔터프라이즈 전용 기능</div>
          <p className="copilot-upsell-desc">대표 참모는 울트라 이상 플랜에서 이용할 수 있습니다.</p>
          <a href="/billing" className="btn-primary btn-sm">플랜 보기</a>
        </div>
      ) : (
        <>
          <div className="copilot-suggested">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => { setQuestion(s); ask(s); }} disabled={loading} className="copilot-chip">
                {s}
              </button>
            ))}
          </div>

          <div className="copilot-input-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(question); }}
              placeholder="회사 상태에 대해 무엇이든 물어보세요"
              disabled={loading}
              className="copilot-input"
            />
            <button onClick={() => ask(question)} disabled={loading || !question.trim()} className="btn-primary">
              {loading ? "분석 중…" : "질문"}
            </button>
          </div>

          {loading && <div className="copilot-loading">회사 데이터를 분석하고 있습니다…</div>}

          {result && (
            <div className="copilot-answer">
              <div className="copilot-answer-body">{result.answer}</div>
              {result.as_of && (
                <div className="copilot-answer-meta">기준: {result.as_of} · AI 답변은 참고용이며 실행 전 확인이 필요합니다.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
