"use client";

// 2026-05-22 파트너 포털(⑥) — 외부 거래처가 로그인 없이 토큰 링크로 견적·계약 서류 확인.
//   get_partner_portal_context(p_token) SECDEF RPC (anon 허용) 로 조회. 토큰이 유일한 권한.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useModalKeys } from "@/hooks/use-modal-keys";

interface PortalDoc {
  id: string;
  type: string;
  title: string;
  status: string | null;
  created_at: string | null;
  deal_name: string | null;
  payload?: any;
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
  const [openDoc, setOpenDoc] = useState<PortalDoc | null>(null);
  // 문의 남기기
  const [inquiry, setInquiry] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useModalKeys(!!openDoc, () => setOpenDoc(null));

  const submitInquiry = async () => {
    const msg = inquiry.trim();
    if (!msg) return;
    setSending(true);
    try {
      const { data, error } = await (supabase as any).rpc("portal_leave_message", { p_token: token, p_message: msg });
      if (!error && data) { setSent(true); setInquiry(""); }
    } catch { /* noop */ }
    setSending(false);
  };

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
                  <li key={d.id}>
                    <button onClick={() => setOpenDoc(d)} className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-[var(--bg-surface)] transition">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                            {TYPE_LABEL[d.type] || "서류"}
                          </span>
                          <span className="text-sm font-medium text-[var(--text)] truncate">{d.title || d.deal_name || "서류"}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
                          {d.deal_name} {d.created_at ? `· ${String(d.created_at).slice(0, 10)}` : ""} · 눌러서 상세 보기
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {st && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>}
                        <span className="text-[var(--text-dim)]">›</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 문의 남기기 */}
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden mt-4">
          <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-bold text-[var(--text)]">💬 문의 남기기</div>
          <div className="p-5">
            {sent ? (
              <div className="text-sm text-emerald-500 flex items-center gap-2">
                ✅ 문의가 전달되었습니다. 담당자가 확인 후 연락드립니다.
                <button onClick={() => setSent(false)} className="text-xs text-[var(--primary)] hover:underline ml-1">추가 문의</button>
              </div>
            ) : (
              <>
                <textarea
                  value={inquiry}
                  onChange={(e) => setInquiry(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="견적·계약 관련 문의나 요청을 남겨주세요. 담당자에게 전달됩니다."
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--primary)] resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={submitInquiry}
                    disabled={!inquiry.trim() || sending}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
                  >
                    {sending ? "전송 중..." : "문의 보내기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-[10px] text-[var(--text-dim)] text-center mt-4">
          본 페이지는 공유 링크로 접근하며 로그인이 필요 없습니다. 링크를 타인과 공유하지 마세요.
        </p>
      </div>

      {/* 서류 상세 모달 */}
      {openDoc && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setOpenDoc(null)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">{TYPE_LABEL[openDoc.type] || "서류"}</span>
                <span className="text-sm font-bold text-[var(--text)] truncate">{openDoc.title || openDoc.deal_name}</span>
              </div>
              <button onClick={() => setOpenDoc(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <PortalDocBody payload={openDoc.payload} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 서류 payload 렌더 — 견적(items/quoteContent) · 진행보고(report_text) 등 타입별 핵심만
function PortalDocBody({ payload }: { payload: any }) {
  if (!payload || typeof payload !== "object") {
    return <div className="text-sm text-[var(--text-muted)]">상세 내용이 없습니다.</div>;
  }
  const items = Array.isArray(payload.items) ? payload.items : null;
  const krw = (n: any) => `₩${Number(n || 0).toLocaleString("ko-KR")}`;
  return (
    <>
      {payload.quoteContent && (
        <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">{String(payload.quoteContent)}</div>
      )}
      {payload.report_text && (
        <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">{String(payload.report_text)}</div>
      )}
      {payload.progress_pct != null && (
        <div className="text-sm text-[var(--text-muted)]">진행률: <span className="font-bold text-[var(--text)]">{payload.progress_pct}%</span></div>
      )}
      {items && items.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-surface)] text-[var(--text-dim)]">
              <tr>
                <th className="text-left px-3 py-2">항목</th>
                <th className="text-right px-3 py-2">수량</th>
                <th className="text-right px-3 py-2">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => (
                <tr key={i} className="border-t border-[var(--border)]/50">
                  <td className="px-3 py-2 text-[var(--text)]">{it.name || it.item || it.description || "-"}</td>
                  <td className="px-3 py-2 text-right text-[var(--text-muted)]">{it.qty ?? it.quantity ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-medium text-[var(--text)]">{krw(it.amount ?? it.price ?? it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Array.isArray(payload.paymentStages) && payload.paymentStages.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">결제 단계</div>
          <ul className="space-y-1">
            {payload.paymentStages.map((s: any, i: number) => (
              <li key={i} className="flex items-center justify-between text-xs text-[var(--text)]">
                <span>{s.label || s.name || `${i + 1}차`}</span>
                <span className="font-medium">{krw(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!payload.quoteContent && !payload.report_text && !items && (
        <div className="text-sm text-[var(--text-muted)]">표시할 상세 내용이 없습니다. 담당자에게 문의해 주세요.</div>
      )}
    </>
  );
}
