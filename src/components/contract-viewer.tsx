"use client";

// 서명된 계약서 뷰어 — 페이지(/contracts/signed/[id])와 공통 모달(DocumentViewerModal) 공용.
//   id(approvalId 또는 signatureRequestId) prop 으로 dual-mode 조회 → 본문 + 갑/을 서명 박스 + 직인 + 인쇄.
//   기존 페이지 로직을 그대로 추출 (렌더/서명/직인/PDF 무변경). backHref 있으면 ← 목록 링크(페이지 전용).

import { useEffect, useState } from "react";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";
// 갑(우리) 서명·도장 추가 모달 — 거래처 서명 모달 동일 컴포넌트 재사용
import { SignatureCapture, type SignatureMethod } from "@/components/signature-capture";
import { useToast } from "@/components/toast";
import { usePrintIsolation } from "@/lib/use-print-isolation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * 본문 html 에서 "거래처 서명" 영역 + 갑 직인 append 블록 sanitize.
 *   배경: 옛/신규 발송본의 signed_contract_html·template_snapshot_html 에 sig 카드·갑 직인이
 *   본문 끝에 박혀있어 페이지 푸터의 갑/을 박스와 중복 표시.
 *   페이지 측 sanitize 로 데이터 무변경 + 양쪽 즉시 깨끗.
 */
function stripBodySignatureArea(rawHtml: string): string {
  if (!rawHtml) return rawHtml;

  if (typeof DOMParser === 'undefined') {
    // SSR fallback — 정규식: text-align:right + display:inline-block 패턴 통째 매칭
    return rawHtml.replace(
      /<div[^>]*style="[^"]*(?:margin-top:\s*\d+px[^"]*text-align:\s*right|text-align:\s*right[^"]*margin-top:\s*\d+px)[^"]*"[^>]*>\s*<div[^>]*style="[^"]*display:\s*inline-block[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
      ''
    );
  }

  try {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    // 1) display:inline-block wrapper 중 sig 시그니처(img base64 또는 "거래처 서명" 텍스트) 매칭
    doc.querySelectorAll('div[style*="display:inline-block"], div[style*="display: inline-block"]')
      .forEach((el) => {
        const hasDataImg = !!el.querySelector('img[src^="data:image"]');
        // 갑 직인 append 블록(injectOurSeal) — <img alt="직인"> + "회사명 (인)". 본문 중복 제거, 하단 푸터에만 표시.
        const hasSealImg = !!el.querySelector('img[alt="직인"]');
        const hasSigText = /거래처\s*서명/.test(el.textContent || '');
        if (hasDataImg || hasSealImg || hasSigText) {
          // wrapper 의 외부 부모가 text-align:right 라면 그 부모까지 같이 제거 (실제 sig 카드 구조)
          const parent = el.parentElement;
          if (parent && /text-align:\s*right/i.test(parent.getAttribute('style') || '')) {
            parent.remove();
          } else {
            el.remove();
          }
        }
      });

    // 2) fallback — display:inline-block 없는 옛 합성본 대응
    //    "거래처 서명" 텍스트노드 → 가까운 div/section 3단계 상향 제거
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const targets: Element[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && /거래처\s*서명/.test(node.nodeValue)) {
        let el: Element | null = node.parentElement;
        for (let i = 0; i < 3 && el; i++) {
          if (['DIV', 'SECTION', 'P', 'TABLE'].includes(el.tagName)) {
            if (!targets.includes(el)) targets.push(el);
            break;
          }
          el = el.parentElement;
        }
      }
    }
    targets.forEach((t) => { try { t.remove(); } catch { /* already removed */ } });

    return doc.body.innerHTML;
  } catch {
    return rawHtml;
  }
}

interface SignedRow {
  id: string;
  _source: 'quote_approval' | 'signature_request';
  stage: string;
  status: string;
  recipient_name: string | null;
  signature_method: string | null;
  signed_at_external: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  signed_contract_html: string | null;
  signed_contract_url: string | null;
  signature_data_url?: string | null;
  template_snapshot_html: string | null;
  // 갑 (우리 회사) 서명 — quote_approvals 에만 컬럼 존재. signature_requests 는 null
  our_signature_data_url: string | null;
  our_signed_at: string | null;
  payload: {
    template_name?: string;
    template_snapshot_html?: string;
    // 외부 서명자(을) 직접 입력 정보 (quote_approvals 흐름)
    signer_company_name?: string;
    signer_business_number?: string;
    signer_representative?: string;
  } | null;
  deals: { id: string; name: string } | null;
  // companies(갑): business_number 포함
  companies: { name: string; representative: string | null; business_number: string | null; seal_url?: string | null } | null;
  batch_id?: string | null;
  signer_email?: string | null;
  // partner(을) — signature_requests 분기에서 별도 fetch
  partner: { name: string | null; business_number: string | null; representative: string | null } | null;
}

export function ContractViewer({ id, backHref }: { id: string; backHref?: string }) {
  usePrintIsolation();
  const [row, setRow] = useState<SignedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // 갑(우리) 서명·도장 추가 모달
  const [showOurSignModal, setShowOurSignModal] = useState(false);
  const [ourSigMethod, setOurSigMethod] = useState<SignatureMethod | null>(null);
  const [ourSigDataUrl, setOurSigDataUrl] = useState<string | null>(null);
  const [submittingOurSig, setSubmittingOurSig] = useState(false);
  const { toast } = useToast();

  const submitOurSignature = async () => {
    if (!row || !ourSigMethod || !ourSigDataUrl) return;
    setSubmittingOurSig(true);
    try {
      const isReq = row._source === 'signature_request';
      const { data: res, error } = await db.rpc(
        isReq ? 'submit_our_signature_for_request' : 'submit_our_signature',
        isReq
          ? { p_signature_request_id: row.id, p_signature_method: ourSigMethod, p_signature_data_url: ourSigDataUrl }
          : { p_approval_id: row.id, p_signature_method: ourSigMethod, p_signature_data_url: ourSigDataUrl }
      );
      if (error) throw error;
      if (res && res.ok === false) throw new Error(res.code || '서명 적용 실패');
      // 로컬 row 갱신 (재조회 대신 in-memory)
      setRow({
        ...row,
        our_signature_data_url: ourSigDataUrl,
        our_signed_at: new Date().toISOString(),
      });
      setShowOurSignModal(false);
      setOurSigMethod(null);
      setOurSigDataUrl(null);
      toast('우리 서명이 적용되었습니다', 'success');
    } catch (e) {
      toast(friendlyError(e, '서명 적용 실패'), 'error');
    } finally {
      setSubmittingOurSig(false);
    }
  };

  useEffect(() => {
    if (!id) { setErr("잘못된 주소입니다"); setLoading(false); return; }
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        // dual mode — id 가 quote_approvals 인지 signature_requests 인지 자동 식별
        // 1) quote_approvals 먼저 (단건 견적·계약 흐름)
        const { data: qa } = await db
          .from("quote_approvals")
          .select(
            "id, stage, status, recipient_name, signature_method, signed_at_external, signer_ip, signer_user_agent, signed_contract_html, signed_contract_url, signature_data_url, our_signature_data_url, our_signed_at, payload, deals(id, name), companies(name, representative, business_number, seal_url)",
          )
          .eq("id", id)
          .maybeSingle();
        if (qa) {
          setRow({
            ...qa,
            _source: 'quote_approval',
            template_snapshot_html: qa.payload?.template_snapshot_html ?? null,
            // 을(거래처) 정보 — payload.signer_* 우선
            partner: {
              name: qa.payload?.signer_company_name ?? qa.recipient_name ?? null,
              business_number: qa.payload?.signer_business_number ?? null,
              representative: qa.payload?.signer_representative ?? null,
            },
          } as SignedRow);
          setLoading(false);
          return;
        }

        // 2) signature_requests fallback (단체일괄 흐름) + partner_id 별도 fetch
        const { data: sr } = await db
          .from("signature_requests")
          .select(
            "id, status, signer_name, signer_email, signature_method, signature_data_url, signed_contract_html, signed_contract_url, template_snapshot_html, batch_id, signed_at, sent_at, ip_address, partner_id, companies(name, representative, business_number, seal_url), documents(name)",
          )
          .eq("id", id)
          .maybeSingle();
        if (sr) {
          // 을(거래처) 정보 — partner_id 로 partners 별도 조회 (관리자 컨텍스트, 회사구성원 RLS 통과)
          let partnerInfo: { name: string | null; business_number: string | null; representative: string | null } = {
            name: sr.signer_name ?? null,
            business_number: null,
            representative: null,
          };
          if (sr.partner_id) {
            const { data: p } = await db
              .from("partners")
              .select("name, business_number, representative")
              .eq("id", sr.partner_id)
              .maybeSingle();
            if (p) {
              partnerInfo = {
                name: p.name ?? sr.signer_name ?? null,
                business_number: p.business_number ?? null,
                representative: p.representative ?? null,
              };
            }
          }
          setRow({
            id: sr.id,
            _source: 'signature_request',
            stage: 'contract',
            status: sr.status,
            recipient_name: sr.signer_name,
            signer_email: sr.signer_email,
            signature_method: sr.signature_method,
            signed_at_external: sr.signed_at,
            signer_ip: sr.ip_address ?? null,
            signer_user_agent: null,
            signed_contract_html: sr.signed_contract_html,
            signed_contract_url: sr.signed_contract_url,
            signature_data_url: sr.signature_data_url,
            template_snapshot_html: sr.template_snapshot_html,
            // signature_requests 는 회사(갑) 서명 컬럼 없음 — null
            our_signature_data_url: null,
            our_signed_at: null,
            payload: { template_name: sr.documents?.name },
            deals: null,
            companies: sr.companies || null,
            batch_id: sr.batch_id,
            partner: partnerInfo,
          } as SignedRow);
          setLoading(false);
          return;
        }

        setErr("계약서를 찾을 수 없거나 권한이 없습니다.");
        setLoading(false);
      } catch (e: unknown) {
        reportError("contract.signed.fetch", e);
        setErr(friendlyError(e, "계약서를 불러오지 못했습니다."));
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중…</div>;
  if (err || !row) {
    return (
      <div className="p-10 text-center">
        <div className="text-3xl mb-3">🔒</div>
        <div className="text-sm text-[var(--text)] font-semibold mb-1">{err || "표시할 수 없습니다"}</div>
        {backHref && (
          <Link href={backHref} className="text-xs text-[var(--primary)] hover:underline mt-3 inline-block">← 돌아가기</Link>
        )}
      </div>
    );
  }

  // 본문 우선순위:
  //   1) signed_contract_html (양측 서명 합성된 최종본) — 그대로
  //   2) template_snapshot_html (변수 치환된 발송 시점 snapshot) — 그대로
  //   3) 친절 안내
  const baseHtml = row.template_snapshot_html || row.payload?.template_snapshot_html || "";
  const html = row.signed_contract_html
    ? row.signed_contract_html
    : baseHtml
      ? baseHtml
      : "<div style='padding:40px;text-align:center;color:#6b7280'>서명된 계약서 본문이 저장되지 않았습니다. 발송자에게 문의하세요.</div>";
  const methodLabel = row.signature_method === "draw" ? "손글씨 서명"
                     : row.signature_method === "type" ? "타이핑 서명"
                     : row.signature_method === "upload" || row.signature_method === "seal" ? "도장/사인"
                     : "—";
  const signedAt = row.signed_at_external
    ? new Date(row.signed_at_external).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "—";

  return (
    <div className="space-y-4">
      {/* 헤더 — print 시 숨김 */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div>
          {backHref && (
            <Link href={backHref} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">← 프로젝트 목록</Link>
          )}
          <h1 className="text-lg font-bold text-[var(--text)] mt-1">서명된 계약서</h1>
          <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
            {row.deals?.name || "프로젝트"}{row.payload?.template_name ? ` · ${row.payload.template_name}` : ""}
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="btn-primary whitespace-nowrap"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      {/* 감사 메타 — print 시 숨김 */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 print:hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <div>
            <div className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] mb-0.5">서명 방식</div>
            <div className="text-[var(--text)] font-semibold">{methodLabel}</div>
          </div>
          <div>
            <div className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] mb-0.5">서명자</div>
            <div className="text-[var(--text)] font-semibold">{row.recipient_name || "—"}</div>
          </div>
          <div>
            <div className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] mb-0.5">서명 시각 (KST)</div>
            <div className="text-[var(--text)] font-semibold">{signedAt}</div>
          </div>
          <div>
            <div className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] mb-0.5">서명자 IP</div>
            <div className="text-[var(--text)] font-mono text-[10px]">{row.signer_ip || "—"}</div>
          </div>
        </div>
        {row.signer_user_agent && (
          <div className="mt-2 text-[10px] text-[var(--text-dim)] truncate" title={row.signer_user_agent}>
            UA: {row.signer_user_agent}
          </div>
        )}
      </div>

      {/* 계약서 본문 (print-friendly) — 양식 안에 sig-box 이미 있으면 푸터 중복 회피.
          globals.css 의 `body * { visibility: hidden }` 우회 — `.print-area` 만 visible. */}
      <div className="print-area bg-white text-gray-900 rounded-xl shadow border border-[var(--border)] p-8 print:shadow-none print:border-0 print:p-0 print:rounded-none print:m-0 print:w-full">
        <div dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(stripBodySignatureArea(html)) }} />

        {/* 갑/을 푸터 자동 합성 — 본문에 sig-box 없는 경우만 (자유 본문·옛 양식) */}
        {!/class="sig-box"/.test(html) && (
          <div className="mt-12 pt-6 border-t border-gray-200 grid grid-cols-2 gap-12 print:break-inside-avoid">
            {/* 갑 (우리 회사) — 우리 서명 없으면 회사 직인(seal_url) fallback 표시(을 손글씨와 대칭) */}
            <div>
              <div className="text-sm font-bold mb-2 flex items-center gap-2">
                <span>갑</span>
                {!row.our_signature_data_url && !row.companies?.seal_url && (
                  <button
                    onClick={() => setShowOurSignModal(true)}
                    className="px-2 py-0.5 text-[10px] bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded font-semibold print:hidden"
                    title="우리 서명·도장 추가"
                  >
                    📝 우리 서명
                  </button>
                )}
              </div>
              <div className="text-xs space-y-1.5">
                <div>회사명: {row.companies?.name || "—"}</div>
                <div>사업자등록번호: {row.companies?.business_number || "—"}</div>
                <div className="flex items-center gap-3 mt-1">
                  <span>대표자: {row.companies?.representative || "—"} (인)</span>
                  <SignatureBox dataUrl={row.our_signature_data_url || row.companies?.seal_url || null} />
                </div>
                {row.our_signed_at && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    {new Date(row.our_signed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </div>
                )}
              </div>
            </div>

            {/* 을 (거래처) */}
            <div>
              <div className="text-sm font-bold mb-2">을</div>
              <div className="text-xs space-y-1.5">
                <div>회사명: {row.partner?.name || row.recipient_name || "—"}</div>
                <div>사업자등록번호: {row.partner?.business_number || "—"}</div>
                <div className="flex items-center gap-3 mt-1">
                  <span>대표자: {row.partner?.representative || "—"} (인)</span>
                  <SignatureBox dataUrl={row.signature_data_url ?? null} />
                </div>
                {row.signed_at_external && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    {new Date(row.signed_at_external).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          @page { margin: 18mm; }
        }
      `}</style>

      {/* 갑(우리) 서명·도장 추가 모달 */}
      {showOurSignModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 print:hidden"
          onClick={() => !submittingOurSig && setShowOurSignModal(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="text-sm font-bold">📝 갑(우리 회사) 서명·도장</div>
              <button
                onClick={() => !submittingOurSig && setShowOurSignModal(false)}
                disabled={submittingOurSig}
                className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5">
              <SignatureCapture
                onChange={(m, d) => { setOurSigMethod(m); setOurSigDataUrl(d); }}
              />
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                onClick={() => setShowOurSignModal(false)}
                disabled={submittingOurSig}
                className="px-4 py-1.5 text-xs bg-[var(--bg)] text-[var(--text-muted)] rounded-lg"
              >
                취소
              </button>
              <button
                onClick={submitOurSignature}
                disabled={submittingOurSig || !ourSigMethod || !ourSigDataUrl}
                className="btn-primary"
              >
                {submittingOurSig ? '적용 중...' : '서명 적용'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 푸터 서명 박스 — base64 data URL 이미지 안전 렌더.
//   - alt="" : 깨진 이미지일 때 "을 서명" 같은 텍스트 노출 차단
//   - onError : 깨진 src 자동 숨김 → "서명 대기" placeholder 자연 fallback
function SignatureBox({ dataUrl }: { dataUrl: string | null | undefined }) {
  const [broken, setBroken] = useState(false);
  const showImg = !!dataUrl && !broken;
  return (
    <span className="relative inline-block w-[80px] h-[80px] border border-dashed border-gray-300 rounded bg-gray-50 flex-shrink-0 overflow-hidden align-middle">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl!}
          alt=""
          onError={() => setBroken(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-400">
          서명 대기
        </span>
      )}
    </span>
  );
}
