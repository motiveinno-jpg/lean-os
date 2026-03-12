"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  recordQuoteViewByToken,
  recordQuoteResponseByToken,
  getQuoteStatusInfo,
  formatQuoteAmount,
  QuoteTrackingRecord,
} from "@/lib/quote-tracking";
import { supabase } from "@/lib/supabase";
import { ToastProvider, useToast } from "@/components/toast";

export default function QuoteViewPage() {
  return (
    <ToastProvider>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <QuoteViewContent />
      </Suspense>
    </ToastProvider>
  );
}

function QuoteViewContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [trackingRecord, setTrackingRecord] = useState<QuoteTrackingRecord | null>(null);
  const [document, setDocument] = useState<any>(null);

  // Response state
  const [responseNote, setResponseNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [responded, setResponded] = useState(false);
  const [respondedWith, setRespondedWith] = useState<"approved" | "rejected" | "">("");

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        // Record view and get tracking record
        const record = await recordQuoteViewByToken(token);
        setTrackingRecord(record);

        // Fetch associated document with company info
        const { data: doc, error: docError } = await (supabase as any)
          .from("documents")
          .select("*, companies(*)")
          .eq("id", record.document_id)
          .single();

        if (docError) throw docError;
        setDocument(doc);
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleResponse = async (response: "approved" | "rejected") => {
    if (!token) return;
    setSubmitting(true);
    try {
      const updated = await recordQuoteResponseByToken(token, response, responseNote || undefined);
      setTrackingRecord(updated);
      setResponded(true);
      setRespondedWith(response);
      toast(response === "approved" ? "견적서가 승인되었습니다." : "견적서가 거부되었습니다.", "success");
    } catch (err: any) {
      toast(err?.message || "응답 처리에 실패했습니다.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (invalid || !trackingRecord) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">유효하지 않은 링크</h1>
          <p className="text-gray-500 text-sm">
            이 견적서 링크가 만료되었거나 존재하지 않습니다.
          </p>
        </div>
      </div>
    );
  }

  const doc = document;
  const company = doc?.companies;
  const contentJson = doc?.content_json || {};
  const items = contentJson.items || [];

  const status = trackingRecord.status;
  const statusInfo = getQuoteStatusInfo(status);
  const isExpired = status === "expired";
  const isAlreadyResponded = status === "approved" || status === "rejected";
  const canRespond = !isExpired && !isAlreadyResponded && !responded;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Status Banner */}
        {isExpired && (
          <div className="bg-gray-100 border border-gray-300 rounded-2xl p-5 mb-4 text-center">
            <div className="text-2xl mb-2">⏰</div>
            <h3 className="text-sm font-bold text-gray-600">견적서 유효기간 만료</h3>
            <p className="text-xs text-gray-400 mt-1">
              이 견적서는 유효기간이 만료되었습니다. 발신자에게 문의해주세요.
            </p>
          </div>
        )}

        {isAlreadyResponded && !responded && (
          <div
            className={`rounded-2xl p-5 mb-4 text-center border ${
              status === "approved"
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="text-2xl mb-2">{status === "approved" ? "✅" : "❌"}</div>
            <h3
              className={`text-sm font-bold ${
                status === "approved" ? "text-green-800" : "text-red-800"
              }`}
            >
              {status === "approved" ? "이미 승인된 견적서입니다" : "이미 거부된 견적서입니다"}
            </h3>
            {trackingRecord.responded_at && (
              <p
                className={`text-xs mt-1 ${
                  status === "approved" ? "text-green-600" : "text-red-600"
                }`}
              >
                응답일: {new Date(trackingRecord.responded_at).toLocaleDateString("ko-KR")}
              </p>
            )}
            {trackingRecord.response_note && (
              <p className="text-xs text-gray-500 mt-2">
                메모: {trackingRecord.response_note}
              </p>
            )}
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs text-gray-400 mb-1">{company?.name || ""}</div>
              <h1 className="text-xl font-bold text-gray-900">
                {trackingRecord.quote_title || doc?.name || "견적서"}
              </h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">{doc?.document_number || ""}</div>
              <div className="text-xs text-gray-400 mt-1">
                {trackingRecord.sent_at
                  ? new Date(trackingRecord.sent_at).toLocaleDateString("ko-KR")
                  : ""}
              </div>
              {trackingRecord.valid_until && (
                <div className="text-xs text-gray-400 mt-1">
                  유효기간: {new Date(trackingRecord.valid_until).toLocaleDateString("ko-KR")}
                </div>
              )}
            </div>
          </div>

          {/* Recipient info */}
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
            <span className="font-semibold">수신:</span>
            <span>
              {trackingRecord.recipient_name}
              {trackingRecord.recipient_company
                ? ` (${trackingRecord.recipient_company})`
                : ""}
            </span>
            <span className="text-blue-400">|</span>
            <span>{trackingRecord.recipient_email}</span>
          </div>

          {/* Company info */}
          {company && (
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-600 bg-gray-50 rounded-xl p-4">
              <div>
                <span className="font-semibold text-gray-500">발신:</span> {company.name}
              </div>
              <div>
                <span className="font-semibold text-gray-500">대표:</span>{" "}
                {company.representative || "-"}
              </div>
              <div>
                <span className="font-semibold text-gray-500">사업자번호:</span>{" "}
                {company.business_number || "-"}
              </div>
              <div>
                <span className="font-semibold text-gray-500">연락처:</span>{" "}
                {company.phone || "-"}
              </div>
              {company.address && (
                <div className="col-span-2">
                  <span className="font-semibold text-gray-500">주소:</span> {company.address}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quote Amount Summary */}
        {trackingRecord.total_amount != null && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">견적 총액</span>
              <span className="text-xl font-bold text-blue-600">
                {formatQuoteAmount(trackingRecord.total_amount, trackingRecord.currency)}
              </span>
            </div>
          </div>
        )}

        {/* Quote Items */}
        {items.length > 0 && (
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
                    <td className="px-3 py-2 text-right">
                      {Number(item.quantity || item.qty || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      ₩{Number(item.unitPrice || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      ₩{Number(item.supplyAmount || item.amount || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 pt-3 border-t border-gray-200 flex justify-end gap-6 text-xs">
              <span className="text-gray-500">
                공급가액:{" "}
                <span className="font-semibold text-gray-900">
                  ₩
                  {items
                    .reduce(
                      (s: number, it: any) =>
                        s + Number(it.supplyAmount || it.amount || 0),
                      0
                    )
                    .toLocaleString()}
                </span>
              </span>
              <span className="text-gray-500">
                VAT:{" "}
                <span className="font-semibold text-gray-900">
                  ₩
                  {items
                    .reduce(
                      (s: number, it: any) => s + Number(it.taxAmount || 0),
                      0
                    )
                    .toLocaleString()}
                </span>
              </span>
              <span className="text-blue-600 font-bold">
                합계: ₩
                {items
                  .reduce(
                    (s: number, it: any) =>
                      s +
                      Number(
                        it.totalAmount ||
                          Number(it.supplyAmount || it.amount || 0) +
                            Number(it.taxAmount || 0)
                      ),
                    0
                  )
                  .toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* Document Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">내용</h2>
          <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
            {doc?.content || contentJson.content || "(내용 없음)"}
          </div>
          {contentJson.notes && (
            <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-800">
              <span className="font-semibold">비고:</span> {contentJson.notes}
            </div>
          )}
          {trackingRecord.note && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
              <span className="font-semibold">발신자 메모:</span> {trackingRecord.note}
            </div>
          )}
        </div>

        {/* Approval/Rejection Section */}
        {canRespond && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-4">
            <h2 className="text-sm font-bold text-gray-900 mb-4">견적서 응답</h2>
            <p className="text-xs text-gray-500 mb-4">
              아래 버튼을 클릭하여 견적서를 승인하거나 거부할 수 있습니다.
            </p>

            <textarea
              value={responseNote}
              onChange={(e) => setResponseNote(e.target.value)}
              placeholder="의견을 입력하세요 (선택)"
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 mb-4 resize-none"
            />

            <div className="flex gap-3">
              <button
                onClick={() => handleResponse("approved")}
                disabled={submitting}
                className="flex-1 py-3 bg-green-500 text-white rounded-xl text-sm font-bold hover:bg-green-600 transition disabled:opacity-40"
              >
                {submitting ? "처리 중..." : "승인"}
              </button>
              <button
                onClick={() => handleResponse("rejected")}
                disabled={submitting}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition disabled:opacity-40"
              >
                {submitting ? "처리 중..." : "거부"}
              </button>
            </div>
          </div>
        )}

        {/* Response confirmation */}
        {responded && (
          <div
            className={`rounded-2xl p-6 mb-4 text-center border ${
              respondedWith === "approved"
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="text-2xl mb-2">
              {respondedWith === "approved" ? "✅" : "❌"}
            </div>
            <h3
              className={`text-sm font-bold ${
                respondedWith === "approved" ? "text-green-800" : "text-red-800"
              }`}
            >
              {respondedWith === "approved"
                ? "견적서가 승인되었습니다"
                : "견적서가 거부되었습니다"}
            </h3>
            <p
              className={`text-xs mt-1 ${
                respondedWith === "approved" ? "text-green-600" : "text-red-600"
              }`}
            >
              담당자에게 알림이 전달됩니다. 감사합니다.
            </p>
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
