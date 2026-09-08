// 카카오 알림톡 공용 발송기 — 중계사는 NHN Cloud(알림톡 v2.3). 모든 엣지 함수가 이 하나를 쓴다.
//   키가 없으면 보내지 않고 notification_logs 에 skipped 로만 남긴다(그래서 키만 넣으면 그대로 켜진다).
//   수신자 계정의 알림 설정(notification_prefs.prefs.kakao)을 따르고, 번호는 직원 기록(employees.phone)에서 찾는다.
//   이메일을 대체하지 않는다 — 호출하는 쪽은 메일을 먼저 보내고 이건 덤으로 부른다(실패해도 메일 결과에 영향 없음).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tfetch } from "./http.ts";

export type AlimtalkTemplate =
  | "approval_request" | "approval_result" | "payslip_ready" | "contract_sign"
  | "tax_invoice" | "expense_approved" | "daily_report";

/** 카카오 심사에 올릴 문구와 같아야 한다. 변수는 #{이름}. */
export const ALIMTALK_TEMPLATES: Record<AlimtalkTemplate, { title: string; body: string; event: string }> = {
  approval_request: { title: "결재 요청", event: "approval_pending",
    body: "#{company_name} #{approver_name}님, #{requester_name}님이 #{action_type} 건(#{action_title})의 결재를 요청했습니다. 오너뷰에서 확인해주세요." },
  approval_result: { title: "결재 결과", event: "approval_pending",
    body: "#{company_name} #{recipient_name}님, #{action_type} 건(#{action_title})이 #{result}되었습니다." },
  payslip_ready: { title: "급여명세서", event: "payslip_ready",
    body: "#{company_name} #{employee_name}님, #{month}월 급여명세서가 발급되었습니다. 오너뷰에서 확인해주세요." },
  contract_sign: { title: "전자계약 서명 요청", event: "contract_sign",
    body: "#{company_name}에서 #{contract_title} 서명을 요청했습니다. 오너뷰에서 확인 후 서명해주세요." },
  tax_invoice: { title: "세금계산서 발행", event: "tax_invoice",
    body: "#{company_name}에서 #{invoice_title} 세금계산서를 발행했습니다. 공급가액 #{amount}원." },
  expense_approved: { title: "경비 승인", event: "approval_pending",
    body: "#{company_name} #{recipient_name}님, #{expense_title} 경비 #{amount}원이 승인되었습니다." },
  daily_report: { title: "자금일보", event: "daily_report",
    body: "[#{company_name} 자금일보 #{report_date}]\n카드지출 #{card_out}원\n은행출금 #{bank_out}원\n은행입금 #{bank_in}원\n매입계산서 #{purchase_invoices}원\n매출계산서 #{sales_invoices}원\n잔액 #{balance}원" },
};

export function renderAlimtalk(template: AlimtalkTemplate, variables: Record<string, string>): { title: string; body: string } {
  const t = ALIMTALK_TEMPLATES[template];
  let body = t.body;
  for (const [k, v] of Object.entries(variables)) body = body.replaceAll(`#{${k}}`, v ?? "");
  return { title: t.title, body };
}

export function isAlimtalkConfigured(): boolean {
  return !!(Deno.env.get("KAKAO_ALIMTALK_API_KEY") && Deno.env.get("KAKAO_SECRET_KEY") && Deno.env.get("KAKAO_SENDER_KEY"));
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export function digits(v: unknown): string {
  return String(v ?? "").replace(/[^0-9]/g, "");
}

/** 회사 안에서 이 사람의 휴대전화 — 직원 기록(employees.phone)에서 계정 연결 → 이메일 순으로 찾는다 */
export async function resolvePhone(companyId: string, who: { authId?: string | null; userId?: string | null; email?: string | null }): Promise<string | null> {
  const db = admin();
  let userId = who.userId || null;
  let email = who.email || null;
  if (!userId && who.authId) {
    //   계정 표(users)에는 전화번호 칸이 없다(auth.users.phone 은 별개). 직원 기록으로 잇기 위한 id·이메일만 읽는다.
    const { data } = await db.from("users").select("id, email").eq("auth_id", who.authId).maybeSingle();
    if (data) { userId = data.id; email = email || data.email; }
  }
  if (userId) {
    const { data } = await db.from("employees").select("phone").eq("company_id", companyId).eq("user_id", userId).not("phone", "is", null).limit(1).maybeSingle();
    if (data && digits(data.phone).length >= 10) return digits(data.phone);
  }
  if (email) {
    const { data } = await db.from("employees").select("phone").eq("company_id", companyId).ilike("email", email).not("phone", "is", null).limit(1).maybeSingle();
    if (data && digits(data.phone).length >= 10) return digits(data.phone);
  }
  return null;
}

/** 수신자 계정의 카카오톡 알림 설정. 설정이 없으면 켜진 것으로 본다(기본값과 같음). */
export async function kakaoPrefAllows(authId: string | null | undefined, event: string): Promise<boolean> {
  if (!authId) return true;
  const { data } = await admin().from("notification_prefs").select("prefs").eq("user_id", authId).maybeSingle();
  const k = (data?.prefs as any)?.kakao;
  if (!k) return true;
  if (k.enabled === false) return false;
  if (k.events && k.events[event] === false) return false;
  return true;
}

export type AlimtalkResult = { sent: boolean; status: "sent" | "failed" | "skipped"; reason?: string; requestId?: string | null };

/** 한 사람에게 한 통. 실패해도 throw 하지 않는다. */
export async function sendAlimtalk(args: {
  companyId: string | null;
  template: AlimtalkTemplate;
  phone: string | null | undefined;
  variables: Record<string, string>;
  recipientAuthId?: string | null;
  skipPrefCheck?: boolean;
}): Promise<AlimtalkResult> {
  const db = admin();
  const phone = digits(args.phone);
  const rendered = renderAlimtalk(args.template, args.variables);
  const log = async (status: AlimtalkResult["status"], extra: Record<string, unknown> = {}) => {
    await db.from("notification_logs").insert({
      company_id: args.companyId, channel: "kakao_alimtalk", template_code: args.template,
      recipient: phone || "-",   // 표가 recipient 를 비우지 못하게 돼 있다 — 번호를 못 찾은 건은 "-"
      title: rendered.title, body: rendered.body, status,
      external_id: (extra.requestId as string) || null, error_message: (extra.error as string) || null,
      metadata: { variables: args.variables, reason: extra.reason || null },
    }).then(() => {}, () => {});
  };
  if (phone.length < 10) { await log("skipped", { reason: "no_phone" }); return { sent: false, status: "skipped", reason: "no_phone" }; }
  if (!args.skipPrefCheck && !(await kakaoPrefAllows(args.recipientAuthId, ALIMTALK_TEMPLATES[args.template].event))) {
    await log("skipped", { reason: "opted_out" }); return { sent: false, status: "skipped", reason: "opted_out" };
  }
  const appKey = Deno.env.get("KAKAO_ALIMTALK_API_KEY"), secret = Deno.env.get("KAKAO_SECRET_KEY"), senderKey = Deno.env.get("KAKAO_SENDER_KEY");
  if (!appKey || !secret || !senderKey) { await log("skipped", { reason: "not_configured" }); return { sent: false, status: "skipped", reason: "not_configured" }; }
  try {
    const res = await tfetch(`https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/${appKey}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "X-Secret-Key": secret },
      body: JSON.stringify({
        senderKey,
        templateCode: args.template,
        recipientList: [{ recipientNo: phone, templateParameter: args.variables }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data?.header?.isSuccessful === true;
    const requestId = data?.message?.requestId || null;
    if (ok) { await log("sent", { requestId }); return { sent: true, status: "sent", requestId }; }
    const error = data?.header?.resultMessage || `HTTP ${res.status}`;
    await log("failed", { error, requestId });
    return { sent: false, status: "failed", reason: error, requestId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await log("failed", { error });
    return { sent: false, status: "failed", reason: error };
  }
}

/** 회사 이름 — 문구의 #{company_name} */
export async function companyName(companyId: string | null | undefined): Promise<string> {
  if (!companyId) return "";
  const { data } = await admin().from("companies").select("name").eq("id", companyId).maybeSingle();
  return data?.name || "";
}
