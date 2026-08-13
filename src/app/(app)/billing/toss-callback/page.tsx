"use client";

// 토스 카드 등록 결과 수신 화면 (2026-08-06).
//   성공: ?customerKey=&authKey=  → 엣지 함수가 빌링키를 발급·암호화 저장
//   실패: ?code=&message=         → 사유만 보여주고 돌려보낸다
//   이 화면은 결과를 처리하고 곧바로 결제 화면으로 돌아간다.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Ico } from "@/components/ui-icon";

export default function TossCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("카드를 등록하는 중입니다...");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const authKey = params.get("authKey");
    const customerKey = params.get("customerKey");
    const failMessage = params.get("message");

    if (!authKey || !customerKey) {
      // 등록이 취소되면 이어서 결제 예약도 버린다 — 남겨두면 다음 카드 등록 때 예고 없이 결제된다.
      sessionStorage.removeItem("toss-pending-start");
      setState("failed");
      setMessage(failMessage || "카드 등록이 취소되었습니다.");
      return;
    }

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("로그인이 필요합니다");
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-billing-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "issue", authKey, customerKey }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `등록 실패 (HTTP ${res.status})`);

        // 결제하기에서 넘어온 경우 — 등록에 이어 첫 결제까지 여기서 끝낸다 (2026-08-14).
        const pendingRaw = sessionStorage.getItem("toss-pending-start");
        if (pendingRaw) {
          sessionStorage.removeItem("toss-pending-start");
          let pending: { planSlug?: string; billingCycle?: string; authId?: string; ts?: number } | null = null;
          try { pending = JSON.parse(pendingRaw); } catch { /* 손상된 값은 무시 */ }
          // 예약을 만든 그 사용자가 10분 안에 돌아온 경우에만 결제를 잇는다 —
          // 다른 계정 세션·묵은 예약이 예고 없이 결제되는 것을 막는다 (보안 리뷰 H-2).
          const fresh = pending?.authId === session.user?.id
            && typeof pending?.ts === "number" && Date.now() - pending.ts < 10 * 60 * 1000;
          if (pending?.planSlug && fresh) {
            setMessage("카드 등록 완료 — 결제를 진행합니다...");
            const res2 = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-charge`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ mode: "start", planSlug: pending.planSlug, billingCycle: pending.billingCycle || "monthly" }),
            });
            const j2 = await res2.json().catch(() => ({}));
            if (!res2.ok || !j2.ok) {
              // 카드는 등록됐다 — 결제만 실패. 사유를 그대로 보여주고 결제 화면에서 재시도하게 한다.
              throw new Error(`카드는 등록되었지만 결제에 실패했습니다: ${j2?.error || "잠시 후 다시 시도해 주세요"}`);
            }
            setState("done");
            setMessage(j2.chargedNow
              ? "결제가 완료되었습니다! 플랜이 열렸습니다."
              : "카드 등록 완료 — 남은 이용 기간 종료 후 이 카드로 자동 결제됩니다.");
            setTimeout(() => router.replace("/billing"), 1500);
            return;
          }
        }

        setState("done");
        setMessage("카드가 등록되었습니다.");
        setTimeout(() => router.replace("/billing?tab=payment"), 1200);
      } catch (e: any) {
        setState("failed");
        setMessage(e?.message || "카드 등록에 실패했습니다.");
      }
    })();
  }, [params, router]);

  return (
    <div className="toss-callback-panel glass-card">
      <div className="text-4xl mb-3">
        <Ico e={state === "done" ? "✅" : state === "failed" ? "⚠️" : "💳"} />
      </div>
      <div className="text-sm font-bold text-[var(--text)]">
        {state === "done" ? "등록 완료" : state === "failed" ? "등록하지 못했습니다" : "카드 등록 중"}
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-1.5">{message}</div>
      {state === "failed" && (
        <button onClick={() => router.replace("/billing?tab=payment")} className="btn-secondary btn-sm mt-4">
          결제 수단으로 돌아가기
        </button>
      )}
    </div>
  );
}
