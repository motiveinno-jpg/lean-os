// 데이터 수집 버튼 30분 쿨타임 — 회사 공유 (2026-07-01)
//   sync_cooldowns(company_id, sync_type, last_run_at) 를 읽어 남은 시간을 계산.
//   record_sync_run RPC 로 클릭 시각을 원자적 upsert → 팀원 전원 화면에 반영.
//   서버 지속(브라우저 무관) — 다른 기기/팀원도 동일하게 비활성화.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export type SyncType = "hometax" | "bank" | "card" | "match";
export const COOLDOWN_MS = 30 * 60 * 1000; // 30분

export const SYNC_LABEL: Record<SyncType, string> = {
  hometax: "세금계산서 불러오기",
  bank: "통장 불러오기",
  card: "카드 불러오기",
  match: "AI 전체 매칭",
};

// 회사의 모든 수집 타입별 마지막 실행 시각(ms). 없으면 0.
async function fetchCooldowns(companyId: string): Promise<Record<string, number>> {
  const { data, error } = await db
    .from("sync_cooldowns")
    .select("sync_type,last_run_at")
    .eq("company_id", companyId);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { sync_type: string; last_run_at: string }[]) {
    out[r.sync_type] = new Date(r.last_run_at).getTime();
  }
  return out;
}

// 클릭 시각 기록(서버 now 반환). 실패해도 원래 동작을 막지 않도록 호출부에서 try 처리.
export async function recordSyncRun(type: SyncType): Promise<void> {
  const { error } = await db.rpc("record_sync_run", { p_sync_type: type });
  if (error) throw error;
}

function fmtRemain(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 1) return `${m}분 후 가능`;
  return `${s}초 후 가능`;
}

export interface SyncCooldown {
  disabled: boolean;      // 쿨타임 중 → 버튼 비활성
  remainingMs: number;
  label: string | null;   // "27분 후 가능" (쿨타임 중일 때만)
  /** 원래 핸들러를 감싸 실행: 쿨타임 중이면 막고, 아니면 클릭 시각 기록 후 실행 */
  run: (fn: () => void | Promise<void>) => Promise<void>;
}

/**
 * 데이터 수집 버튼용 쿨타임 훅.
 * @example
 *   const cd = useSyncCooldown(companyId, "bank");
 *   <button disabled={busy || cd.disabled} onClick={() => cd.run(handleSync)}
 *           className={cd.disabled ? "opacity-40 cursor-not-allowed" : ""}>
 *     {cd.disabled ? `⏳ ${cd.label}` : "🏦 최근 거래 불러오기"}
 *   </button>
 */
export function useSyncCooldown(companyId: string | null | undefined, type: SyncType): SyncCooldown {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sync-cooldowns", companyId],
    queryFn: () => fetchCooldowns(companyId!),
    enabled: !!companyId,
    staleTime: 10_000,
    refetchInterval: 60_000, // 다른 팀원이 누른 경우 반영
  });

  const lastRun = data?.[type] ?? 0;
  const until = lastRun + COOLDOWN_MS;

  const [now, setNow] = useState(() => Date.now());
  const remainingMs = Math.max(0, until - now);
  const disabled = remainingMs > 0;

  // 쿨타임 중에만 1초 틱 (재활성화 카운트다운 갱신)
  useEffect(() => {
    if (!disabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [disabled]);

  const run = async (fn: () => void | Promise<void>) => {
    if (remainingMs > 0) return; // 방어: 쿨타임 중엔 실행 안 함
    // 먼저 클릭 시각 기록(반복 클릭 즉시 차단). 실패해도 원래 동작은 진행.
    try {
      await recordSyncRun(type);
      qc.invalidateQueries({ queryKey: ["sync-cooldowns", companyId] });
      setNow(Date.now());
    } catch {
      /* 기록 실패는 무시 — 수집 자체는 진행 */
    }
    await fn();
  };

  return { disabled, remainingMs, label: disabled ? fmtRemain(remainingMs) : null, run };
}
