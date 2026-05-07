"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY = "hometax-active-job-id";

/**
 * Hometax 백그라운드 sync chain — app-shell 에 마운트.
 * 사용자가 어떤 페이지에 가도 layout 레벨에서 폴링 작동.
 * (브라우저는 열려있어야 — 컴퓨터 끄면 멈춤. 다음 접속 시 재개.)
 *
 * 흐름:
 * 1. tax-invoices 페이지의 sync 시작 시 localStorage 에 activeJobId 저장 (별도 코드).
 * 2. 이 컴포넌트가 layout 마운트 시 localStorage 감지 → polling 시작.
 * 3. 매 step (1개월 처리) 끝나면 다음 step 자동 호출. terminal 시 localStorage 제거.
 * 4. tax-invoices 페이지의 mount 감지 useEffect 가 동시 작동 (이중 안전망 — 동시 차단으로 충돌 자동 회피).
 */
export function HometaxBackgroundChain() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let timer: any = null;

    const advance = async () => {
      if (stopped) return;
      const jobId = localStorage.getItem(STORAGE_KEY);
      if (!jobId) {
        // 활성 job 없음 — 30초 후 다시 체크
        timer = setTimeout(advance, 30000);
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          timer = setTimeout(advance, 30000);
          return;
        }
        // job 상태 확인 — terminal 이면 정리
        const db = supabase as any;
        const { data: job } = await db.from("hometax_sync_jobs")
          .select("id, status, company_id")
          .eq("id", jobId).maybeSingle();
        if (!job || ["completed", "failed", "cancelled"].includes(job.status)) {
          localStorage.removeItem(STORAGE_KEY);
          timer = setTimeout(advance, 30000);
          return;
        }
        // step 호출
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: job.company_id, action: "hometax-job-step", jobId }),
        });
        const result = await res.json().catch(() => ({}));
        if (result?.completed || result?.terminal) {
          localStorage.removeItem(STORAGE_KEY);
        }
        // 30초 후 다음 step — CODEF 측 동시 호출 처리 완전히 끝날 시간 확보 (CF-00016 회피).
        // 1초 짧게 했더니 같은 인증 동시 호출로 인식돼 거부. 30초면 안전.
        timer = setTimeout(advance, 30000);
      } catch (e) {
        // 네트워크 오류 — 5초 후 재시도
        console.warn("[hometax bg chain]", e);
        timer = setTimeout(advance, 5000);
      }
    };

    advance();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
