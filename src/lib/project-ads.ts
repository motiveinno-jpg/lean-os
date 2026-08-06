// 프로젝트 ↔ 광고 계정, 그리고 '마케팅 계정 관리' 표 자동 채움 (2026-08-06 사장님 지시)
//
//   키는 회사 금고(설정 > 연동 > 광고 계정)에 한 번만 넣는다. 프로젝트는 **연결만** 한다 —
//   자기 회사 광고만 보는 사람은 한 번 등록해 모든 프로젝트에서 고르고,
//   대행사는 클라이언트별 계정을 여러 개 등록해 각 프로젝트에 매단다.
//
//   표를 채우는 규칙
//     · 행 하나 = 캠페인 하나. 어느 캠페인인지는 예약 키(__ad)로 값에 담는다(칸을 지워도 안 끊긴다).
//     · 채우는 칸은 이름이 아니라 settings.ad 로 찾는다(칸 이름을 바꿔도 자리가 안 어긋난다).
//     · 사람이 더한 칸(메모 등)과 이름은 건드리지 않는다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { AD_VALUE_KEY, adMetricOf, type AdMetricKey, type AdRowLink, type BoardColumn, type BoardItem } from "@/lib/project-boards";
import { todayKst } from "@/lib/kst";

const db = supabase as any;

export type AdAccount = {
  id: string; platform: string; label: string; external_id: string;
  status: string; last_synced_at: string | null; sync_error: string | null;
};

/** 회사가 등록해 둔 광고 계정 전부 */
export async function listAdAccounts(): Promise<AdAccount[]> {
  const data = logRead("project-ads:accounts", await db.from("ad_accounts")
    .select("id, platform, label, external_id, status, last_synced_at, sync_error")
    .order("created_at", { ascending: true }));
  return (data || []) as AdAccount[];
}

/** 이 프로젝트에 매달린 계정 id */
export async function listDealAdAccounts(dealId: string): Promise<string[]> {
  const data = logRead("project-ads:links", await db.from("deal_ad_accounts")
    .select("ad_account_id").eq("deal_id", dealId));
  return ((data || []) as { ad_account_id: string }[]).map((r) => r.ad_account_id);
}

export async function linkAdAccount(dealId: string, companyId: string, adAccountId: string) {
  const { error } = await db.from("deal_ad_accounts")
    .upsert({ deal_id: dealId, ad_account_id: adAccountId, company_id: companyId },
      { onConflict: "deal_id,ad_account_id" });
  if (error) throw new Error(error.message);
}

export async function unlinkAdAccount(dealId: string, adAccountId: string) {
  const { error } = await db.from("deal_ad_accounts").delete()
    .eq("deal_id", dealId).eq("ad_account_id", adAccountId);
  if (error) throw new Error(error.message);
}

/** 볼 기간 — 광고는 '언제부터 언제까지'가 곧 성과라서 표에도 기간이 붙는다 */
export const AD_PERIODS = [
  { key: "7d", label: "최근 7일", days: 7 },
  { key: "30d", label: "최근 30일", days: 30 },
  { key: "month", label: "이번 달", days: 0 },
] as const;
export type AdPeriodKey = typeof AD_PERIODS[number]["key"];

export function periodRange(key: AdPeriodKey): { since: string; until: string } {
  const until = todayKst();
  if (key === "month") return { since: `${until.slice(0, 7)}-01`, until };
  const days = AD_PERIODS.find((p) => p.key === key)?.days || 7;
  const since = new Date(new Date(`${until}T00:00:00`).getTime() - (days - 1) * 86_400_000)
    .toISOString().slice(0, 10);
  return { since, until };
}

export type CampaignRoll = {
  accountId: string; platform: string; campaignId: string; campaignName: string;
  impressions: number; clicks: number; cost: number; conversions: number; convValue: number;
};

/** 기간 안의 캠페인별 합계 — 표에 넣을 한 줄씩 */
export async function rollupCampaigns(accountIds: string[], period: AdPeriodKey): Promise<CampaignRoll[]> {
  if (accountIds.length === 0) return [];
  const { since, until } = periodRange(period);
  const data = logRead("project-ads:metrics", await db.from("ad_metrics_daily")
    .select("ad_account_id, platform, campaign_id, campaign_name, impressions, clicks, cost, conversions, conv_value")
    .in("ad_account_id", accountIds).gte("stat_date", since).lte("stat_date", until));
  const map = new Map<string, CampaignRoll>();
  for (const r of (data || []) as any[]) {
    const key = `${r.ad_account_id}:${r.campaign_id}`;
    const cur = map.get(key) || {
      accountId: r.ad_account_id, platform: r.platform, campaignId: r.campaign_id,
      campaignName: r.campaign_name || r.campaign_id,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0,
    };
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.cost += Number(r.cost) || 0;
    cur.conversions += Number(r.conversions) || 0;
    cur.convValue += Number(r.conv_value) || 0;
    if (r.campaign_name) cur.campaignName = r.campaign_name;
    map.set(key, cur);
  }
  //   많이 쓴 캠페인부터 — 표를 열었을 때 돈이 큰 것이 위에 온다
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

export type DayPoint = { date: string; impressions: number; clicks: number; cost: number; conversions: number };

/** 날짜별 합계 — 리포트의 추이 그림이 쓴다. 집행이 없던 날도 0 으로 채워 줄이 끊기지 않게 한다. */
export async function dailySeries(accountIds: string[], period: AdPeriodKey): Promise<DayPoint[]> {
  if (accountIds.length === 0) return [];
  const { since, until } = periodRange(period);
  const data = logRead("project-ads:daily", await db.from("ad_metrics_daily")
    .select("stat_date, impressions, clicks, cost, conversions")
    .in("ad_account_id", accountIds).gte("stat_date", since).lte("stat_date", until));
  const by = new Map<string, DayPoint>();
  for (const r of (data || []) as any[]) {
    const d = String(r.stat_date).slice(0, 10);
    const cur = by.get(d) || { date: d, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.cost += Number(r.cost) || 0;
    cur.conversions += Number(r.conversions) || 0;
    by.set(d, cur);
  }
  const out: DayPoint[] = [];
  for (let t = new Date(`${since}T00:00:00`).getTime(); t <= new Date(`${until}T00:00:00`).getTime(); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(by.get(d) || { date: d, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  }
  return out;
}

/** 칸 이름으로 지표 알아보기 — settings.ad 표시가 없는 표(먼저 만든 표·칸을 새로 더한 경우)에서도
 *  채워지게 하는 대비책. 표시가 있으면 그쪽이 우선이다. */
const NAME_TO_METRIC: { re: RegExp; key: AdMetricKey }[] = [
  { re: /^매체$|^채널$/, key: "platform" },
  { re: /^노출/, key: "impressions" },
  { re: /클릭률|^CTR$/i, key: "ctr" },
  { re: /^클릭/, key: "clicks" },
  { re: /광고비|^비용$|^집행/, key: "cost" },
  { re: /전환당|^CPA$/i, key: "cpa" },
  { re: /^ROAS$/i, key: "roas" },
  { re: /^전환/, key: "conversions" },
];
function metricOfColumn(c: BoardColumn): AdMetricKey | null {
  const marked = adMetricOf(c);
  if (marked) return marked;
  const name = (c.name || "").trim();
  return NAME_TO_METRIC.find((m) => m.re.test(name))?.key || null;
}

/** 캠페인 한 줄이 각 칸에 넣을 값 */
function valuesOf(roll: CampaignRoll, cols: BoardColumn[]): Record<string, any> {
  const ctr = roll.impressions > 0 ? Math.round((roll.clicks / roll.impressions) * 1000) / 10 : 0;
  const cpa = roll.conversions > 0 ? Math.round(roll.cost / roll.conversions) : 0;
  const roas = roll.cost > 0 ? Math.round((roll.convValue / roll.cost) * 100) : 0;
  const by: Record<string, any> = {
    impressions: roll.impressions, clicks: roll.clicks, ctr, cost: Math.round(roll.cost),
    conversions: roll.conversions, cpa, roas, platform: roll.platform,
  };
  const out: Record<string, any> = {};
  for (const c of cols) {
    const key = metricOfColumn(c);
    if (key && by[key] !== undefined) out[c.id] = by[key];
  }
  return out;
}

/** 표를 채운다 — 있는 줄은 값만 갈고, 없는 캠페인은 줄을 만든다.
 *  사람이 쓴 이름·메모는 건드리지 않는다. 지워진 캠페인의 줄도 지우지 않는다(기록이니까). */
export async function fillAdBoard(args: {
  boardId: string; groupId: string; cols: BoardColumn[]; items: BoardItem[]; rolls: CampaignRoll[];
}): Promise<{ updated: number; created: number }> {
  const { boardId, groupId, cols, items, rolls } = args;
  const linkOf = (it: BoardItem) => (it.values || {})[AD_VALUE_KEY] as AdRowLink | undefined;
  const byKey = new Map<string, BoardItem>();
  for (const it of items) {
    const l = linkOf(it);
    if (l?.campaignId) byKey.set(`${l.accountId}:${l.campaignId}`, it);
  }

  let updated = 0, created = 0;
  const news: any[] = [];
  for (const roll of rolls) {
    const key = `${roll.accountId}:${roll.campaignId}`;
    const hit = byKey.get(key);
    const vals = valuesOf(roll, cols);
    if (hit) {
      const next = { ...(hit.values || {}), ...vals, [AD_VALUE_KEY]: { accountId: roll.accountId, campaignId: roll.campaignId } };
      const { error } = await db.from("project_board_items")
        .update({ values: next, updated_at: new Date().toISOString() }).eq("id", hit.id);
      if (error) throw new Error(error.message);
      updated++;
    } else {
      news.push({
        board_id: boardId, group_id: groupId, name: roll.campaignName,
        position: items.length + news.length,
        values: { ...vals, [AD_VALUE_KEY]: { accountId: roll.accountId, campaignId: roll.campaignId } },
      });
      created++;
    }
  }
  if (news.length > 0) {
    const { error } = await db.from("project_board_items").insert(news);
    if (error) throw new Error(error.message);
  }
  return { updated, created };
}
