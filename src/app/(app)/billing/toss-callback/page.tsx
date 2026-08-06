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
