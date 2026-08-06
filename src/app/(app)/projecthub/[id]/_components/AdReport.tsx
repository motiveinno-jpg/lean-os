"use client";

// 정리 탭의 마케팅 리포트 — 프로젝트에 매달린 광고 계정의 성과를 한 장으로 (2026-08-06 사장님 지시:
//   "정리에서 마케팅 리포트를 보여주는 방식, 기존 운영성과와 비슷한 형식").
//
//   표(마케팅 계정 관리)는 '지금 어떤 캠페인이 어떻게 돌고 있나'를 채우는 자리이고,
//   여기는 '기간 전체로 얼마 쓰고 무엇을 얻었나'를 읽는 자리다. 값은 표가 아니라
//   수집해 둔 일별 기록(ad_metrics_daily)에서 바로 읽는다 — 표를 안 채워도 리포트는 맞는다.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listAdAccounts, listDealAdAccounts, rollupCampaigns, dailySeries,
  AD_PERIODS, periodRange, type AdPeriodKey,
} from "@/lib/project-ads";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const num = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function AdReport({ dealId }: { dealId: string }) {
  const [period, setPeriod] = useState<AdPeriodKey>("30d");

  const { data: accounts = [] } = useQuery({ queryKey: ["ad-accounts-report"], queryFn: listAdAccounts });
  const { data: linked = [] } = useQuery({
    queryKey: ["deal-ad-accounts", dealId], queryFn: () => listDealAdAccounts(dealId), enabled: !!dealId,
  });
  const { data: rolls = [], isLoading: l1 } = useQuery({
    queryKey: ["ad-report-rolls", dealId, linked.join(), period],
    queryFn: () => rollupCampaigns(linked, period), enabled: linked.length > 0,
  });
  const { data: days = [], isLoading: l2 } = useQuery({
    queryKey: ["ad-report-days", dealId, linked.join(), period],
    queryFn: () => dailySeries(linked, period), enabled: linked.length > 0,
  });

  if (linked.length === 0) {
    return (
      <p className="pj-sec-empty">
        이 프로젝트에 광고 계정이 연결돼 있지 않아요 — 표(마케팅 계정 관리)의 ‘계정 고르기’에서 고르면
        여기에 기간 성과가 정리됩니다.
      </p>
    );
  }
  if (l1 || l2) return <p className="pj-sec-empty">불러오는 중…</p>;

  const total = rolls.reduce((a, r) => ({
    imp: a.imp + r.impressions, clk: a.clk + r.clicks, cost: a.cost + r.cost,
    conv: a.conv + r.conversions, val: a.val + r.convValue,
  }), { imp: 0, clk: 0, cost: 0, conv: 0, val: 0 });
  const ctr = total.imp > 0 ? Math.round((total.clk / total.imp) * 1000) / 10 : 0;
  const cpa = total.conv > 0 ? Math.round(total.cost / total.conv) : 0;
  const cpc = total.clk > 0 ? Math.round(total.cost / total.clk) : 0;
  const { since, until } = periodRange(period);
  const maxCost = Math.max(1, ...days.map((d) => d.cost));
  const maxCamp = Math.max(1, ...rolls.map((r) => r.cost));
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.label]));

  if (total.imp === 0 && total.cost === 0) {
    return <p className="pj-sec-empty">{since} ~ {until} 사이에 집행된 광고가 없어요.</p>;
  }

  return (
    <div className="ad-rep">
      <div className="ad-rep-top">
        <em>{since} ~ {until} · {linked.map((id) => names[id]).filter(Boolean).join(" · ")}</em>
        <span className="ad-rep-periods">
          {AD_PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={period === p.key}
              className={`pb-adbar-period ${period === p.key ? "pb-adbar-period-on" : ""}`}
              onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </span>
      </div>

      {/* 무엇을 얼마 쓰고 무엇을 얻었나 — 왼쪽에서 오른쪽으로 읽히게 돈 → 반응 → 결과 순 */}
      <div className="pb-sum-grid">
        <div className="pb-sum-card"><span>광고비</span><b>{won(total.cost)}원</b>
          <em>클릭당 {won(cpc)}원</em></div>
        <div className="pb-sum-card"><span>노출</span><b>{num(total.imp)}회</b>
          <em>클릭 {num(total.clk)}회 · 클릭률 {ctr}%</em></div>
        <div className="pb-sum-card"><span>전환</span><b>{num(total.conv)}건</b>
          <em>{total.conv > 0 ? `전환당 ${won(cpa)}원` : "아직 전환 없음"}</em></div>
        <div className="pb-sum-card"><span>캠페인</span><b>{rolls.length}개</b>
          <em>돈이 큰 순으로 아래에</em></div>
      </div>

      {/* 날짜별 광고비 — 언제 몰아 썼는지가 한눈에 */}
      <div className="ad-rep-block">
        <b className="ad-rep-h">날짜별 광고비</b>
        <div className="ad-rep-days">
          {days.map((d) => (
            <span key={d.date} className="ad-rep-day" title={`${d.date} · ${won(d.cost)}원 · 클릭 ${d.clicks}`}>
              <i style={{ height: `${Math.max(2, (d.cost / maxCost) * 100)}%` }} />
            </span>
          ))}
        </div>
        <span className="ad-rep-axis">
          <em>{days[0]?.date.slice(5)}</em>
          <em>하루 최대 {won(maxCost)}원</em>
          <em>{days[days.length - 1]?.date.slice(5)}</em>
        </span>
      </div>

      {/* 캠페인 순위 — 어디에 돈이 갔나 */}
      <div className="ad-rep-block">
        <b className="ad-rep-h">캠페인별</b>
        <div className="ad-rep-camps">
          {rolls.map((r) => (
            <div key={`${r.accountId}:${r.campaignId}`} className="ad-rep-camp">
              <span className="ad-rep-camp-name" title={r.campaignName}>{r.campaignName}</span>
              <span className="ad-rep-camp-bar"><i style={{ width: `${(r.cost / maxCamp) * 100}%` }} /></span>
              <span className="ad-rep-camp-num">{won(r.cost)}원</span>
              <em className="ad-rep-camp-sub">클릭 {num(r.clicks)} · 전환 {num(r.conversions)}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
