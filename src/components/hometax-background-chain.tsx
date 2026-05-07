"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

// 페이지별 active job key — terminal 시 자동 정리.
const STORAGE_KEYS = ["hometax-active-job-id", "cashreceipt-active-job-id"];

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
      const entries = STORAGE_KEYS
        .map((k) => ({ key: k, id: localStorage.getItem(k) }))
        .filter((e) => e.id);
      if (entries.length === 0) {
        timer = setTimeout(checkJob, 60000);
        return;
      }
      try {
        const db = supabase as any;
        const ids = entries.map((e) => e.id);
        const { data: jobs } = await db.from("hometax_sync_jobs")
          .select("id, status")
          .in("id", ids);
        const byId = new Map<string, any>((jobs || []).map((j: any) => [j.id, j]));
        for (const e of entries) {
          const j = byId.get(e.id as string);
          if (!j || ["completed", "failed", "cancelled"].includes(j.status)) {
            localStorage.removeItem(e.key);
          }
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
