"use client";
import { kstDateStr } from '@/lib/kst';

// 견적서/계약서 표시 컴포넌트 (단일 소스).
//   - 공유링크 페이지(src/app/share/page.tsx) 와 발송 전 미리보기 모달이
//     같은 레이아웃을 쓰도록 분리.
//   - "내용" 본문은 ASCII 표 노출 패턴(┌─┐│└─┘ 박스 드로잉 / 마크다운 파이프
//     테이블)을 자동 stripping — items 배열은 위쪽 HTML 표가 표시하므로
//     본문은 텍스트 단락만 남김. 기존 견적서/계약서 호환.

export type DocCompany = {
  name?: string | null;
  representative?: string | null;
  business_number?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type DocForRender = {
  name?: string | null;
  document_number?: string | null;
  created_at?: string | null;
  content?: string | null;
  content_type?: string | null;
  contract_amount?: number | null;
  content_json?: any;
};

/**
 * 본문에서 ASCII 박스 드로잉 / 마크다운 파이프 테이블 줄을 제거.
 *   - 박스 드로잉(┌─┐│└─┘├┤┬┴┼): 라인 전체가 박스 문자/공백뿐이면 drop
 *   - 마크다운 헤더 구분선 (`---|---|---`): drop
 *   - 양 끝이 `|` 이고 파이프가 3개 이상인 행: drop (테이블 데이터 행)
 *  텍스트 단락(부가세/합계금액/유효기간 등)은 영향 없음.
 */
export function stripAsciiTable(body: string): string {
  if (!body) return body;
  return body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // 박스 드로잉 only
      if (t.length > 0 && /^[┌┐└┘├┤┬┴┼─│\s]+$/.test(t)) return false;
      // 마크다운 헤더 구분선
      if (/^[\s|:\-]+$/.test(t) && t.includes("|") && t.includes("-")) return false;
      // 파이프 테이블 데이터 행 (|...|...| with 3+ pipes)
      if (t.startsWith("|") && t.endsWith("|") && (t.match(/\|/g) || []).length >= 3) return false;
      return true;
    })
    // 중복 빈줄 압축
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function DocumentRender({
  doc,
  company,
}: {
  doc: DocForRender;
  company: DocCompany | null;
}) {
  const contentJson = doc?.content_json || {};
  const items = contentJson.items || [];
  const paymentSchedule = contentJson.paymentSchedule || [];
  const contentType = doc?.content_type || contentJson?.type || "";
  const isQuote = contentType === "invoice" || contentType === "quote";
  const isContract = contentType === "contract";
  const contractTotal = Number(contentJson.contractTotal || doc?.contract_amount || 0);

  // 본문 텍스트 — items/payment 표가 위쪽에 이미 있으면 본문에서 ASCII 표 제거.
  const rawBody = doc?.content || contentJson.body || contentJson.content || "";
  const cleanedBody = items.length > 0 || paymentSchedule.length > 0 ? stripAsciiTable(rawBody) : rawBody;

  return (
    <div className="document-render">
      {/* Header */}
      <div className="doc-header-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">{company?.name || ""}</div>
            <h1 className="text-xl font-bold text-gray-900">{doc?.name || "문서"}</h1>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">{doc?.document_number || ""}</div>
            <div className="text-xs text-gray-400 mt-1">
              {doc?.created_at ? kstDateStr(new Date(doc.created_at)) : ""}
            </div>
          </div>
        </div>

        {/* Company info */}
        {company && (
          <div className="doc-company-info">
            <div><span className="font-semibold text-gray-500">발신:</span> {company.name}</div>
            <div><span className="font-semibold text-gray-500">대표:</span> {company.representative || "-"}</div>
            <div><span className="font-semibold text-gray-500">사업자번호:</span> {company.business_number || "-"}</div>
            <div><span className="font-semibold text-gray-500">연락처:</span> {company.phone || "-"}</div>
            {company.address && (
              <div className="col-span-2"><span className="font-semibold text-gray-500">주소:</span> {company.address}</div>
            )}
          </div>
        )}
      </div>

      {/* Quote Items */}
      {isQuote && items.length > 0 && (
        <div className="doc-items-card">
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
          <div className="doc-items-summary">
            <span className="text-gray-500">
              공급가액:{" "}
              <span className="font-semibold text-gray-900">
                ₩{items.reduce((s: number, it: any) => s + Number(it.supplyAmount || it.amount || 0), 0).toLocaleString()}
              </span>
            </span>
            <span className="text-gray-500">
              VAT:{" "}
              <span className="font-semibold text-gray-900">
                ₩{items.reduce((s: number, it: any) => s + Number(it.taxAmount || 0), 0).toLocaleString()}
              </span>
            </span>
            <span className="text-blue-600 font-bold">
              합계: ₩{items
                .reduce(
                  (s: number, it: any) =>
                    s +
                    Number(
                      it.totalAmount ||
                        Number(it.supplyAmount || it.amount || 0) + Number(it.taxAmount || 0),
                    ),
                  0,
                )
                .toLocaleString()}
            </span>
          </div>
          {isQuote && contentJson.validUntil && (
            <div className="mt-2 text-[11px] text-gray-400 text-right">
              견적 유효기한: {kstDateStr(new Date(contentJson.validUntil))}
            </div>
          )}
        </div>
      )}

      {/* Payment Schedule (both quote and contract) */}
      {(isContract || isQuote) && paymentSchedule.length > 0 && (
        <div className="doc-payment-schedule-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">결제조건</h2>
            {/* v4 D3: 부가세 별도 표기 — 표 상단 캡션 */}
            <span className="text-[10px] text-gray-500 font-medium">금액·총액은 모두 <span className="text-gray-700">부가세(VAT) 별도</span></span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left">구분</th>
                <th className="px-3 py-2 text-right">비율</th>
                <th className="px-3 py-2 text-right">금액 <span className="text-[9px] font-normal text-gray-400">(VAT 별도)</span></th>
                <th className="px-3 py-2 text-left">지급조건</th>
              </tr>
            </thead>
            <tbody>
              {paymentSchedule.map((t: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-semibold">{t.label || "-"}</td>
                  <td className="px-3 py-2 text-right">{t.ratio ?? 0}%</td>
                  <td className="px-3 py-2 text-right">₩{Number(t.amount || 0).toLocaleString()}</td>
                  <td className="px-3 py-2">{t.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 pt-3 border-t text-right text-xs font-bold text-gray-900">
            계약 총액: ₩{contractTotal.toLocaleString()} <span className="text-[10px] text-gray-500 font-normal">(부가세 별도)</span>
          </div>
        </div>
      )}

      {/* Document Content */}
      <div className="doc-body-card">
        <h2 className="text-sm font-bold text-gray-900 mb-3">내용</h2>
        <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
          {cleanedBody || "(내용 없음)"}
        </div>
        {contentJson.notes && (
          <div className="doc-notes">
            <span className="font-semibold">비고:</span> {contentJson.notes}
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentRender;
