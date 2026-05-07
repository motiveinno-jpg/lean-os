"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY = "hometax-active-job-id";

/**
 * Hometax 백그라운드 sync — frontend 측 보조 컴포넌트.
 *
 * 실제 chain 추진은 Supabase pg_cron 'hometax-sync-tick' (매분 cron-tick action 호출)이 담당.
 * 사용자 브라우저/컴퓨터 무관, 페이지 떠나도 OK.
 *
 * 이 컴포넌트는:
 * 1. localStorage 의 activeJobId 가 terminal 상태면 자동 정리 (cleanup).
 * 2. 30초마다 job 상태 확인.
 *
 * pg_cron 매분 1번이라 13개월 = 약 15~25분 소요.
 */
export function HometaxBackgroundChain() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let timer: any = null;

    const checkJob = async () => {
      if (stopped) return;
      const jobId = localStorage.getItem(STORAGE_KEY);
      if (!jobId) {
        timer = setTimeout(checkJob, 60000);
        return;
      }
      try {
        const db = supabase as any;
        const { data: job } = await db.from("hometax_sync_jobs")
          .select("id, status")
          .eq("id", jobId).maybeSingle();
        if (!job || ["completed", "failed", "cancelled"].includes(job.status)) {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.warn("[hometax bg cleanup]", e);
      }
      timer = setTimeout(checkJob, 60000);  // 매분 체크 (cron 주기와 일치)
    };

    checkJob();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
