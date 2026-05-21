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
  payload: {
    template_name?: string;
    template_snapshot_html?: string;
  } | null;
  deals: { id: string; name: string } | null;
  companies: { name: string; representative: string | null } | null;
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
        const { data, error } = await db
          .from("quote_approvals")
          .select(
            "id, stage, status, recipient_name, signature_method, signed_at_external, signer_ip, signer_user_agent, signed_contract_html, signed_contract_url, signature_data_url, payload, deals(id, name), companies(name, representative)",
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) { setErr("계약서를 찾을 수 없거나 권한이 없습니다."); setLoading(false); return; }
        setRow(data as SignedRow);
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

  // 본문 우선순위 (2026-05-21 fallback 보강):
  //   1) signed_contract_html (양측 서명 합성된 최종본)
  //   2) payload.template_snapshot_html + signature_data_url 즉석 합성 — 단체일괄 합성 누락 fallback
  //   3) 친절 안내
  const sigImg = row.signature_data_url
    ? `<div style="margin-top:40px;text-align:right;page-break-inside:avoid">
         <div style="display:inline-block">
           <div style="font-size:11px;color:#6b7280;margin-bottom:4px">거래처 서명</div>
           <img src="${row.signature_data_url}" style="max-height:80px;max-width:200px;background:#fff;padding:4px"/>
           <div style="font-size:10px;color:#9ca3af;margin-top:4px">
             ${row.recipient_name || ""} · ${row.signed_at_external ? new Date(row.signed_at_external).toLocaleString('ko-KR') : ""}
           </div>
         </div>
       </div>`
    : "";
  const baseHtml = row.payload?.template_snapshot_html || "";
  const html = row.signed_contract_html
    ? row.signed_contract_html
    : baseHtml
      ? baseHtml + sigImg
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

      {/* 계약서 본문 (print-friendly) */}
      <div
        className="bg-white text-gray-900 rounded-xl shadow border border-[var(--border)] p-8 print:shadow-none print:border-0 print:p-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          @page { margin: 18mm; }
        }
      `}</style>
    </div>
  );
}
