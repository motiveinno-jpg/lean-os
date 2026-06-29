import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// STEP 4 (PR-D): type='quote' 분기. 기본/'signature' 는 기존 흐름 그대로.
//   type='quote' 인 경우 외부 비로그인 승인 페이지(/quote/<token>) CTA + 견적 메타.
//
// 2026-05-21 stage 라벨 동적화:
//   견적/계약/진척보고서/완료확인서/정산 단계가 같은 엣지를 공유.
//   stage 가 안 오면 'estimate' 기본 (회귀 0).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type QuoteStage = "estimate" | "contract" | "progress_report" | "completion" | "settlement";

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
  stage?: QuoteStage;         // 단계별 라벨 분기 (default estimate)
  // 2026-05-21 결제단계 % + 금액 표시 (총액 있으면 환산)
  paymentStages?: Array<{ label?: string; ratio?: number; condition?: string }>;
  // 회신 주소(발송 회사 담당자 이메일) — 있으면 reply_to 로 사용해 정당성·도달률 개선.
  replyTo?: string;
}

const STAGE_LABEL_KO: Record<QuoteStage, string> = {
  estimate: "견적서",
  contract: "계약서",
  progress_report: "진척 보고서",
  completion: "완료 확인서",
  settlement: "정산 확인",
};

const STAGE_HEADER_HINT: Record<QuoteStage, string> = {
  estimate: "아래 견적서를 확인하시고 승인/거절 결정을 부탁드립니다.",
  contract: "아래 계약서를 확인하시고 동의/반대 결정을 부탁드립니다.",
  progress_report: "아래 진척 보고서를 확인해 주세요.",
  completion: "아래 완료 확인서를 검토하고 승인/반려 결정을 부탁드립니다.",
  settlement: "아래 정산 내역을 확인하고 승인/이의 여부를 알려주세요.",
};

const STAGE_CTA: Record<QuoteStage, string> = {
  estimate: "견적서 확인 및 결정하기",
  contract: "계약서 확인 및 결정하기",
  progress_report: "진척 보고서 확인하기",
  completion: "완료 확인서 결정하기",
  settlement: "정산 확인하기",
};

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
  stage: QuoteStage;
  paymentStages?: Array<{ label?: string; ratio?: number; condition?: string }>;
}): string {
  const stageLabel = STAGE_LABEL_KO[p.stage] || STAGE_LABEL_KO.estimate;
  const headerHint = STAGE_HEADER_HINT[p.stage] || STAGE_HEADER_HINT.estimate;
  const cta = STAGE_CTA[p.stage] || STAGE_CTA.estimate;

  const itemRows = (p.items || []).slice(0, 3).map((it) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#374151">${htmlEscape(it.name || "—")} ${it.quantity ? `× ${Number(it.quantity)}` : ""}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;color:#374151;font-weight:600">${fmtKRW(it.totalAmount)}</td>
    </tr>`).join("");
  const moreCount = (p.items?.length || 0) - 3;
  const moreLine = moreCount > 0 ? `<tr><td colspan="2" style="padding:4px 0;font-size:11px;color:#9ca3af">... 외 ${moreCount}건</td></tr>` : "";
  const repLine = p.representative ? `<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85)">대표 ${htmlEscape(p.representative)}</p>` : "";

  // 2026-05-21 결제단계 % + 금액 표시 (총액이 있으면 환산, 없으면 % 만)
  const totalForCalc = Number(p.amount || 0);
  const stageRows = (p.paymentStages || [])
    .filter((s) => (s.label || s.ratio || s.condition))
    .map((s, i) => {
      const ratio = Number(s.ratio || 0);
      const amountText = totalForCalc > 0
        ? ` <span style="color:#4f46e5;font-weight:700">(${fmtKRW(Math.round((totalForCalc * ratio) / 100))})</span>`
        : "";
      return `<tr>
        <td style="padding:5px 8px 5px 0;font-size:12px;color:#374151;width:40px">${i + 1}차</td>
        <td style="padding:5px 8px;font-size:12px;color:#374151;font-weight:600">${htmlEscape(s.label || `${i + 1}차`)}</td>
        <td style="padding:5px 8px;font-size:12px;color:#374151;text-align:right;font-weight:600">${ratio}%${amountText}</td>
        <td style="padding:5px 0 5px 8px;font-size:11px;color:#6b7280">${htmlEscape(s.condition || "")}</td>
      </tr>`;
    }).join("");
  const stagesBlock = stageRows
    ? `<div style="margin-top:12px;padding-top:8px;border-top:1px dashed #d1d5db">
         <div style="font-size:11px;color:#6b7280;margin-bottom:4px;font-weight:600">결제 단계 (${(p.paymentStages || []).length}단계)</div>
         <table style="width:100%;border-collapse:collapse">${stageRows}</table>
       </div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:20px">${htmlEscape(p.companyName || "OwnerView")}</h1>
      ${repLine}
      <p style="margin:10px 0 0;opacity:0.9;font-size:14px">${stageLabel} 확인 요청</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:15px;margin:0 0 12px">안녕하세요 <strong>${htmlEscape(p.signerName || "담당자")}</strong>님,</p>
      <p style="font-size:14px;color:#6b7280;margin:0 0 20px">${headerHint}</p>
      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb">
        <p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#111827">📝 ${htmlEscape(p.title)}</p>
        ${itemRows || moreLine ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${itemRows}${moreLine}</table>` : ""}
        ${p.amount ? `<div style="border-top:1px dashed #d1d5db;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:12px;color:#6b7280">총액 (VAT 포함)</span>
          <span style="font-size:16px;font-weight:800;color:#4f46e5">${fmtKRW(p.amount)}</span>
        </div>` : ""}
        ${stagesBlock}
        <p style="margin:8px 0 0;font-size:11px;color:#9ca3af">유효 기한: ${htmlEscape(p.expiryText)}</p>
      </div>
      <div style="text-align:center;margin:24px 0">
        <a href="${p.signUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:14px">${cta}</a>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0 0">유효 기한이 지나면 링크가 만료됩니다.<br>승인/거절 결정은 즉시 발송자에게 전달됩니다.<br>본 이메일은 자동 발송되었습니다.</p>
    </div>
  </body></html>`;
}

// 평문(plaintext) 대체 본문 — HTML 전용 메일은 Daum/Naver 등 한국 ISP 스팸필터가 강하게 감점.
//   text/plain 파트를 함께 보내면 받은편지함 도달률이 크게 개선된다(멀티파트).
function buildText(p: {
  isQuote: boolean; stageLabel: string; signerName?: string; title: string;
  signUrl: string; expiryText: string; companyName?: string; amount?: number;
}): string {
  const who = p.signerName || "담당자";
  const company = p.companyName || "OwnerView";
  const lines: string[] = [];
  lines.push(`안녕하세요 ${who}님,`);
  lines.push("");
  if (p.isQuote) {
    lines.push(`${company} 에서 ${p.stageLabel} 확인을 요청했습니다.`);
  } else {
    lines.push(`${company} 에서 전자서명을 요청했습니다.`);
  }
  lines.push("");
  lines.push(`문서: ${p.title}`);
  if (p.amount) lines.push(`총액(VAT 포함): ₩${Number(p.amount).toLocaleString("ko-KR")}`);
  lines.push(`기한: ${p.expiryText}`);
  lines.push("");
  lines.push(`아래 링크에서 문서를 확인하고 ${p.isQuote ? "결정" : "서명"}해 주세요:`);
  lines.push(p.signUrl);
  lines.push("");
  lines.push("기한이 지나면 링크가 만료됩니다.");
  lines.push("본 메일은 OwnerView 에서 자동 발송되었습니다.");
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as InvokeBody;
    const { type, to, signerName, title, signUrl, expiresAt, companyName, amount, items, representative, stage, paymentStages, replyTo } = body;

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
    const stageNorm: QuoteStage = (stage && STAGE_LABEL_KO[stage]) ? stage : "estimate";
    const stageLabel = STAGE_LABEL_KO[stageNorm];

    const html = isQuote
      ? buildQuoteHtml({ signerName, title, signUrl, expiryText, companyName, amount, items, representative, stage: stageNorm, paymentStages })
      : buildSignatureHtml({ signerName, title, signUrl, expiryText, companyName });

    const subject = isQuote
      ? `[${stageLabel}] ${companyName || "OwnerView"} → ${signerName || "담당자"}${amount ? ` (총 ${fmtKRW(amount)})` : ""} (유효 ~${expiryText})`
      : `[${companyName || "OwnerView"}] "${title}" 전자서명 요청`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      // 기존 동작 보존: API 키 없으면 fallback success + signUrl 반환 (UI 가 그대로 표시)
      return new Response(
        JSON.stringify({ success: true, fallback: true, signUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 평문 대체 본문 (멀티파트) — Daum/Naver 도달률 개선.
    const text = buildText({ isQuote, stageLabel, signerName, title, signUrl, expiryText, companyName, amount });
    // reply_to: 호출자가 발송 회사 담당자 이메일을 주면 사용, 없으면 env, 둘 다 없으면 생략.
    const replyToAddr = replyTo || Deno.env.get("RESEND_REPLY_TO") || undefined;

    const payload: Record<string, unknown> = {
      from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
      to: [to],
      subject,
      html,
      text,
    };
    if (replyToAddr) payload.reply_to = replyToAddr;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
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
