import { supabase } from '@/lib/supabase';
import { logRead } from '@/lib/log-read';

// 결재 요청 도착 메일 (2026-08-06 사장님 요청: "결재요청 받으면 알림과 함께 메일로")
//   인앱 알림은 이미 가고 있었고, 설정 > 알림에 '결재 요청' 이메일 토글도 이미 있었지만
//   그 설정을 읽어 실제로 메일을 보내는 코드가 없었다 — 켜 놔도 아무 일도 없던 상태.
//
//   발송은 요청자 브라우저에서 한다(계약서·급여명세 메일과 같은 규약). 엣지 함수가
//   호출자 JWT 를 검증하므로 오픈 릴레이가 되지 않는다.
//   수신 거부·수신 주소 판정은 **엣지 함수(service role)** 가 한다 — notification_prefs 는
//   RLS 로 본인 것만 읽히므로 요청자 브라우저에서는 남의 설정을 볼 수 없다.
//   여기서는 수신자의 auth uid 와 계정 이메일(폴백)만 넘긴다.
//   메일 실패는 결재 흐름을 절대 막지 않는다 — 인앱 알림이 이미 1차 통보다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ApprovalMailKind = 'requested' | 'stage_advanced' | 'reassigned' | 'reference';

const KIND_SUBJECT: Record<ApprovalMailKind, string> = {
  requested: '새 결재 요청',
  stage_advanced: '결재 차례',
  reassigned: '승인자 지정',
  reference: '참조 통보',
};

type UserRow = { id: string; name: string | null; email: string | null; auth_id: string | null };

/**
 * 결재 관련 메일을 여러 수신자에게 보낸다. 실패해도 예외를 던지지 않는다.
 * @returns 엣지 함수가 200 을 준 건수(수신 거부로 건너뛴 건 포함)
 */
export async function sendApprovalMails(params: {
  userIds: string[];
  kind: ApprovalMailKind;
  title: string;
  requestId: string;
  requesterName?: string;
  amount?: number;
  requestType?: string;
  stage?: number;
  totalStages?: number;
}): Promise<number> {
  const targets = [...new Set(params.userIds)].filter(Boolean);
  if (targets.length === 0) return 0;
  try {
    const users = (logRead('lib/approval-email:users', await db
      .from('users')
      .select('id, name, email, auth_id')
      .in('id', targets)) || []) as UserRow[];
    const recipients = users.filter((u) => (u.email || '').includes('@'));
    if (recipients.length === 0) return 0;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.owner-view.com';
    const link = `${origin}/approvals?request=${params.requestId}`;

    let ok = 0;
    for (const r of recipients) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-approval-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            email: r.email,
            // 수신 거부·수신 주소 재정의는 서버가 이 uid 로 판정한다
            recipientAuthId: r.auth_id || undefined,
            recipientName: r.name || '',
            kind: params.kind,
            kindLabel: KIND_SUBJECT[params.kind],
            actionTitle: params.title,
            actionType: params.requestType || 'approval',
            requesterName: params.requesterName || '',
            amount: params.amount || 0,
            stage: params.stage || 0,
            totalStages: params.totalStages || 0,
            dashboardUrl: link,
          }),
        });
        if (res.ok) ok++;
      } catch {
        // 개별 수신자 실패는 나머지 발송을 막지 않는다
      }
    }
    return ok;
  } catch {
    return 0;
  }
}
