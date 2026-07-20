// 플랫폼 운영자 액션 API 클라이언트 — /platform 화면들에서 공용 사용
export type AdminActionPayload = {
  action:
    | "reset-password" | "reset-link" | "change-email" | "set-role" | "ban" | "unban"
    | "extend-trial" | "change-plan" | "set-subscription-status" | "set-seats";
  userId?: string;
  companyId?: string;
  newEmail?: string;
  role?: string;
  days?: number;
  planSlug?: string;
  status?: string;
  seats?: number;
};

export type AdminActionResult = {
  ok?: boolean;
  error?: string;
  tempPassword?: string;
  link?: string;
  trialEndsAt?: string;
};

export async function platformAdminAction(payload: AdminActionPayload): Promise<AdminActionResult> {
  const res = await fetch("/api/platform/admin-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as AdminActionResult;
  if (!res.ok) return { error: json.error || `요청 실패 (${res.status})` };
  return json;
}
