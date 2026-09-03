"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpiKrw, PfKpi, PfBadge, PfRows, PfRow, PfEmpty, PfSkeleton } from "../_components/pf/ui";
import { PfBars, PfDonut, PfGauge, PfTrend } from "../_components/pf/charts";

// 운영자 › 수익 — v2 디자인 (2026-09-03). 데이터 조회·MRR 계산은 종전과 동일, 표시만 바꿨다.

const db = supabase;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

const STATUS_KO: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  paid: { label: "결제완료", tone: "ok" },
  pending: { label: "대기", tone: "warn" },
  failed: { label: "실패", tone: "danger" },
};

export default function RevenuePage() {
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const { data: subscriptions = [], isLoading: subsLoading } = useQuery({
    queryKey: ["p-subs-rev"],
    queryFn: async () => {
      const data = logRead('revenue/page:data', await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["p-invoices-rev"],
    queryFn: async () => {
      const data = await fetchPaged<any>("p-invoices-rev", () => db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false }), 100000);
      return data || [];
    },
    refetchInterval: 60_000,
  });

  // MRR = 실제 돈이 들어오는 구독만 (2026-07-29 사장님: "수익 0인데 왜 금액이 찍혀있어").
  //   stripe_subscription_id 없는 구독은 내부 부여(자사·수동)라 과금이 없고,
  //   trialing 은 아직 결제 전 — 둘 다 제외해야 실매출과 일치한다.
  const mrr = subscriptions
    .filter((s: any) => s.status === "active" && s.stripe_subscription_id)
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);
  // 무료체험 중인 구독이 전부 유료 전환될 경우의 예상 월 매출 (참고 지표)
  const trialMrr = subscriptions
    .filter((s: any) => s.status === "trialing" && s.stripe_subscription_id)
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);

  // 회사명·청구서번호 검색 + 회사별 보기 (2026-07-28 전면 정비)
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i: any) => { if (i.companies?.name) set.add(i.companies.name); });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [invoices]);
  const shownInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i: any) => {
      if (companyFilter !== "all" && (i.companies?.name || "") !== companyFilter) return false;
      if (!q) return true;
      return (i.companies?.name || "").toLowerCase().includes(q) ||
        String(i.invoice_number || "").toLowerCase().includes(q);
    });
  }, [invoices, search, companyFilter]);

  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const pendingInvoices = invoices.filter((i: any) => i.status === "pending");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const pendingAmount = pendingInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);

  // ── 시각화용 파생값 (이미 불러온 데이터에서만 계산, 추가 조회 없음) ──
  // 월별 결제완료 매출 — 최근 12개월, 빈 달 0 포함
  const monthlyRevenue = useMemo(() => {
    const now = new Date();
    const months: { key: string; name: string; 결제완료: number; 미수금: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, name: `${d.getMonth() + 1}월`, 결제완료: 0, 미수금: 0 });
    }
    const idx = new Map(months.map((m, i) => [m.key, i]));
    invoices.forEach((inv: any) => {
      const k = String(inv.created_at || "").slice(0, 7);
      const i = idx.get(k);
      if (i == null) return;
      if (inv.status === "paid") months[i].결제완료 += inv.total_amount || 0;
      else if (inv.status === "pending") months[i].미수금 += inv.total_amount || 0;
    });
    return months;
  }, [invoices]);

  // 유료 구독 누적 추이 — 구독 시작일 기준으로 결제 중인 구독이 몇 곳인지 (일 단위, 최근 90일)
  const paidTrend = useMemo(() => {
    const paid = subscriptions.filter((s: any) => s.status === "active" && s.stripe_subscription_id);
    const days = 90;
    const out: { date: Date; 결제중: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const n = paid.filter((s: any) => new Date(s.created_at).getTime() <= d.getTime() + 86400000).length;
      out.push({ date: d, 결제중: n });
    }
    return out;
  }, [subscriptions]);

  // 요금제 구성 — 결제 중인 구독의 요금제별 수
  const planMix = useMemo(() => {
    const m = new Map<string, number>();
    subscriptions.filter((s: any) => s.status === "active" && s.stripe_subscription_id).forEach((s: any) => {
      const name = s.subscription_plans?.name || "미지정";
      m.set(name, (m.get(name) || 0) + 1);
    });
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }, [subscriptions]);

  const paidCount = subscriptions.filter((s: any) => s.status === "active" && s.stripe_subscription_id).length;
  const trialCount = subscriptions.filter((s: any) => s.status === "trialing").length;
  const collectRate = totalRevenue + pendingAmount > 0 ? Math.round((totalRevenue / (totalRevenue + pendingAmount)) * 100) : 100;
  const loading = subsLoading || invLoading;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="매출"
        title="수익"
        desc="매달 실제로 들어오는 구독료와 청구·수금 상황을 한눈에 봅니다. 1분마다 자동으로 새로 고쳐집니다."
        actions={
          <>
            <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
            <OpsSearch value={search} onChange={setSearch} placeholder="회사명·청구서번호 검색" />
            <OpsExportButton
              disabled={shownInvoices.length === 0}
              onClick={() => exportCsv(shownInvoices.map((i: any) => ({
                회사: i.companies?.name || "", 청구서번호: i.invoice_number || "",
                내용: i.description || "구독 결제", 금액: i.total_amount || 0,
                상태: i.status === "paid" ? "결제완료" : i.status === "failed" ? "실패" : "대기",
                일자: kstDateStr(new Date(i.created_at)),
              })), "결제내역")}
            />
          </>
        }
      />

      {/* KPI 4개 — 숫자가 굴러가며 채워진다 */}
      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile">
          <PfKpiKrw label="MRR · 이번 달 반복 매출" value={mrr} accent large />
          <div className="text-[10.5px] text-[var(--text-dim)] mt-2">매달 실제 결제되는 구독료 합계 (무료체험·내부 계정 제외)</div>
        </PfCard>
        <PfCard i={2} className="pf-kpi-tile">
          <PfKpiKrw label="ARR · 1년 환산" value={mrr * 12} large />
          <div className="text-[10.5px] text-[var(--text-dim)] mt-2">지금 MRR이 1년 유지될 때{trialMrr > 0 ? ` · 체험이 전부 전환되면 월 +${fmtW(trialMrr)}` : ""}</div>
        </PfCard>
        <PfCard i={3} className="pf-kpi-tile">
          <PfKpiKrw label="누적 매출" value={totalRevenue} large />
          <div className="text-[10.5px] text-[var(--text-dim)] mt-2">결제완료 청구서 {paidInvoices.length.toLocaleString()}건 합계</div>
        </PfCard>
        <PfCard i={4} className="pf-kpi-tile">
          <PfKpiKrw label="미수금" value={pendingAmount} large />
          <div className="text-[10.5px] text-[var(--text-dim)] mt-2">
            {pendingInvoices.length > 0 ? <PfBadge tone="warn">대기 {pendingInvoices.length}건</PfBadge> : <PfBadge tone="ok">밀린 결제 없음</PfBadge>}
          </div>
        </PfCard>
      </div>

      {/* 시각화 — 월별 매출 · 요금제 구성 · 수금률 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PfCard i={5} className="lg:col-span-2">
          <PfCardHead title="월별 매출" sub="최근 12개월 · 청구서 발행월 기준 · 결제완료와 미수금을 쌓아서 봅니다" />
          <PfCardBody>
            {loading ? <PfSkeleton h={220} /> : (
              <PfBars
                data={monthlyRevenue}
                xKey="name"
                stacked
                height={220}
                series={[
                  { key: "결제완료", label: "결제완료", format: (v) => `₩${Math.round(v).toLocaleString()}` },
                  { key: "미수금", label: "미수금", format: (v) => `₩${Math.round(v).toLocaleString()}` },
                ]}
                empty="아직 청구서가 없습니다"
              />
            )}
          </PfCardBody>
        </PfCard>
        <PfCard i={6}>
          <PfCardHead title="요금제 구성" sub="결제 중인 구독이 어떤 요금제인지" />
          <PfCardBody>
            {loading ? <PfSkeleton h={180} /> : (
              <PfDonut slices={planMix} size={160} centerLabel="결제 중" formatCenter={(t) => `${t}곳`} />
            )}
          </PfCardBody>
        </PfCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PfCard i={7} className="lg:col-span-2">
          <PfCardHead title="결제 중인 회사 수 추이" sub="최근 90일 · 그날까지 결제가 시작된 구독 수" />
          <PfCardBody>
            {loading ? <PfSkeleton h={200} /> : (
              <PfTrend data={paidTrend as unknown as Record<string, unknown>[]} height={200} series={[{ key: "결제중", label: "결제 중인 회사", format: (v) => `${Math.round(v)}곳` }]} />
            )}
          </PfCardBody>
        </PfCard>
        <PfCard i={8}>
          <PfCardHead title="수금률" sub="청구한 금액 중 실제로 받은 비율" />
          <PfCardBody>
            <div className="flex flex-col items-center gap-3">
              <PfGauge pct={collectRate} label="수금률" width={200} tone={collectRate >= 90 ? "ok" : collectRate >= 70 ? "warn" : "danger"} />
              <div className="grid grid-cols-2 gap-3 w-full">
                <PfKpi label="결제 중" value={paidCount} unit="곳" />
                <PfKpi label="체험 중" value={trialCount} unit="곳" />
              </div>
            </div>
          </PfCardBody>
        </PfCard>
      </div>

      {/* 결제 내역 목록 */}
      <PfCard i={9} hover={false}>
        <PfCardHead title="전체 결제 내역" sub={`${shownInvoices.length.toLocaleString()}건 · 회사별 보기와 검색이 적용된 결과`} />
        {invLoading ? (
          <PfCardBody><PfSkeleton rows={5} /></PfCardBody>
        ) : shownInvoices.length === 0 ? (
          <PfEmpty>결제 내역이 없습니다</PfEmpty>
        ) : (
          <PfRows>
            {shownInvoices.map((inv: any) => {
              const st = STATUS_KO[inv.status] || { label: inv.status || "-", tone: "muted" as const };
              return (
                <PfRow key={inv.id}>
                  <PfBadge tone={st.tone} className="w-[64px] justify-center shrink-0">{st.label}</PfBadge>
                  <div className="min-w-0 flex-1">
                    <div className="pf-row-title">{inv.companies?.name || "—"}</div>
                    <div className="pf-row-sub">{inv.invoice_number} · {inv.description || "구독 결제"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold mono-number text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                    <div className="pf-row-sub">{kstDateStr(new Date(inv.created_at))}</div>
                  </div>
                </PfRow>
              );
            })}
          </PfRows>
        )}
      </PfCard>
    </PfPage>
  );
}
