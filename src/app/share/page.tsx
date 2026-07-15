"use client";

// 2026-07-06 라운드8.1 — /sign, /share 는 외부(비로그인) 서명·공유 링크: 문서를 종이처럼 항상 밝게 보여주는 게
// 의도(뷰어 OS 다크모드와 무관) → 배경/카드는 의도적으로 라이트 하드코딩 유지, var(--bg) 전환 금지.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getShareByToken, recordShareView, submitShareFeedback } from "@/lib/document-sharing";
import { ToastProvider, useToast } from "@/components/toast";
import { DocumentRender } from "@/components/document-render";

export default function SharePage() {
  return (
    <ToastProvider>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <ShareContent />
      </Suspense>
    </ToastProvider>
  );
}

function ShareContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);

  // Feedback state
  const [showFeedback, setShowFeedback] = useState(false);
  const [decision, setDecision] = useState<"approved" | "hold" | "rejected" | "">("");
  const [comment, setComment] = useState("");
  const [responderName, setResponderName] = useState("");
  const [responderEmail, setResponderEmail] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    (async () => {
      const data = await getShareByToken(token);
      if (!data) { setInvalid(true); setLoading(false); return; }
      setShare(data);
      setLoading(false);
      // Record view
      await recordShareView(data.id).catch(() => {});
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (invalid || !share) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="share-invalid-card bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">유효하지 않은 링크</h1>
          <p className="text-gray-500 text-sm">이 문서 링크가 만료되었거나 존재하지 않습니다.</p>
        </div>
      </div>
    );
  }

  const doc = share.documents;
  const company = doc?.companies;

  const handleFeedback = async () => {
    if (!decision) return;
    setSubmitting(true);
    try {
      await submitShareFeedback({
        shareId: share.id,
        decision: decision as 'approved' | 'hold' | 'rejected',
        comment,
        responderName: responderName || undefined,
        responderEmail: responderEmail || undefined,
      });
      setFeedbackSent(true);
    } catch {
      toast('피드백 전송 실패', "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="share-page min-h-screen bg-[var(--bg)] py-8 px-4">
      <div className="share-content max-w-3xl mx-auto">
        <DocumentRender doc={doc} company={company} />

        <div className="h-4" />
        {/* Feedback Section */}
        {share.allow_feedback && !feedbackSent && (
          <div className="share-feedback-card bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
            {!showFeedback ? (
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-3">이 문서에 대해 의견을 보내실 수 있습니다.</p>
                <button onClick={() => setShowFeedback(true)} className="px-6 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 transition">
                  피드백 보내기
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-sm font-bold text-gray-900 mb-4">피드백</h2>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <input
                    value={responderName}
                    onChange={(e) => setResponderName(e.target.value)}
                    placeholder="이름 (선택)"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                  <input
                    value={responderEmail}
                    onChange={(e) => setResponderEmail(e.target.value)}
                    placeholder="이메일 (선택)"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div className="flex gap-2 mb-4">
                  {([
                    { key: 'approved', label: '승인', color: 'bg-green-500' },
                    { key: 'hold', label: '보류', color: 'bg-yellow-500' },
                    { key: 'rejected', label: '거절', color: 'bg-red-500' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setDecision(opt.key)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                        decision === opt.key
                          ? `${opt.color} text-white`
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="의견을 입력하세요 (선택)"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 mb-4 resize-none"
                />
                <button
                  onClick={handleFeedback}
                  disabled={!decision || submitting}
                  className="w-full py-2.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 transition disabled:opacity-40"
                >
                  {submitting ? '전송 중...' : '피드백 전송'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Feedback sent confirmation */}
        {feedbackSent && (
          <div className="share-feedback-sent bg-[var(--success-dim)] border border-[var(--success)]/25 rounded-2xl p-6 mb-4 text-center">
            <div className="text-2xl mb-2">✅</div>
            <h3 className="text-sm font-bold text-[var(--success)]">피드백이 전송되었습니다</h3>
            <p className="text-xs text-[var(--success)] mt-1">감사합니다. 담당자에게 알림이 전달됩니다.</p>
          </div>
        )}

        {/* Footer */}
        <div className="share-footer text-center text-xs text-gray-400 py-4">
          Powered by <span className="font-semibold">OwnerView</span>
        </div>
      </div>
    </div>
  );
}
