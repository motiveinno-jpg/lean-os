import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildSignedContractHtml } from "@/lib/signatures";
import { clientIpFromHeaders } from "@/lib/api-authz";
import { validateSignatureData, validateSignerInputs } from "@/lib/sign-submit-validate";

// 외부 서명자의 제출 — 서명 토큰 하나로 들어오는 공개 경로.
//   서명자가 보낸 계약서 HTML 을 저장하지 않는다. 서버가 보관된 원문 스냅샷에 허용된 입력값(라디오·텍스트 토큰)과
//   서명 이미지/타이핑만 합성해 저장하고, 원문·최종본 SHA-256 과 서버가 본 IP 를 남긴다.
//   DB 함수(submit_signature_by_token)는 service_role 만 부를 수 있다.
export const runtime = "nodejs";

const RATE_PER_MIN = 10;

const hits = new Map<string, { n: number; at: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.at > 60_000) { hits.set(ip, { n: 1, at: now }); return false; }
  cur.n += 1;
  return cur.n > RATE_PER_MIN;
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (rateLimited(ip)) return NextResponse.json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 8 || token.length > 200) return NextResponse.json({ error: "유효하지 않은 토큰" }, { status: 400 });
  const sig = validateSignatureData(body?.signatureData);
  if (!sig.ok) return NextResponse.json({ error: sig.error }, { status: 400 });
  const inputs = validateSignerInputs(body?.signerInputs);
  if (!inputs.ok) return NextResponse.json({ error: inputs.error }, { status: 400 });

  const admin = createSupabaseAdminClient() as any;
  const { data: ex, error: exErr } = await admin.rpc("get_signature_request_by_token", { p_token: token });
  if (exErr || !ex) return NextResponse.json({ error: "서명 요청을 찾을 수 없습니다" }, { status: 404 });
  if (ex.status === "signed") return NextResponse.json({ error: "이미 서명 완료된 요청입니다" }, { status: 409 });
  if (ex.expires_at && new Date(ex.expires_at) < new Date()) return NextResponse.json({ error: "서명 요청이 만료되었습니다" }, { status: 410 });

  const snapshot: string | null = ex.template_snapshot_html || null;
  const signedHtml = buildSignedContractHtml(snapshot, sig.value, ex.signer_name, inputs.value);
  const snapshotHash = snapshot ? createHash("sha256").update(snapshot).digest("hex") : null;

  const { data, error } = await admin.rpc("submit_signature_by_token", {
    p_token: token,
    p_signature_data: sig.value,
    p_signed_contract_html: signedHtml ?? undefined,
    p_signature_method: sig.value.type,
    p_signature_data_url: sig.value.data,
    p_ip: ip,
    p_snapshot_sha256: snapshotHash ?? undefined,
    p_user_agent: req.headers.get("user-agent") || undefined,
  });
  if (error) {
    const msg = String(error.message || "");
    const status = /이미 서명/.test(msg) ? 409 : /만료/.test(msg) ? 410 : /찾을 수 없/.test(msg) ? 404 : /원문이 보관본과/.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg || "서명 제출에 실패했습니다" }, { status });
  }
  if (inputs.value) {
    // 입력값 보관 실패는 서명 완료를 되돌리지 않는다(서명본 HTML 에는 이미 합성돼 있다)
    try { await admin.rpc("save_signer_inputs_by_token", { p_token: token, p_inputs: inputs.value }); } catch { /* 무시 */ }
  }
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, id: result?.id || ex.id });
}
