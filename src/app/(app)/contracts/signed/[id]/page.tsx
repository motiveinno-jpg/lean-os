"use client";

// L 계약: 서명된 계약서 회수 페이지 (회사 내부, 인증 사용자 only)
//   URL: /contracts/signed/<approvalId>
//   RLS quote_approvals_select_admin_or_self 가 회사 격리 + admin/본인 만 허용.
//   signed_contract_html 그대로 렌더 → 사용자가 Ctrl+P 로 PDF 저장 가능.
//
// 보안: token 노출 없음. approval_id 만으로 RLS 체크.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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
  companies: { name: string; representative: string | null; business_number: string | null } | null;
  batch_id?: string | null;
  signer_email?: string | null;
  // partner(을) — signature_requests 분기에서 별도 fetch
  partner: { name: string | null; business_number: string | null; representative: string | null } | null;
}

export default function SignedContractPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [row, setRow] = useState<SignedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setErr("잘못된 주소입니다"); setLoading(false); return; }
    (async () => {
      try {
        // 2026-05-21 dual mode — id 가 quote_approvals 인지 signature_requests 인지 자동 식별
        // 1) quote_approvals 먼저 (단건 견적·계약 흐름)
        const { data: qa } = await db
          .from("quote_approvals")
          .select(
            "id, stage, status, recipient_name, signature_method, signed_at_external, signer_ip, signer_user_agent, signed_contract_html, signed_contract_url, signature_data_url, our_signature_data_url, our_signed_at, payload, deals(id, name), companies(name, representative, business_number)",
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
            "id, status, signer_name, signer_email, signature_method, signature_data_url, signed_contract_html, signed_contract_url, template_snapshot_html, batch_id, signed_at, sent_at, ip_address, partner_id, companies(name, representative, business_number), documents(name)",
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
      <div className="max-w-2xl mx-auto p-10 text-center">
        <div className="text-3xl mb-3">🔒</div>
        <div className="text-sm text-[var(--text)] font-semibold mb-1">{err || "표시할 수 없습니다"}</div>
        <Link href="/projects" className="text-xs text-[var(--primary)] hover:underline mt-3 inline-block">← 프로젝트 목록으로</Link>
      </div>
    );
  }

  // 본문 우선순위 (2026-05-21 푸터 합성 통합):
  //   1) signed_contract_html (양측 서명 합성된 최종본) — 그대로
  //   2) template_snapshot_html (변수 치환된 발송 시점 snapshot) — 그대로
  //   3) 친절 안내
  // 본문 끝 sigImg append 제거: 페이지 측 갑/을 푸터(아래 JSX)가 서명 박스 책임.
  //   이전 e251bcce 의 fallback append 가 푸터와 중복 표시되는 회귀 해소.
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
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* 헤더 — print 시 숨김 */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div>
          <Link href="/projects" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">← 프로젝트 목록</Link>
          <h1 className="text-lg font-bold text-[var(--text)] mt-1">서명된 계약서</h1>
          <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
            {row.deals?.name || "프로젝트"}{row.payload?.template_name ? ` · ${row.payload.template_name}` : ""}
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-semibold transition whitespace-nowrap"
        >
          🖨 인쇄 / PDF 저장
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
          globals.css 의 `body * { visibility: hidden }` 우회 — `.print-area` 만 visible.
          PDF 저장 시 빈 백지 회귀 fix (2026-05-21). */}
      <div className="print-area bg-white text-gray-900 rounded-xl shadow border border-[var(--border)] p-8 print:shadow-none print:border-0 print:p-0 print:rounded-none print:m-0 print:w-full">
        <div dangerouslySetInnerHTML={{ __html: html }} />

        {/* 갑/을 푸터 자동 합성 — 본문에 sig-box 없는 경우만 (자유 본문·옛 양식) */}
        {!/class="sig-box"/.test(html) && (
          <div className="mt-12 pt-6 border-t border-gray-200 grid grid-cols-2 gap-12 print:break-inside-avoid">
            {/* 갑 (우리 회사) */}
            <div>
              <div className="text-sm font-bold mb-2">갑</div>
              <div className="text-xs space-y-1.5">
                <div>회사명: {row.companies?.name || "—"}</div>
                <div>사업자등록번호: {row.companies?.business_number || "—"}</div>
                <div className="flex items-center gap-3 mt-1">
                  <span>대표자: {row.companies?.representative || "—"} (인)</span>
                  <span className="inline-block w-[80px] h-[80px] border border-dashed border-gray-300 rounded relative bg-gray-50 flex-shrink-0">
                    {row.our_signature_data_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.our_signature_data_url} alt="갑 서명" className="absolute inset-0 w-full h-full object-contain p-1" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-400">서명 대기</span>
                    )}
                  </span>
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
                  <span className="inline-block w-[80px] h-[80px] border border-dashed border-gray-300 rounded relative bg-gray-50 flex-shrink-0">
                    {row.signature_data_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.signature_data_url} alt="을 서명" className="absolute inset-0 w-full h-full object-contain p-1" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-400">서명 대기</span>
                    )}
                  </span>
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
    </div>
  );
}
