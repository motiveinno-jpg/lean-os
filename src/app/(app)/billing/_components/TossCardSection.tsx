"use client";

// 국내카드(토스페이먼츠) 자동결제 — 1단계: 카드 등록 / 해제 (2026-08-06).
//   카드번호는 우리 서버에 들어오지 않는다. 토스 등록창에서 입력 → 우리는 authKey 만 받아
//   엣지 함수(toss-billing-key)가 빌링키를 발급·암호화 저장한다.
//   실제 정기 결제(매월 청구)는 2단계에서 붙인다 — 지금은 카드만 등록된다.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { friendlyError } from "@/lib/friendly-error";
import { Ico } from "@/components/ui-icon";

type CardInfo = { card_company: string | null; card_number_masked: string | null; card_type: string | null; registered_at: string | null };

async function callBillingFn(action: string, payload: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("로그인이 필요합니다");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const res = await fetch(`${url}/functions/v1/toss-billing-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `카드 등록 실패 (HTTP ${res.status})`);
  return json;
}

export function TossCardSection({ companyId, isMaster }: { companyId: string | null | undefined; isMaster: boolean }) {
  const { toast } = useToast();
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  const qc = useQueryClient();
  const [opening, setOpening] = useState(false);
  // 토스 키가 아직 안 들어간 환경에서는 섹션 자체를 감춘다 — 눌러도 안 되는 버튼을 보이지 않게.
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const tossEnabled = !!clientKey;

  // 카드 정보는 RPC 로만 나온다 — 빌링키가 든 테이블은 클라이언트가 아예 못 읽는다.
  const { data: card, isLoading } = useQuery<CardInfo | null>({
    queryKey: ["toss-card", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_toss_card_info", { p_company_id: companyId });
      return (Array.isArray(data) ? data[0] : data) || null;
    },
    enabled: !!companyId && tossEnabled,
  });

  const removeMut = useMutation({
    mutationFn: () => callBillingFn("remove"),
    onSuccess: () => {
      toast("등록된 카드를 해제했습니다", "success");
      qc.invalidateQueries({ queryKey: ["toss-card", companyId] });
    },
    onError: (e: any) => toast(friendlyError(e, "카드 해제 실패"), "error"),
  });

  const startRegister = async () => {
    if (!clientKey) { toast("토스 클라이언트 키가 설정되지 않았습니다 (NEXT_PUBLIC_TOSS_CLIENT_KEY)", "error"); return; }
    setOpening(true);
    try {
      const { customerKey } = await callBillingFn("prepare");
      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey });
      const origin = window.location.origin;
      // 등록 결과는 콜백 화면이 받아 빌링키 발급까지 마무리한다.
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: `${origin}/billing/toss-callback/`,
        failUrl: `${origin}/billing/toss-callback/`,
      });
    } catch (e: any) {
      // 사용자가 등록창을 닫은 건 오류가 아니다.
      if (e?.code === "USER_CANCEL") { setOpening(false); return; }
      toast(friendlyError(e, "카드 등록을 시작하지 못했습니다"), "error");
      setOpening(false);
    }
  };

  const registered = !!card?.registered_at;

  if (!tossEnabled) return null;

  return (
    <div className="billing-toss-card glass-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text)]">국내카드 자동결제</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">국내 발급 카드로 결제하려면 여기에 카드를 등록하세요 (토스페이먼츠).</p>
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">카드 정보를 불러오는 중...</div>
      ) : registered ? (
        <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)] gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[var(--success-dim)] flex items-center justify-center text-[var(--success)] text-lg shrink-0"><Ico e="💳" /></div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[var(--text)] flex items-center gap-2 flex-wrap">
                <span>{card?.card_company || "등록 카드"}</span>
                <span className="mono-number">{card?.card_number_masked || ""}</span>
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {card?.registered_at ? `${new Date(card.registered_at).toLocaleDateString("ko-KR")} 등록` : ""}
              </div>
            </div>
          </div>
          {isMaster && (
            <div className="flex gap-2">
              <button onClick={startRegister} disabled={opening} className="btn-secondary btn-sm disabled:opacity-50">
                {opening ? "여는 중..." : "카드 변경"}
              </button>
              <button
                onClick={async () => {
                  if (!(await confirmDialog({ title: "등록 카드 해제", desc: "이 카드로는 더 이상 자동 결제되지 않습니다. 구독이 유지 중이면 다른 결제수단을 등록해 주세요.", danger: true }))) return;
                  removeMut.mutate();
                }}
                disabled={removeMut.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger-dim)] transition disabled:opacity-50"
              >
                {removeMut.isPending ? "해제 중..." : "해제"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="text-3xl mb-2"><Ico e="🇰🇷" /></div>
          <p className="text-sm font-semibold text-[var(--text-muted)] mb-1">등록된 국내카드가 없습니다</p>
          <p className="text-xs text-[var(--text-dim)]">카드번호는 토스 등록창에서만 입력되며 오너뷰 서버에 저장되지 않습니다</p>
          {isMaster ? (
            <button onClick={startRegister} disabled={opening} className="btn-primary btn-sm mt-4 disabled:opacity-50">
              {opening ? "등록창 여는 중..." : "국내카드 등록"}
            </button>
          ) : (
            <p className="text-[11px] text-[var(--text-dim)] mt-4">결제수단 등록은 마스터만 할 수 있습니다</p>
          )}
        </div>
      )}
      {confirmElement}
    </div>
  );
}
