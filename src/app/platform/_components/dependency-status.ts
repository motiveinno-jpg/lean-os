// 외부 서비스 상태 판정 한 곳 — 외부 서비스 화면(dependencies)과 시스템 상태 신호등(health)이 같이 쓴다.
//   원칙: 실제로 확인한 근거가 있을 때만 "정상"이다. 근거가 없는 항목은 "확인 안 함"으로 둔다
//   (예전엔 Resend·전자서명·Vercel 이 판정 없이 늘 "정상"이었다).
//   근거 ① operator_dependencies_health RPC — DB 에 남은 오류·수집·결제·발송 기록
//        ② /api/health — Vercel 서버 경로가 실제로 응답하는지 + 그 서버가 Stripe API 를 호출해 본 결과

export type DepStatus = "ok" | "warn" | "down" | "unchecked" | "loading";

export type DepsHealthRpc = {
  supabase: { errors_24h: number; errors_1h: number; sample_query_ok?: boolean };
  codef: { bank_tx_24h: number; card_tx_24h: number; note?: string };
  stripe: { paid_invoices_24h: number; failed_invoices_24h: number };
  signatures: { approvals_24h: number; fully_signed_24h: number; requests_sent_24h?: number; send_failures_24h?: number };
  // 발송 결과를 남기는 메일 흐름만(소개 메일·결제 고객 메일·청구 알림). 마이그레이션 적용 전 DB 에는 없다.
  mail?: { sent_24h: number; failed_24h: number };
  at: string;
};

/** /api/health 호출 결과. reached=false 면 서버가 응답하지 않은 것(네트워크 오류). */
export type ApiHealthProbe = {
  reached: boolean;
  httpStatus?: number;
  ms?: number;
  body?: { status?: string; checks?: Record<string, { ok: boolean; ms?: number; note?: string }> } | null;
};

export type DepJudgement = { status: DepStatus; desc: string };

export type DepKey = "supabase" | "codef" | "stripe" | "resend" | "signatures" | "vercel";

export function judgeDependencies(rpc: DepsHealthRpc | null | undefined, api?: ApiHealthProbe | null): Record<DepKey, DepJudgement> {
  const none = (desc: string): DepJudgement => ({ status: "loading", desc });

  const supabase: DepJudgement = !rpc ? none("—") : {
    status: rpc.supabase.errors_1h > 50 ? "warn" : "ok",
    desc: `최근 1시간 오류 ${rpc.supabase.errors_1h}건 / 24시간 ${rpc.supabase.errors_24h}건`,
  };

  const codefTotal = rpc ? rpc.codef.bank_tx_24h + rpc.codef.card_tx_24h : 0;
  const codef: DepJudgement = !rpc ? none("—") : {
    status: codefTotal === 0 ? "warn" : "ok",
    desc: `24시간 통장 거래 ${rpc.codef.bank_tx_24h.toLocaleString()}건 · 카드 거래 ${rpc.codef.card_tx_24h.toLocaleString()}건${codefTotal === 0 ? " · 하루 동안 수집이 없어요" : ""}`,
  };

  // Stripe: 청구 실패 기록 + (있으면) 서버에서 Stripe API 를 실제로 불러 본 결과
  const stripeApi = api?.body?.checks?.stripe;
  const stripe: DepJudgement = !rpc ? none("—") : (() => {
    const failed = rpc.stripe.failed_invoices_24h;
    const base = `24시간 결제 성공 ${rpc.stripe.paid_invoices_24h}건 · 실패/연체 ${failed}건`;
    if (stripeApi && !stripeApi.ok) return { status: "down" as const, desc: `${base} · 서버에서 Stripe API 호출 실패` };
    const apiNote = stripeApi ? ` · API 응답 ${stripeApi.ms ?? "?"}ms` : " · API 호출은 확인 안 함";
    return { status: failed > 5 ? "warn" as const : "ok" as const, desc: base + apiNote };
  })();

  const resend: DepJudgement = !rpc ? none("—") : !rpc.mail ? {
    status: "unchecked",
    desc: "발송 결과 집계가 아직 없어 확인하지 않았습니다",
  } : (() => {
    const { sent_24h: sent, failed_24h: failed } = rpc.mail!;
    const base = `24시간 기록된 발송 ${sent.toLocaleString()}건 · 실패 ${failed.toLocaleString()}건 (소개·결제 메일만 기록)`;
    if (sent === 0 && failed === 0) return { status: "unchecked" as const, desc: "24시간 동안 결과가 기록된 발송이 없어 확인하지 못했습니다 (소개·결제 메일만 기록)" };
    if (sent === 0) return { status: "down" as const, desc: `${base} · 기록된 발송이 모두 실패` };
    return { status: failed > 0 && failed / (sent + failed) >= 0.2 ? "warn" as const : "ok" as const, desc: base };
  })();

  const sig = rpc?.signatures;
  const signatures: DepJudgement = !rpc ? none("—") : sig?.send_failures_24h == null ? {
    status: "unchecked",
    desc: `24시간 결재 요청 ${sig?.approvals_24h ?? 0}건 · 양쪽 서명 완료 ${sig?.fully_signed_24h ?? 0}건 · 발송 실패 집계가 아직 없어 확인하지 않았습니다`,
  } : (() => {
    const sent = sig.requests_sent_24h ?? 0;
    const failed = sig.send_failures_24h ?? 0;
    const base = `24시간 서명 요청 발송 ${sent}건 · 발송 실패 ${failed}건 · 양쪽 서명 완료 ${sig.fully_signed_24h}건`;
    if (failed > 0) return { status: "warn" as const, desc: `${base} · 실패 건은 재발송이 필요해요` };
    if (sent === 0) return { status: "unchecked" as const, desc: `24시간 동안 발송된 서명 요청이 없어 확인하지 못했습니다 · 양쪽 서명 완료 ${sig.fully_signed_24h}건` };
    return { status: "ok" as const, desc: base };
  })();

  // Vercel: /api/health 가 응답했으면 서버 경로가 살아 있는 것. 응답이 없으면 장애 가능성.
  //   (분당 호출 제한 429 도 서버가 응답한 것이다)
  const vercel: DepJudgement = !api ? { status: "unchecked", desc: "서버 경로 응답을 확인하지 않았습니다" }
    : !api.reached ? { status: "down", desc: "서버 경로(/api/health)가 응답하지 않습니다" }
    : (api.httpStatus ?? 0) >= 500 && !api.body
      ? { status: "down", desc: `서버 경로가 오류(${api.httpStatus})로 응답했습니다` }
      : { status: "ok", desc: `서버 경로 응답 ${api.ms ?? "?"}ms${api.httpStatus === 429 ? " · 호출 제한으로 세부 점검은 건너뜀" : ""}` };

  return { supabase, codef, stripe, resend, signatures, vercel };
}

/** /api/health 를 한 번 불러 본다(브라우저 → Vercel 서버). */
export async function probeApiHealth(): Promise<ApiHealthProbe> {
  const t0 = Date.now();
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const ms = Date.now() - t0;
    let body: ApiHealthProbe["body"] = null;
    try { body = await res.json(); } catch { body = null; }
    return { reached: true, httpStatus: res.status, ms, body: res.status === 429 ? null : body };
  } catch {
    return { reached: false, ms: Date.now() - t0 };
  }
}
