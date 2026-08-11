// 데이터 수집 버튼 30분 쿨타임 — 회사 공유 (2026-07-01)
//   sync_cooldowns(company_id, sync_type, last_run_at) 를 읽어 남은 시간을 계산.
//   서버 지속(브라우저 무관) — 다른 기기/팀원도 동일하게 비활성화.
//
// 2026-08-11 — 요금제별 수집 횟수 추가 (사장님 지시)
//   · 무료 = 하루 2회, **회사 단위**. 종류별로 2회씩 주면 5종 x 2 = 10회라 사실상 무제한이 된다.
//   · 유료 = 횟수 무제한, 대신 30분 쿨타임(종류별). 통장을 받았다고 세금계산서까지 막히면
//     '골라 받기'가 무의미해지므로 쿨타임은 종류별로 유지한다.
//   · 검사·기록은 consume_sync_run RPC 하나에서 원자적으로 한다 — 두 검사를 클라이언트가
//     따로 하면 두 탭에서 동시에 눌렀을 때 한도를 넘길 수 있다.

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

/** 수집 1회 소모 — 쿨타임·횟수를 서버가 한 번에 검사하고 기록한다.
 *  막혔을 때 COOLDOWN:<남은초> / QUOTA:<하루한도> 예외가 온다. */
export async function consumeSyncRun(type: SyncType): Promise<SyncQuota | null> {
  //   생성 타입에 아직 없는 새 RPC — 저장소 다른 곳과 같은 방식으로 캐스팅한다
  const { data, error } = await (db.rpc as any)("consume_sync_run", { p_sync_type: type });
  if (error) throw error;
  return (data as SyncQuota) ?? null;
}

export type SyncQuota = {
  plan: string;
  daily_limit: number | null;   // null = 무제한(유료)
  used_today: number;
  remaining: number | null;     // null = 무제한
};

async function fetchQuota(): Promise<SyncQuota | null> {
  const { data, error } = await (db.rpc as any)("get_sync_status");
  if (error) throw error;
  return (data as SyncQuota) ?? null;
}

/** 서버 예외 메시지를 사람 말로. 못 알아보면 null(= 막을 이유가 아님). */
function blockMessage(message: string): string | null {
  const m = String(message || "");
  const cool = m.match(/COOLDOWN:(\d+)/);
  if (cool) return fmtRemain(Number(cool[1]) * 1000);
  const quota = m.match(/QUOTA:(\d+)/);
  if (quota) return `오늘 ${quota[1]}회 다 썼습니다`;
  return null;
}

function fmtRemain(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 1) return `${m}분 후 가능`;
  return `${s}초 후 가능`;
}

export interface SyncCooldown {
  disabled: boolean;      // 쿨타임 중이거나 오늘 횟수를 다 씀 → 버튼 비활성
  remainingMs: number;
  label: string | null;   // "27분 후 가능" / "오늘 2회 다 썼습니다" (막혔을 때만)
  /** 왜 막혔나 — 툴팁 문구를 갈라 쓰기 위해 */
  reason: "cooldown" | "quota" | null;
  /** 버튼 title 에 그대로 쓸 안내. 안 막혔으면 null */
  hint: string | null;
  /** 무료 플랜의 남은 횟수. 유료(무제한)면 null */
  remainingToday: number | null;
  /** 요금제·사용량 원본 (없으면 아직 조회 전) */
  quota: SyncQuota | null;
  /** 원래 핸들러를 감싸 실행: 막혀 있으면 실행하지 않고 사유를 돌려준다 */
  run: (fn: () => void | Promise<void>) => Promise<void>;
}

/**
 * 데이터 수집 버튼용 쿨타임 훅.
 * @example
 *   const cd = useSyncCooldown(companyId, "bank");
 *   <button disabled={busy || cd.disabled} onClick={() => cd.run(handleSync)}
 *           className={cd.disabled ? "opacity-40 cursor-not-allowed" : ""}>
 *     {cd.disabled ? `⏳ ${cd.label}` : "최근 거래 불러오기"}
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
  //   요금제·오늘 쓴 횟수 — 무료만 한도가 있다(유료는 daily_limit null)
  const { data: quota = null } = useQuery({
    queryKey: ["sync-quota", companyId],
    queryFn: fetchQuota,
    enabled: !!companyId,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const lastRun = data?.[type] ?? 0;
  const until = lastRun + COOLDOWN_MS;

  const [now, setNow] = useState(() => Date.now());
  const remainingMs = Math.max(0, until - now);
  const remainingToday = quota?.daily_limit == null ? null : (quota.remaining ?? 0);
  const outOfQuota = remainingToday !== null && remainingToday <= 0;
  const disabled = remainingMs > 0 || outOfQuota;

  // 쿨타임 중에만 1초 틱 (재활성화 카운트다운 갱신)
  useEffect(() => {
    if (remainingMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [remainingMs]);

  const run = async (fn: () => void | Promise<void>) => {
    if (disabled) return; // 방어: 막혀 있으면 실행 안 함
    //   서버가 쿨타임·횟수를 한 번에 검사하고 기록한다. 여기서 막히면 수집을 시작하지 않는다
    //   — 예전엔 기록 실패를 무시하고 진행했는데, 그러면 한도가 있으나 마나가 된다.
    try {
      await consumeSyncRun(type);
    } catch (e) {
      const why = blockMessage((e as { message?: string })?.message ?? "");
      qc.invalidateQueries({ queryKey: ["sync-cooldowns", companyId] });
      qc.invalidateQueries({ queryKey: ["sync-quota", companyId] });
      if (why) return;          // 한도·쿨타임 — 진행하지 않는다
      await fn();               // 그 밖의 오류(네트워크 등)는 수집을 막지 않는다
      return;
    }
    qc.invalidateQueries({ queryKey: ["sync-cooldowns", companyId] });
    qc.invalidateQueries({ queryKey: ["sync-quota", companyId] });
    setNow(Date.now());
    await fn();
  };

  const label = outOfQuota
    ? `오늘 ${quota?.daily_limit}회 다 썼습니다`
    : remainingMs > 0 ? fmtRemain(remainingMs) : null;
  const reason: "cooldown" | "quota" | null = outOfQuota ? "quota" : remainingMs > 0 ? "cooldown" : null;
  const hint = reason === "quota"
    ? `무료 요금제는 수집이 하루 ${quota?.daily_limit}회까지입니다 — 내일 0시에 다시 채워집니다`
    : reason === "cooldown" ? `30분 쿨타임 — ${label}` : null;

  return { disabled, remainingMs, label, reason, hint, remainingToday, quota, run };
}
