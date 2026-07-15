"use client";

// 데이터 신선도 표시 — 통장/카드가 마지막으로 동기화된 시각을 대시보드에 노출(2026-07-15).
//   자동 동기화(cron 하루 2회)와 수동 동기화 이력을 sync_logs 에서 읽어 "N시간 전"으로 표시.
//   ⚠️ 표시(read)만 — CODEF 자동 호출은 하지 않음(비용·은행 이중로그인 방지). 최신화는 기존 '동기화' 버튼.

import { useQuery } from "@tanstack/react-query";
import { getRecentCodefSyncLogs } from "@/lib/data-sync";

// sync_logs.sync_type: 수동=codef_bank/codef_card/codef_card_approval/codef_all, cron=codef_*_cron
const BANK_TYPES = ["codef_bank", "codef_bank_cron", "codef_all"];
const CARD_TYPES = ["codef_card", "codef_card_cron", "codef_card_approval", "codef_card_approval_cron", "codef_all"];

function rel(iso?: string | null): string {
  if (!iso) return "이력 없음";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d === 1 ? "어제" : `${d}일 전`;
}

export function SyncFreshness({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["codef-sync-freshness", companyId],
    queryFn: () => getRecentCodefSyncLogs(companyId, 15),
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const logs = data || [];
  // logs 는 created_at 내림차순 → 해당 타입 첫 매치가 가장 최근.
  const latestOf = (types: string[]) => logs.find((l) => types.includes(l.sync_type))?.created_at || null;
  const bank = latestOf(BANK_TYPES);
  const card = latestOf(CARD_TYPES);
  const latest = logs[0]?.created_at || null;
  if (!latest) return null; // 동기화 이력이 아직 없으면 표시 안 함(신규/온보딩 방해 X).

  const staleH = (Date.now() - new Date(latest).getTime()) / 3_600_000;
  const stale = staleH > 26; // 자동 동기화가 하루 2회라 26시간 넘게 밀리면 주의 색.

  return (
    <div className="sync-freshness flex items-center gap-1.5 text-[10px] text-[var(--text-dim)]"
      title="자동 동기화는 하루 2회(오전·오후) 실행됩니다. 지금 최신화하려면 '동기화' 버튼을 누르세요.">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stale ? "bg-[var(--warning)]" : "bg-[var(--success)]"}`} />
      <span className="whitespace-nowrap">통장 {rel(bank)} · 카드 {rel(card)} 동기화</span>
    </div>
  );
}
