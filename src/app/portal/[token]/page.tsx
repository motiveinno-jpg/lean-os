"use client";

// 2026-05-22 파트너 포털(⑥) — 외부 거래처가 로그인 없이 토큰 링크로 견적·계약 서류 확인.
//   get_partner_portal_context(p_token) SECDEF RPC (anon 허용) 로 조회. 토큰이 유일한 권한.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface PortalDoc {
  id: string;
  type: string;
  title: string;
  status: string | null;
  created_at: string | null;
  deal_name: string | null;
}
interface PortalCtx {
  partner: { name: string; contact_name: string | null };
  company: { name: string; representative: string | null };
  documents: PortalDoc[];
}

const TYPE_LABEL: Record<string, string> = {
  estimate: "견적서", contract: "계약서", progress_report: "진행보고", completion: "완료보고", settlement: "정산서", document: "서류",
};
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "작성중", cls: "bg-gray-500/15 text-gray-400" },
  sent: { label: "발송됨", cls: "bg-sky-500/15 text-sky-500" },
  approved: { label: "승인", cls: "bg-emerald-500/15 text-emerald-500" },
  rejected: { label: "거절", cls: "bg-rose-500/15 text-rose-500" },
  signed: { label: "서명완료", cls: "bg-emerald-500/15 text-emerald-500" },
};

export default function PartnerPortalPage() {
  const params = useParams();
  const token = String(params?.token || "");
  const [ctx, setCtx] = useState<PortalCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc("get_partner_portal_context", { p_token: token });
        if (error || !data) setError(true);
        else setCtx(data as PortalCtx);
      } catch {
        setError(true);
      }
      setLoading(false);
    })();
  }, [token]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  }
  if (error || !ctx) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-4xl mb-2">🔒</div>
        <div className="text-sm font-semibold text-[var(--text)]">유효하지 않은 링크입니다</div>
        <div className="text-xs text-[var(--text-muted)]">링크가 만료되었거나 잘못되었습니다. 발신자에게 문의해 주세요.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6 mb-4">
          <div className="text-[11px] text-[var(--text-dim)] uppercase tracking-wide">파트너 포털</div>
          <h1 className="text-xl font-extrabold text-[var(--text)] mt-1">{ctx.company.name}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {ctx.partner.name} {ctx.partner.contact_name ? `· ${ctx.partner.contact_name}님` : ""} 께 공유된 서류입니다.
          </p>
        </div>

        {/* 서류 목록 */}
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-bold text-[var(--text)]">
            견적·계약 서류 ({ctx.documents.length})
          </div>
          {ctx.documents.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">공유된 서류가 아직 없습니다.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]/50">
              {ctx.documents.map((d) => {
                const st = d.status ? STATUS_LABEL[d.status] : null;
                return (
                  <li key={d.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                          {TYPE_LABEL[d.type] || "서류"}
                        </span>
                        <span className="text-sm font-medium text-[var(--text)] truncate">{d.title || d.deal_name || "서류"}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
                        {d.deal_name} {d.created_at ? `· ${String(d.created_at).slice(0, 10)}` : ""}
                      </div>
                    </div>
                    {st && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${st.cls}`}>{st.label}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-[10px] text-[var(--text-dim)] text-center mt-4">
          본 페이지는 공유 링크로 접근하며 로그인이 필요 없습니다. 링크를 타인과 공유하지 마세요.
        </p>
      </div>
    </div>
  );
}
