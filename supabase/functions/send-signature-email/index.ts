import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// STEP 4 (PR-D): type='quote' 분기 추가.
//   기존 type 없음/='signature' 흐름은 회귀 0 — 기본은 서명 이메일.
//   type='quote' 인 경우 외부 비로그인 견적 승인 페이지(/quote/<token>) CTA + 견적 메타.
//
//   ⚠️ 이 파일은 코드 변경만. prod 재배포는 메인이 사용자 승인 후 별도 1회:
//      npx supabase functions deploy send-signature-email --no-verify-jwt 또는 기존 옵션 유지

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvokeBody {
  type?: "signature" | "quote";
  to: string;
  signerName?: string;
  title: string;
  signUrl: string;
  expiresAt?: string;
  companyName?: string;
  // STEP 4 quote 전용 — 옵션
  amount?: number;            // 총액 (₩)
  items?: Array<{ name?: string; totalAmount?: number; quantity?: number }>;
  representative?: string;    // 발송자 회사 대표
}

function fmtKRW(n: number | undefined | null): string {
  const v = Number(n || 0);
  return `₩${v.toLocaleString("ko-KR")}`;
}

function htmlEscape(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSignatureHtml(p: {
  signerName?: string;
  title: string;
  signUrl: string;
  expiryText: string;
  companyName?: string;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:20px">${htmlEscape(p.companyName || "OwnerView")}</h1>
      <p style="margin:8px 0 0;opacity:0.8;font-size:14px">전자서명 요청</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:15px;margin:0 0 12px">안녕하세요 <strong>${htmlEscape(p.signerName || "담당자")}</strong>님,</p>
      <p style="font-size:14px;color:#6b7280;margin:0 0 20px">아래 문서에 대한 전자서명이 요청되었습니다.</p>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:0;font-size:14px;font-weight:bold">✍️ ${htmlEscape(p.title)}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#9ca3af">서명 기한: ${htmlEscape(p.expiryText)}</p>
      </div>
      <div style="text-align:center;margin:24px 0">
        <a href="${p.signUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:14px">문서 확인 및 서명하기</a>
      </div>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:16px 0 0">서명 기한이 지나면 링크가 만료됩니다.<br>본 이메일은 자동 발송되었습니다.</p>
    </div>
  </body></html>`;
}

function buildQuoteHtml(p: {
  signerName?: string;
  title: string;
  signUrl: string;
  expiryText: string;
  companyName?: string;
  amount?: number;
  items?: Array<{ name?: string; totalAmount?: number; quantity?: number }>;
  representative?: string;
}): string {
  const itemRows = (p.items || []).slice(0, 3).map((it) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#374151">${htmlEscape(it.name || "—")} ${it.quantity ? `× ${Number(it.quantity)}` : ""}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;color:#374151;font-weight:600">${fmtKRW(it.totalAmount)}</td>
    </tr>`).join("");
  const moreCount = (p.items?.length || 0) - 3;
  const moreLine = moreCount > 0 ? `<tr><td colspan="2" style="padding:4px 0;font-size:11px;color:#9ca3af">... 외 ${moreCount}건</td></tr>` : "";
  const repLine = p.representative ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">대표 ${htmlEscape(p.representative)}</p>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:20px">${htmlEscape(p.companyName || "OwnerView")}</h1>
      ${repLine.replace("color:#6b7280", "color:rgba(255,255,255,0.85)")}
      <p style="margin:10px 0 0;opacity:0.9;font-size:14px">견적서 확인 요청</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:15px;margin:0 0 12px">안녕하세요 <strong>${htmlEscape(p.signerName || "담당자")}</strong>님,</p>
      <p style="font-size:14px;color:#6b7280;margin:0 0 20px">아래 견적서를 확인하시고 승인/거절 결정을 부탁드립니다.</p>
      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb">
        <p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#111827">📝 ${htmlEscape(p.title)}</p>
        ${itemRows || moreLine ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${itemRows}${moreLine}</table>` : ""}
        ${p.amount ? `<div style="border-top:1px dashed #d1d5db;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:12px;color:#6b7280">총액 (VAT 포함)</span>
          <span style="font-size:16px;font-weight:800;color:#4f46e5">${fmtKRW(p.amount)}</span>
        </div>` : ""}
        <p style="margin:8px 0 0;font-size:11px;color:#9ca3af">유효 기한: ${htmlEscape(p.expiryText)}</p>
      </div>
      <div style="text-align:center;margin:24px 0">
        <a href="${p.signUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:14px">견적서 확인 및 결정하기</a>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0 0">유효 기한이 지나면 링크가 만료됩니다.<br>승인/거절 결정은 즉시 발송자에게 전달됩니다.<br>본 이메일은 자동 발송되었습니다.</p>
    </div>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as InvokeBody;
    const { type, to, signerName, title, signUrl, expiresAt, companyName, amount, items, representative } = body;

    if (!to || !title || !signUrl) {
      return new Response(
        JSON.stringify({ error: "to, title, signUrl required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiryText = expiresAt
      ? new Date(expiresAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
      : "14일 후";

    // STEP 4: type='quote' 분기. 기본/'signature' 는 기존 흐름 그대로.
    const isQuote = type === "quote";
    const html = isQuote
      ? buildQuoteHtml({ signerName, title, signUrl, expiryText, companyName, amount, items, representative })
      : buildSignatureHtml({ signerName, title, signUrl, expiryText, companyName });

    const subject = isQuote
      ? `[견적서] ${companyName || "OwnerView"} → ${signerName || "담당자"}${amount ? ` (총 ${fmtKRW(amount)})` : ""} (유효 ~${expiryText})`
      : `[${companyName || "OwnerView"}] "${title}" 전자서명 요청`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      // 기존 동작 보존: API 키 없으면 fallback success + signUrl 반환 (UI 가 그대로 표시)
      return new Response(
        JSON.stringify({ success: true, fallback: true, signUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
        to: [to],
        subject,
        html,
      }),
    });

    if (emailRes.ok) {
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      const errText = await emailRes.text();
      return new Response(
        JSON.stringify({ success: false, error: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
