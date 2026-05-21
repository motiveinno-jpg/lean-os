// STEP 4 (PR-B) — 견적/계약/진척/완료/정산 단계 외부 승인 라이브러리.
//   DB: quote_approvals (STEP 3 마이그 적용) + RPC 5종.
//   호출자: PR-A /quote/[token] 외부 페이지, PR-C ProjectQuoteStages SendBar / Status,
//          PR-E project-rules.ts (getNextAction 호출자가 latestApproval prop 전달).
//
// 보안:
//   - 평문 token 은 created 직후 createApproval 반환값으로만 노출됨 (UI 가 즉시
//     절대URL `${SITE_URL}/quote/${token}` 만들어 이메일 본문에 사용). 그 외 노출 0.
//   - getLatestApproval 은 token 컬럼 미포함 (RLS 상 select 가능해도 lib 차원에서 차단).
//   - friendlyError 사용. console.log 평문 token 0.
//
// 데이터 모델:
//   - createApproval → quote_approvals 행 1 INSERT, status='draft', token = generate_approval_token RPC.
//   - sendApproval   → status='sent' + sent_at + expires_at + recipient_* UPDATE.
//                       메일 발송은 호출자가 별도 edge function 호출 (PR-D send-signature-email 의 type='quote' 분기).
//   - resendApproval → resend_quote_approval RPC (이전 행 expired 처리 + 새 행 + 새 token).
//   - getLatestApproval → 같은 (deal_id, stage) 최신 1행 (token 제외).
//   - subscribeApprovalStatus → Realtime postgres_changes ON quote_approvals
//                                FILTER deal_id=eq.<dealId> AND stage=eq.<stage>.
//
// 한도/예외: 모든 함수는 RLS 안에서만 동작. 권한 없는 호출은 PG_42501 → friendlyError 처리.

import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/friendly-error';

export type QuoteApprovalStage = 'estimate' | 'contract' | 'progress_report' | 'completion' | 'settlement';
export type QuoteApprovalStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'rejected' | 'expired';

export interface ApprovalLite {
  id: string;
  status: QuoteApprovalStatus;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  expires_at: string | null;
  decision_note: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  // L 계약 서명 (2026-05-21) — contract stage 승인 시 채워짐
  signature_method?: 'draw' | 'type' | 'upload' | 'seal' | 'none' | null;
  signed_at_external?: string | null;
  signer_ip?: string | null;
  has_signed_html?: boolean;          // signed_contract_html 존재 여부 (전체 본문은 별도 페이지에서 fetch)
  signed_contract_url?: string | null; // PDF Storage URL (이번 라운드 NULL)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ──────────────────────────────────────────────────────────
// createApproval
//   stage='estimate' 의 payload 모양: { items, paymentStages, quoteContent }
//   다른 stage 는 다음 라운드.
// ──────────────────────────────────────────────────────────
export async function createApproval(params: {
  dealId: string;
  stage: QuoteApprovalStage;
  payload: Record<string, unknown>;
  partnerId?: string | null;
}): Promise<{ id: string; token: string }> {
  // 0) 현재 사용자 — RLS RESTRICTIVE INSERT WITH CHECK 가 created_by =
  //    current_app_user_id() 또는 is_company_admin() 요구. created_by 누락 시
  //    admin 이 아니면 42501. owner/admin 도 일관성 위해 명시.
  const { data: userRes } = await db.auth.getUser();
  const authId = userRes?.user?.id;
  if (!authId) throw new Error('로그인이 필요합니다');
  const { data: userRow, error: userErr } = await db
    .from('users')
    .select('id')
    .eq('auth_id', authId)
    .maybeSingle();
  if (userErr) throw userErr;
  if (!userRow) throw new Error('사용자 매핑을 찾을 수 없습니다');

  // 1) 회사 격리: deal 에서 company_id 조회 (RLS 가 어차피 차단하지만 INSERT 에 company_id 필수)
  const { data: deal, error: dealErr } = await db
    .from('deals')
    .select('id, company_id, partner_id')
    .eq('id', params.dealId)
    .maybeSingle();
  if (dealErr) throw dealErr;
  if (!deal) throw new Error('프로젝트를 찾을 수 없습니다');

  // 2) 토큰 생성 RPC (auth only)
  const { data: tokenRes, error: tokenErr } = await db.rpc('generate_approval_token');
  if (tokenErr) throw tokenErr;
  const token = String(tokenRes || '');
  if (!token) throw new Error('승인 토큰 생성 실패');

  // 3) INSERT
  const insertRow = {
    company_id: deal.company_id,
    deal_id: params.dealId,
    partner_id: params.partnerId ?? deal.partner_id ?? null,
    stage: params.stage,
    status: 'draft' as QuoteApprovalStatus,
    payload: params.payload as unknown,
    approval_token: token,
    created_by: userRow.id,  // RLS RESTRICTIVE WITH CHECK 통과용
  };
  const { data: inserted, error: insertErr } = await db
    .from('quote_approvals')
    .insert(insertRow)
    .select('id, approval_token')
    .single();
  if (insertErr) throw insertErr;

  // token 은 메모리에서만 호출자에게 전달 (로깅·반환 외 노출 0).
  return { id: inserted.id, token: inserted.approval_token };
}

// ──────────────────────────────────────────────────────────
// sendApproval — status='sent' 로 전환 + 만료 14일 기본
//   메일 발송은 호출자 (PR-C) 가 PR-D edge 호출.
// ──────────────────────────────────────────────────────────
export async function sendApproval(params: {
  approvalId: string;
  recipientEmail: string;
  recipientName?: string;
  expiresInDays?: number;
}): Promise<void> {
  const days = Math.max(1, Math.min(60, params.expiresInDays ?? 14));
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400000);

  const { error } = await db
    .from('quote_approvals')
    .update({
      status: 'sent',
      sent_at: now.toISOString(),
      expires_at: expires.toISOString(),
      recipient_email: params.recipientEmail,
      recipient_name: params.recipientName ?? null,
    })
    .eq('id', params.approvalId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// resendApproval — RPC 가 이전 행 expired 마킹 + 새 행 + 새 token 반환
//   주의: RPC 가 새 approval id 만 반환 — token 은 후속 select 가 아니라
//   호출자가 sendApproval 전에 새 행의 approval_token 컬럼을 다시 읽어야 함.
//   여기서는 RPC 호출 직후 같은 id 의 approval_token 1회 read 후 반환.
// ──────────────────────────────────────────────────────────
export async function resendApproval(params: {
  prevId: string;
  payload?: Record<string, unknown>;
}): Promise<{ id: string; token: string }> {
  const { data: newId, error: rpcErr } = await db.rpc('resend_quote_approval', {
    p_prev_id: params.prevId,
    p_payload: params.payload ?? null,
  });
  if (rpcErr) throw rpcErr;
  const id = String(newId || '');
  if (!id) throw new Error('재발송 실패');

  // 새 행의 token 1회 조회 (RLS 가 작성자/회사구성원 select 허용)
  const { data: row, error: readErr } = await db
    .from('quote_approvals')
    .select('id, approval_token')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;
  return { id: row.id, token: row.approval_token };
}

// ──────────────────────────────────────────────────────────
// getLatestApproval — (deal_id, stage) 최신 1행, token 컬럼 미포함.
// ──────────────────────────────────────────────────────────
export async function getLatestApproval(
  dealId: string,
  stage: QuoteApprovalStage,
): Promise<ApprovalLite | null> {
  const { data, error } = await db
    .from('quote_approvals')
    .select(
      'id, status, sent_at, viewed_at, decided_at, expires_at, decision_note, recipient_email, recipient_name, signature_method, signed_at_external, signer_ip, signed_contract_url, signed_contract_html',
    )
    .eq('deal_id', dealId)
    .eq('stage', stage)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    reportError('quote-approvals.getLatestApproval', error);
    return null;
  }
  if (!data) return null;
  // signed_contract_html 자체는 ApprovalLite 에 포함 안 함(용량 큼). has_signed_html 만 노출.
  const { signed_contract_html, ...rest } = data as Record<string, unknown> & { signed_contract_html?: string | null };
  return { ...rest, has_signed_html: !!signed_contract_html } as ApprovalLite;
}

// ──────────────────────────────────────────────────────────
// subscribeApprovalStatus — Realtime postgres_changes.
//   리턴: cleanup fn. unmount 시 호출 (memory leak 0).
//   FILTER: deal_id=eq.<dealId> (stage 는 cb 안에서 매칭).
// ──────────────────────────────────────────────────────────
export function subscribeApprovalStatus(
  dealId: string,
  stage: QuoteApprovalStage,
  cb: (row: ApprovalLite | null) => void,
): () => void {
  // 영구 실패(publication 누락 / RLS 거부) 감지용 — 같은 채널이 무한 retry 로
  //   다른 supabase 호출(auth.getUser 등)의 리퀘스트큐를 점거하지 못하게
  //   2회 연속 CHANNEL_ERROR 면 채널 해제 + reportError 1회.
  let errorCount = 0;
  let disabled = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channel = (supabase as any)
    .channel(`quote_approvals_${dealId}_${stage}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'quote_approvals',
        filter: `deal_id=eq.${dealId}`,
      },
      (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const row = (payload.new || payload.old) as Record<string, unknown> | undefined;
        if (!row) return;
        if (row.stage !== stage) return;
        cb({
          id: String(row.id),
          status: String(row.status) as QuoteApprovalStatus,
          sent_at: (row.sent_at as string) ?? null,
          viewed_at: (row.viewed_at as string) ?? null,
          decided_at: (row.decided_at as string) ?? null,
          expires_at: (row.expires_at as string) ?? null,
          decision_note: (row.decision_note as string) ?? null,
          recipient_email: (row.recipient_email as string) ?? null,
          recipient_name: (row.recipient_name as string) ?? null,
        });
      },
    )
    .subscribe((status: string, err?: unknown) => {
      // status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
      if (status === 'SUBSCRIBED') {
        errorCount = 0;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        errorCount += 1;
        // 2회 연속 실패 → 영구 실패로 간주, 채널 해제 (retry 폭증 차단).
        //   publication 미등록·RLS 거부 같은 영구 원인은 retry 무의미하고
        //   리퀘스트큐만 점거 — auth.getUser 504 hang 의 직접 원인.
        if (errorCount >= 2 && !disabled) {
          disabled = true;
          reportError('quote-approvals.subscribeApprovalStatus.channelError', err ?? status);
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabase as any).removeChannel(channel);
          } catch {
            /* noop */
          }
        }
      }
    });

  return () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).removeChannel(channel);
    } catch (e) {
      reportError('quote-approvals.subscribeApprovalStatus.cleanup', e);
    }
  };
}

// ──────────────────────────────────────────────────────────
// STATUS_LABEL — UI 공통 라벨 매핑 (PR-C / PR-E 공유).
// ──────────────────────────────────────────────────────────
export const STATUS_LABEL: Record<QuoteApprovalStatus, string> = {
  draft: '작성됨',
  sent: '발송됨',
  viewed: '거래처가 봄',
  approved: '승인됨',
  rejected: '거절됨',
  expired: '만료',
};

export const STATUS_TONE: Record<QuoteApprovalStatus, 'neutral' | 'info' | 'positive' | 'warn' | 'negative'> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  approved: 'positive',
  rejected: 'negative',
  expired: 'warn',
};
