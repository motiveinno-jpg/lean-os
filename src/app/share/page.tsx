"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getShareByToken, recordShareView, submitShareFeedback } from "@/lib/document-sharing";
import { ToastProvider, useToast } from "@/components/toast";

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
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">유효하지 않은 링크</h1>
          <p className="text-gray-500 text-sm">이 문서 링크가 만료되었거나 존재하지 않습니다.</p>
        </div>
      </div>
    );
  }

  const doc = share.documents;
  const company = doc?.companies;
  const contentJson = doc?.content_json || {};
  const items = contentJson.items || [];
  const paymentSchedule = contentJson.paymentSchedule || [];
  const contentType = doc?.content_type || contentJson?.type || '';
  const isQuote = contentType === 'invoice' || contentType === 'quote';
  const isContract = contentType === 'contract';
  const contractTotal = Number(contentJson.contractTotal || doc?.contract_amount || 0);

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
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs text-gray-400 mb-1">{company?.name || ''}</div>
              <h1 className="text-xl font-bold text-gray-900">{doc?.name || '문서'}</h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">{doc?.document_number || ''}</div>
              <div className="text-xs text-gray-400 mt-1">{doc?.created_at ? new Date(doc.created_at).toLocaleDateString('ko-KR') : ''}</div>
            </div>
          </div>

          {/* Company info */}
          {company && (
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 bg-gray-50 rounded-xl p-4">
              <div><span className="font-semibold text-gray-500">발신:</span> {company.name}</div>
              <div><span className="font-semibold text-gray-500">대표:</span> {company.representative || '-'}</div>
              <div><span className="font-semibold text-gray-500">사업자번호:</span> {company.business_number || '-'}</div>
              <div><span className="font-semibold text-gray-500">연락처:</span> {company.phone || '-'}</div>
              {company.address && <div className="col-span-2"><span className="font-semibold text-gray-500">주소:</span> {company.address}</div>}
            </div>
          )}
        </div>

        {/* Quote Items */}
        {isQuote && items.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">품목 내역</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-blue-50 text-blue-700">
                  <th className="px-3 py-2 text-left">No</th>
                  <th className="px-3 py-2 text-left">품목명</th>
                  <th className="px-3 py-2 text-right">수량</th>
                  <th className="px-3 py-2 text-right">단가</th>
                  <th className="px-3 py-2 text-right">공급가액</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 text-right">{Number(item.quantity || item.qty || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₩{Number(item.unitPrice || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₩{Number(item.supplyAmount || item.amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 pt-3 border-t border-gray-200 flex justify-end gap-6 text-xs">
              <span className="text-gray-500">공급가액: <span className="font-semibold text-gray-900">₩{items.reduce((s: number, it: any) => s + Number(it.supplyAmount || it.amount || 0), 0).toLocaleString()}</span></span>
              <span className="text-gray-500">VAT: <span className="font-semibold text-gray-900">₩{items.reduce((s: number, it: any) => s + Number(it.taxAmount || 0), 0).toLocaleString()}</span></span>
              <span className="text-blue-600 font-bold">합계: ₩{items.reduce((s: number, it: any) => s + Number(it.totalAmount || (Number(it.supplyAmount || it.amount || 0) + Number(it.taxAmount || 0))), 0).toLocaleString()}</span>
            </div>
            {isQuote && contentJson.validUntil && (
              <div className="mt-2 text-[11px] text-gray-400 text-right">견적 유효기한: {new Date(contentJson.validUntil).toLocaleDateString('ko-KR')}</div>
            )}
          </div>
        )}

        {/* Payment Schedule (both quote and contract) */}
        {(isContract || isQuote) && paymentSchedule.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">결제조건</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-3 py-2 text-left">구분</th>
                  <th className="px-3 py-2 text-right">비율</th>
                  <th className="px-3 py-2 text-right">금액</th>
                  <th className="px-3 py-2 text-left">지급조건</th>
                </tr>
              </thead>
              <tbody>
                {paymentSchedule.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-semibold">{t.label || '-'}</td>
                    <td className="px-3 py-2 text-right">{t.ratio ?? 0}%</td>
                    <td className="px-3 py-2 text-right">₩{Number(t.amount || 0).toLocaleString()}</td>
                    <td className="px-3 py-2">{t.condition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 pt-3 border-t text-right text-xs font-bold text-gray-900">
              계약 총액: ₩{contractTotal.toLocaleString()}
            </div>
          </div>
        )}

        {/* Document Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">내용</h2>
          <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
            {doc?.content || contentJson.content || '(내용 없음)'}
          </div>
          {contentJson.notes && (
            <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-800">
              <span className="font-semibold">비고:</span> {contentJson.notes}
            </div>
          )}
        </div>

        {/* Feedback Section */}
        {share.allow_feedback && !feedbackSent && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
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
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-4 text-center">
            <div className="text-2xl mb-2">✅</div>
            <h3 className="text-sm font-bold text-green-800">피드백이 전송되었습니다</h3>
            <p className="text-xs text-green-600 mt-1">감사합니다. 담당자에게 알림이 전달됩니다.</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 py-4">
          Powered by <span className="font-semibold">OwnerView</span>
        </div>
      </div>
    </div>
  );
}
