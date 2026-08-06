// 광고 지표 사전 — 대시보드에서 '무엇을 볼지' 고르는 목록의 원천 (2026-08-06 사장님 지시:
//   "네이버 API 에서 제공하는 모든 데이터를 대시보드에 추가할 수 있어야 한다").
//
//   수집할 때 매체 응답 원문을 ad_metrics_daily.raw 에 통째로 담아 둔다. 그래서 여기 사전에
//   한 줄만 더하면 새 지표가 바로 보인다(다시 수집하지 않아도 이미 받아 둔 raw 에서 읽는다).
//
//   agg — 기간을 합칠 때 어떻게 셈하는지
//     sum   : 그냥 더한다(노출·클릭·비용)
//     ratio : 더한 값끼리 나눈다(CTR = 클릭합/노출합) — 평균의 평균은 틀린 값이 된다
//     avg   : 값 자체의 평균(평균노출순위처럼 나눌 밑이 없는 것)

export type AdAgg = "sum" | "ratio" | "avg";
export type AdMetric = {
  key: string;
  label: string;
  unit: "원" | "회" | "건" | "%" | "위" | "배" | "";
  agg: AdAgg;
  /** raw(매체 원문)에서 읽을 이름. 없으면 아래 num/den 으로 셈한다 */
  field?: string;
  /** ratio·avg 계산에 쓰는 분자·분모(다른 지표 key) */
  num?: string; den?: string;
  /** 100을 곱해 %로 보일지 */
  pct?: boolean;
  /** 처음 대시보드를 열었을 때 기본으로 보여줄 지표 */
  core?: boolean;
  hint?: string;
};

//   네이버 검색광고 /stats 가 주는 필드 이름을 그대로 쓴다.
//   (impCnt 노출 · clkCnt 클릭 · salesAmt 광고비 · ccnt 전환수 · convAmt 전환매출 ·
//    cpc 클릭당비용 · ctr 클릭률 · avgRnk 평균노출순위 · viewCnt 동영상조회 ·
//    crto 전환율 · ror 광고수익률 · cpConv 전환당비용 · drt* 직접 · indr* 간접)
export const AD_METRICS: AdMetric[] = [
  { key: "impressions", label: "노출", unit: "회", agg: "sum", field: "impCnt", core: true },
  { key: "clicks", label: "클릭", unit: "회", agg: "sum", field: "clkCnt", core: true },
  { key: "cost", label: "광고비", unit: "원", agg: "sum", field: "salesAmt", core: true,
    hint: "네이버가 주는 값은 VAT 별도입니다" },
  { key: "ctr", label: "클릭률(CTR)", unit: "%", agg: "ratio", num: "clicks", den: "impressions", pct: true, core: true },
  { key: "cpc", label: "클릭당 비용(CPC)", unit: "원", agg: "ratio", num: "cost", den: "clicks", core: true },
  { key: "conversions", label: "전환", unit: "건", agg: "sum", field: "ccnt", core: true },
  { key: "convValue", label: "전환 매출", unit: "원", agg: "sum", field: "convAmt", core: true },
  { key: "cpa", label: "전환당 비용(CPA)", unit: "원", agg: "ratio", num: "cost", den: "conversions", core: true },
  { key: "roas", label: "광고 수익률(ROAS)", unit: "%", agg: "ratio", num: "convValue", den: "cost", pct: true, core: true },
  { key: "cvr", label: "전환율(CVR)", unit: "%", agg: "ratio", num: "conversions", den: "clicks", pct: true },
  { key: "avgRnk", label: "평균 노출순위", unit: "위", agg: "avg", field: "avgRnk" },
  { key: "viewCnt", label: "동영상 조회", unit: "회", agg: "sum", field: "viewCnt" },
  //   네이버가 계산해 준 값도 함께 둔다 — 우리가 합계로 셈한 것(CTR·ROAS…)과 비교해 볼 수 있게
  { key: "naverCtr", label: "클릭률(네이버 계산)", unit: "%", agg: "avg", field: "ctr" },
  { key: "naverCpc", label: "CPC(네이버 계산)", unit: "원", agg: "avg", field: "cpc" },
  { key: "naverCvr", label: "전환율(네이버 계산)", unit: "%", agg: "avg", field: "crto" },
  { key: "naverRoas", label: "ROAS(네이버 계산)", unit: "%", agg: "avg", field: "ror" },
  { key: "naverCpConv", label: "전환당 비용(네이버 계산)", unit: "원", agg: "avg", field: "cpConv" },
  { key: "drtCrto", label: "직접 전환율", unit: "%", agg: "avg", field: "drtCrto" },
  { key: "indrCrto", label: "간접 전환율", unit: "%", agg: "avg", field: "indrCrto" },
];

export const metricOf = (key: string) => AD_METRICS.find((m) => m.key === key);
export const CORE_METRIC_KEYS = AD_METRICS.filter((m) => m.core).map((m) => m.key);

/** 한 줄(하루·한 캠페인)에서 그 지표의 원값 — 없는 건 0 */
export function rawValue(row: { raw?: any; [k: string]: any }, m: AdMetric): number {
  //   표 컬럼으로 따로 저장해 둔 것이 있으면 그게 정확하다(원문 이름이 매체마다 다르므로)
  const direct: Record<string, string> = {
    impressions: "impressions", clicks: "clicks", cost: "cost",
    conversions: "conversions", convValue: "conv_value",
  };
  const col = direct[m.key];
  if (col && row[col] !== undefined && row[col] !== null) return Number(row[col]) || 0;
  if (m.field) return Number(row?.raw?.[m.field]) || 0;
  return 0;
}

/** 여러 줄을 기간 합계로 — agg 규칙대로 */
export function aggregate(rows: any[], keys: string[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const m of AD_METRICS) {
    if (m.agg === "sum" || m.agg === "avg") {
      let total = 0, n = 0;
      for (const r of rows) { const v = rawValue(r, m); total += v; if (v) n++; }
      sums[m.key] = m.agg === "avg" ? (n > 0 ? total / n : 0) : total;
    }
  }
  //   비율은 합계끼리 나눈다 — 하루치 비율을 평균 내면 틀린다
  for (const m of AD_METRICS) {
    if (m.agg !== "ratio") continue;
    const num = sums[m.num!] ?? 0, den = sums[m.den!] ?? 0;
    const v = den > 0 ? num / den : 0;
    sums[m.key] = m.pct ? Math.round(v * 1000) / 10 : Math.round(v);
  }
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = sums[k] ?? 0;
  return out;
}

/** 보기 좋은 문자열 — 금액은 콤마, 비율은 소수 한 자리 */
export function formatMetric(key: string, v: number): string {
  const m = metricOf(key);
  if (!m) return String(v);
  if (m.unit === "%") return `${Math.round(v * 10) / 10}%`;
  if (m.unit === "위") return v > 0 ? `${Math.round(v * 10) / 10}위` : "—";
  return `${Math.round(v).toLocaleString("ko-KR")}${m.unit}`;
}
