"use client";

// 대시보드 자료 상태 — 통장·카드의 마지막 동기화 시각과 미분류 건수를 **그 위젯 머리**에 쓰기 위한 훅 (2026-08-19).
//   예전엔 위젯 위에 '동기화 줄 + 노란 미분류 배너'가 따로 돌았다 → 사장님: "위젯 안으로 — 통장은 통장, 카드는 카드".
//   읽기만 한다(CODEF 호출 없음). 표시 규칙: 점 색 = 6시간 안 초록 / 26시간 넘김 주황 / 최근 성공 없음 빨강.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getRecentCodefSyncLogs } from "@/lib/data-sync";

// sync_logs.sync_type: 수동=codef_bank/codef_card/codef_card_approval/codef_all, cron=codef_*_cron
const BANK_TYPES = ["codef_bank", "codef_bank_cron", "codef_all"];
const CARD_TYPES = ["codef_card", "codef_card_cron", "codef_card_approval", "codef_card_approval_cron", "codef_all"];

export function relTime(iso?: string | null): string {
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

export type ChannelStatus = { label: string; tone: "ok" | "stale" | "fail" | "none"; title: string };

function statusOf(latest: string | null, latestOk: string | null): ChannelStatus {
  if (!latest) return { label: "동기화 이력 없음", tone: "none", title: "아직 동기화한 적이 없습니다 — ↻ 를 누르거나 설정 › API 연동에서 연결하세요." };
  if (!latestOk) return { label: "동기화 실패 중", tone: "fail", title: "최근 동기화가 계속 실패하고 있습니다. 설정 › API 연동에서 연결 상태를 확인하세요." };
  const h = (Date.now() - new Date(latestOk).getTime()) / 3_600_000;
  return { label: relTime(latestOk), tone: h > 26 ? "stale" : "ok", title: h > 26 ? "자동 동기화(하루 2회)가 밀려 있습니다 — ↻ 로 지금 받아올 수 있습니다." : "자동 동기화는 하루 2회(오전·오후). 지금 최신화하려면 ↻." };
}

/** 통장·카드 각각의 마지막 동기화 상태 */
export function useSyncStatus(companyId: string | null) {
  const { data } = useQuery({
    queryKey: ["codef-sync-freshness", companyId],
    queryFn: () => getRecentCodefSyncLogs(companyId!, 15),
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const logs = (data || []) as any[];
  const latestOf = (types: string[]) => logs.find((l) => types.includes(l.sync_type))?.created_at || null;
  const latestOkOf = (types: string[]) => logs.find((l) => types.includes(l.sync_type) && (l.status === "success" || l.status === "partial"))?.created_at || null;
  return {
    bank: statusOf(latestOf(BANK_TYPES), latestOkOf(BANK_TYPES)),
    card: statusOf(latestOf(CARD_TYPES), latestOkOf(CARD_TYPES)),
  };
}

/** 계정과목 미지정(mapping_status=unmapped) 통장·카드 거래 건수 — 각 위젯 머리에 따로 적는다 */
export function useUnclassifiedCounts(companyId: string | null) {
  const { data, refetch } = useQuery({
    queryKey: ["unclassified-count-by-channel", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const db = supabase;
      const [b, c] = await Promise.all([
        db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId!).eq("mapping_status", "unmapped"),
        db.from("card_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId!).eq("mapping_status", "unmapped"),
      ]);
      return { bank: b.count || 0, card: c.count || 0 };
    },
  });
  return { bank: data?.bank ?? 0, card: data?.card ?? 0, refetch };
}

/** 위젯 머리에 붙는 자료 상태 — "● 7시간 전 · 미분류 8,900 · [↻]" */
export function ChannelHead({ status, unclassified, unclassifiedHref, onSync, syncing }: {
  status: ChannelStatus; unclassified: number; unclassifiedHref: string; onSync?: () => void; syncing?: boolean;
}) {
  return (
    <span className="dash-chan" title={status.title}>
      <span className={`dash-chan-dot dash-chan-dot-${status.tone}`} aria-hidden />
      <span className="dash-chan-txt">{status.label}</span>
      {unclassified > 0 && (
        <Link href={unclassifiedHref} className="dash-chan-unc" title="계정과목이 안 정해진 거래 — 누르면 수집·전표에서 정리합니다">· 미분류 <b className="mono-number">{unclassified.toLocaleString("ko")}</b></Link>
      )}
      {onSync && (
        <button type="button" onClick={onSync} disabled={syncing} className="dash-chan-sync" title="지금 동기화" aria-label="지금 동기화">
          <span className={syncing ? "inline-block animate-spin" : ""}>↻</span>
        </button>
      )}
    </span>
  );
}
