"use client";

// 광고 대시보드 — 입력이 없는 화면 (2026-08-06 사장님 지시:
//   "아드리엘처럼 광고 템플릿은 입력화면 없이 대시보드만. 데이터를 가져오는 거라 수동일 필요가 없다.
//    원하는 데이터를 자유자재로 고르고, 기간도 자유롭게").
//
//   · 표에 값을 채우지 않는다 — 수집해 둔 일별 기록(ad_metrics_daily)에서 바로 셈한다.
//   · 볼 지표는 사장님이 고른다(지표 고르기). 고른 목록은 이 표(보드)마다 기억한다.
//   · 기간은 시작·끝 날짜를 직접 잡는다(빠른 선택도 함께).

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { listAdAccounts, listDealAdAccounts, linkAdAccount, unlinkAdAccount } from "@/lib/project-ads";
import { AD_METRICS, CORE_METRIC_KEYS, aggregate, formatMetric, metricOf } from "@/lib/ad-metrics";
import { AdRangePicker } from "./AdRangePicker";
import { ColumnChart, BarChart, LineChart, DonutChart, FunnelChart, ScatterChart, ClusterChart, Legend, vizColor } from "@/components/charts/kit";

const db = supabase as any;
/** 합친 한 줄 — 지표 키가 무엇이 될지는 사장님이 고르는 것이라 느슨하게 둔다 */
type Row = { date?: string; key?: string; name?: string; [metric: string]: any };
const PICK_KEY = "ov.ads.metrics.";     // + boardId
const WIDGET_KEY = "ov.ads.widgets.";   // + boardId
/** 대시보드에 담을 수 있는 조각들 — 켜고 끄고 순서를 바꾼다 (2026-08-06 사장님: 위젯 편집) */
const WIDGETS: { key: string; label: string; hint: string }[] = [
  { key: "cards", label: "요약 카드", hint: "고른 지표를 한 줄로" },
  { key: "trend", label: "날짜별 그래프", hint: "첫 지표를 막대로" },
  { key: "chart", label: "차트", hint: "종류·지표를 골라 보는 그림" },
  { key: "detail", label: "세부 데이터", hint: "캠페인 › 광고그룹 › 소재" },
  { key: "creatives", label: "광고 소재", hint: "이미지와 성과를 카드로" },
  { key: "daily", label: "날짜별 상세표", hint: "하루 한 줄" },
];
const DEFAULT_WIDGETS = WIDGETS.map((w) => w.key);
const dayStr = (offset: number) =>
  new Date(new Date(`${todayKst()}T00:00:00Z`).getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const QUICK = [
  { label: "최근 7일", since: () => dayStr(-6), until: () => todayKst() },
  { label: "최근 30일", since: () => dayStr(-29), until: () => todayKst() },
  { label: "이번 달", since: () => `${todayKst().slice(0, 7)}-01`, until: () => todayKst() },
  { label: "지난 달", since: () => {
      const d = new Date(`${todayKst().slice(0, 7)}-01T00:00:00Z`);
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().slice(0, 10);
    }, until: () => {
      const d = new Date(`${todayKst().slice(0, 7)}-01T00:00:00Z`);
      return new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
    } },
];

export function AdDashboard({ dealId, companyId, boardId }: { dealId: string; companyId: string; boardId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [since, setSince] = useState(dayStr(-29));
  const [until, setUntil] = useState(todayKst());
  const [picked, setPicked] = useState<string[]>(CORE_METRIC_KEYS);
  const [pickOpen, setPickOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());   // 세부 데이터에서 펼친 줄
  const [widgets, setWidgets] = useState<string[]>(DEFAULT_WIDGETS);   // 켜진 것만, 보이는 차례대로
  const [widgetOpen, setWidgetOpen] = useState(false);
  //   차트 위젯 — 무엇을(지표) 어떻게(종류) 무엇별로(기준) 볼지 (2026-08-06 아드리엘 형식)
  const [chart, setChart] = useState<{ type: string; metric: string; metric2: string; by: string }>(
    { type: "column", metric: "cost", metric2: "clicks", by: "date" });

  //   고른 지표는 표마다 기억한다 — 사람마다 보는 눈이 다르다
  useEffect(() => {
    try {
      const s = localStorage.getItem(`${PICK_KEY}${boardId}`);
      if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) setPicked(a); }
    } catch { /* 저장소 못 쓰면 기본값 */ }
  }, [boardId]);
  //   위젯 구성도 표마다 기억한다 — 사람마다 보고 싶은 조각이 다르다
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${WIDGET_KEY}${boardId}`);
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) setWidgets(a.filter((k: string) => DEFAULT_WIDGETS.includes(k)));
      }
    } catch { /* 저장소 못 쓰면 기본값 */ }
  }, [boardId]);
  const saveWidgets = (next: string[]) => {
    setWidgets(next);
    try { localStorage.setItem(`${WIDGET_KEY}${boardId}`, JSON.stringify(next)); } catch { /* 무시 */ }
  };
  const moveWidget = (key: string, delta: -1 | 1) => {
    const i = widgets.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    saveWidgets(next);
  };

  const savePicked = (next: string[]) => {
    setPicked(next);
    try { localStorage.setItem(`${PICK_KEY}${boardId}`, JSON.stringify(next)); } catch { /* 무시 */ }
  };

  const { data: accounts = [] } = useQuery({ queryKey: ["ad-accounts", companyId], queryFn: listAdAccounts, enabled: !!companyId });
  const { data: linked = [] } = useQuery({ queryKey: ["deal-ad-accounts", dealId], queryFn: () => listDealAdAccounts(dealId), enabled: !!dealId });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ad-rows", dealId, linked.join(), since, until],
    enabled: linked.length > 0 && !!since && !!until,
    queryFn: async () => {
      const data = await fetchPaged<any>("AdDashboard:rows", () => db.from("ad_metrics_daily")
        .select("ad_account_id, platform, level, entity_id, campaign_id, campaign_name, stat_date, impressions, clicks, cost, conversions, conv_value, raw")
        .in("ad_account_id", linked).gte("stat_date", since).lte("stat_date", until)
        .order("stat_date", { ascending: true }).order("id"), 50000);
      return (data || []) as any[];
    },
  });

  //   계층(캠페인 > 광고그룹 > 소재)과 소재 정보 — 세부 데이터 표·소재 카드가 쓴다
  const { data: entities = [] } = useQuery({
    queryKey: ["ad-entities", linked.join()],
    enabled: linked.length > 0,
    queryFn: async () => {
      const data = await fetchPaged<any>("AdDashboard:entities", () => db.from("ad_entities")
        .select("ad_account_id, level, entity_id, parent_id, name, status, daily_budget, ad_type, image_url, link_url, price")
        .in("ad_account_id", linked).order("id"), 50000);
      return (data || []) as any[];
    },
  });

  //   숫자는 계층마다 따로 쌓여 있다 — 카드·추이는 캠페인 줄만 센다(중복 합산 방지)
  const campaignRows = useMemo(() => rows.filter((r) => (r.level || "campaign") === "campaign"), [rows]);
  const total = useMemo(() => aggregate(campaignRows, picked), [campaignRows, picked]);
  const byDay = useMemo<Row[]>(() => {
    const m = new Map<string, any[]>();
    for (const r of campaignRows) {
      const cur = m.get(r.stat_date) || [];
      cur.push(r);
      m.set(r.stat_date, cur);
    }
    //   고른 기간의 모든 날을 세운다 — 집행이 없던 날도 자리를 지켜야 '언제 몰아 썼는지'가 보인다
    const out: Row[] = [];
    for (let t0 = new Date(`${since}T00:00:00Z`).getTime(); t0 <= new Date(`${until}T00:00:00Z`).getTime(); t0 += 86_400_000) {
      const d = new Date(t0).toISOString().slice(0, 10);
      out.push({ date: d, ...aggregate(m.get(d) || [], picked) });
    }
    return out;
  }, [campaignRows, picked, since, until]);
  const byCampaign = useMemo(() => {
    const m = new Map<string, { name: string; rows: any[] }>();
    for (const r of campaignRows) {
      const k = `${r.ad_account_id}:${r.campaign_id}`;
      const cur = m.get(k) || { name: String(r.campaign_name || r.campaign_id), rows: [] as any[] };
      cur.rows.push(r);
      if (r.campaign_name) cur.name = r.campaign_name;
      m.set(k, cur);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, name: v.name, ...aggregate(v.rows, picked) }) as Row)
      .sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0));
  }, [campaignRows, picked]);

  //   세부 데이터 — 계층 그대로. 펼친 줄만 아래를 그린다(아드리엘의 '채널 > 캠페인 > 광고세트 > 소재')
  const byEntity = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of rows) {
      const k = `${r.level || "campaign"}:${r.entity_id}`;
      const cur = m.get(k) || [];
      cur.push(r);
      m.set(k, cur);
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [k, rs] of m) out[k] = aggregate(rs, picked);
    return out;
  }, [rows, picked]);
  const kids = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of entities) {
      const k = e.parent_id || "__root__";
      const cur = m.get(k) || [];
      cur.push(e);
      m.set(k, cur);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => (Number(byEntity[`${b.level}:${b.entity_id}`]?.cost) || 0) - (Number(byEntity[`${a.level}:${a.entity_id}`]?.cost) || 0));
    }
    return m;
  }, [entities, byEntity]);
  const creatives = useMemo(() => entities.filter((e) => e.level === "ad")
    .map((e) => ({ ...e, m: byEntity[`ad:${e.entity_id}`] || {} }))
    .sort((a, b) => (Number(b.m.cost) || 0) - (Number(a.m.cost) || 0)), [entities, byEntity]);

  const syncNow = async () => {
    if (linked.length === 0) { toast("먼저 광고 계정을 고르세요.", "error"); return; }
    setBusy(true);
    try {
      for (const id of linked) {
        const { data, error } = await supabase.functions.invoke("ads-sync", { body: { accountId: id } });
        if (error) throw new Error(error.message);
        const r = (data as any)?.results?.[0];
        if (r && !r.ok) throw new Error(r.error || "가져오기 실패");
      }
      qc.invalidateQueries({ queryKey: ["ad-rows", dealId] });
      qc.invalidateQueries({ queryKey: ["ad-accounts", companyId] });
      toast("매체에서 새로 받아 왔습니다.", "success");
    } catch (e: any) {
      toast(e?.message || "가져오기 실패", "error");
    } finally { setBusy(false); }
  };

  //   고른 기간에 아직 없는 날을 매체에서 채운다 — 기간을 넓히면 그때 받아오는 게 자연스럽다
  const applyRange = async (s2: string, u2: string) => {
    setSince(s2); setUntil(u2); setRangeOpen(false);
    if (linked.length === 0) return;
    const have = new Set<string>();
    const data = logRead("AdDashboard:have", await db.from("ad_metrics_daily")
      .select("stat_date").in("ad_account_id", linked).gte("stat_date", s2).lte("stat_date", u2).limit(5000));
    for (const r of (data || []) as any[]) have.add(String(r.stat_date).slice(0, 10));
    const missing: string[] = [];
    for (let t0 = new Date(`${s2}T00:00:00Z`).getTime(); t0 <= new Date(`${u2}T00:00:00Z`).getTime(); t0 += 86_400_000) {
      const d = new Date(t0).toISOString().slice(0, 10);
      if (!have.has(d) && d <= todayKst()) missing.push(d);
    }
    if (missing.length === 0) return;
    setBusy(true);
    try {
      const days = missing.slice(-92);          // 한 번에 너무 오래 돌지 않게
      for (const id of linked) {
        const { error } = await supabase.functions.invoke("ads-sync", { body: { accountId: id, days } });
        if (error) throw new Error(error.message);
      }
      qc.invalidateQueries({ queryKey: ["ad-rows", dealId] });
      toast(`${days.length}일치를 새로 받아 왔습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "기간 채우기 실패", "error");
    } finally { setBusy(false); }
  };

  const toggleAcc = async (id: string) => {
    try {
      if (linked.includes(id)) await unlinkAdAccount(dealId, id);
      else await linkAdAccount(dealId, companyId, id);
      qc.invalidateQueries({ queryKey: ["deal-ad-accounts", dealId] });
    } catch (e: any) { toast(e?.message || "연결 실패", "error"); }
  };

  const mine = accounts.filter((a) => linked.includes(a.id));
  const lastSync = mine.map((a) => a.last_synced_at).filter(Boolean).sort().pop();
  const maxDay = Math.max(1, ...byDay.map((d) => Number(d[picked[0]]) || 0));
  const first = picked[0] || "cost";
  const shown = AD_METRICS.filter((m) => picked.includes(m.key));
  const found = AD_METRICS.filter((m) => !q.trim() || m.label.includes(q.trim()) || m.key.includes(q.trim()));

  return (
    <div className="adb">
      {/* 무엇을 · 언제 — 대시보드가 무엇을 보고 있는지 한 줄로 */}
      <div className="adb-bar">
        <span className="adb-accs">
          {mine.length === 0
            ? <em>광고 계정을 고르면 성과가 보입니다</em>
            : mine.map((a) => <span key={a.id} className="adb-chip">{a.label}</span>)}
          <button type="button" className="adb-pickacc" onClick={() => setAccOpen(true)}>계정</button>
        </span>

        <button type="button" className="adb-range" onClick={() => setRangeOpen(true)}>
          {since} ~ {until}
        </button>
        <span className="adb-quick">
          {QUICK.map((p) => (
            <button key={p.label} type="button"
              aria-pressed={since === p.since() && until === p.until()}
              className={`adb-quick-btn ${since === p.since() && until === p.until() ? "adb-quick-on" : ""}`}
              onClick={() => { setSince(p.since()); setUntil(p.until()); }}>{p.label}</button>
          ))}
        </span>

        <button type="button" className="adb-metrics" onClick={() => { setQ(""); setPickOpen(true); }}>
          지표 {picked.length}
        </button>
        <button type="button" className="adb-metrics" onClick={() => setWidgetOpen(true)}>
          위젯 {widgets.length}
        </button>
        <button type="button" className="adb-sync" disabled={busy} onClick={syncNow}>
          {busy ? "가져오는 중…" : "지금 가져오기"}
        </button>
      </div>
      {lastSync && <p className="adb-when">매일 새벽 자동으로 받아옵니다 · 마지막 수집 {String(lastSync).slice(5, 16).replace("T", " ")}</p>}

      {linked.length === 0 ? (
        <p className="pj-sec-empty">‘계정’ 을 눌러 이 프로젝트가 볼 광고 계정을 고르세요. 설정 &gt; 연동에서 등록한 계정이 여기 나옵니다.</p>
      ) : isLoading ? (
        <p className="pj-sec-empty">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="pj-sec-empty">{since} ~ {until} 사이에 집행된 광고가 없습니다.</p>
      ) : (<>
        {/* 담긴 위젯을 고른 차례대로 그린다 — 켜고 끄기·순서는 '위젯' 에서 (2026-08-06) */}
        {widgets.map((w) => (
          <div key={w} className="adb-widget">
            {w === "cards" && (<>
    {/* 고른 지표를 카드로 — 아드리엘의 '데이터 총괄 지표'와 같은 자리 */}
            <div className="adb-cards">
              {shown.map((m) => (
                <div key={m.key} className="adb-card" title={m.hint || m.label}>
                  <span>{m.label}</span>
                  <b>{formatMetric(m.key, total[m.key] ?? 0)}</b>
                </div>
              ))}
            </div>
            </>)}
            {w === "trend" && (<>
    {/* 날짜별 — 첫 지표를 막대로. 무엇을 볼지는 지표 고르기에서 바뀐다 */}
            <div className="adb-block">
              <b className="adb-h">날짜별 {metricOf(first)?.label}</b>
              <div className="adb-days">
                {byDay.map((d) => (
                  <span key={d.date} className="adb-day"
                    title={`${d.date} · ${shown.map((m) => `${m.label} ${formatMetric(m.key, d[m.key] ?? 0)}`).join(" · ")}`}>
                    <i style={{ height: `${Math.max(2, ((Number(d[first]) || 0) / maxDay) * 100)}%` }} />
                  </span>
                ))}
              </div>
              <span className="adb-axis"><em>{byDay[0]?.date?.slice(5)}</em><em>{byDay[byDay.length - 1]?.date?.slice(5)}</em></span>
            </div>
            </>)}
            {w === "chart" && (<>
                <div className="adb-block">
                  <div className="adb-charthead">
                    <b className="adb-h">차트</b>
                    <select value={chart.type} onChange={(e) => setChart((c) => ({ ...c, type: e.target.value }))} aria-label="차트 종류">
                      <option value="column">세로 막대</option>
                      <option value="bar">가로 막대</option>
                      <option value="line">선</option>
                      <option value="combo">콤보(선 두 개)</option>
                      <option value="donut">도넛</option>
                      <option value="funnel">깔때기</option>
                      <option value="scatter">분산형</option>
                      <option value="cluster">묶음</option>
                    </select>
                    <select value={chart.by} onChange={(e) => setChart((c) => ({ ...c, by: e.target.value }))} aria-label="기준">
                      <option value="date">날짜별</option>
                      <option value="campaign">캠페인별</option>
                      <option value="adgroup">광고그룹별</option>
                      <option value="ad">소재별</option>
                    </select>
                    <select value={chart.metric} onChange={(e) => setChart((c) => ({ ...c, metric: e.target.value }))} aria-label="지표">
                      {AD_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    {(chart.type === "combo" || chart.type === "scatter") && (
                      <select value={chart.metric2} onChange={(e) => setChart((c) => ({ ...c, metric2: e.target.value }))} aria-label="두 번째 지표">
                        {AD_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    )}
                  </div>
                  <ChartBody chart={chart} byDay={byDay} entities={entities} byEntity={byEntity} />
                </div>
            </>)}
            {w === "detail" && (<>
    {/* 세부 데이터 — 캠페인 > 광고그룹 > 소재. 삼각형을 눌러 펼친다 (2026-08-06 아드리엘 형식) */}
            <div className="adb-block">
              <b className="adb-h">세부 데이터 <em className="adb-sub">캠페인 › 광고그룹 › 소재</em></b>
              <div className="adb-tablewrap">
                <table className="adb-table">
                  <thead>
                    <tr><th>이름</th><th>상태</th>{shown.map((m) => <th key={m.key}>{m.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(kids.get("__root__") || []).map((c: any) => (
                      <EntityRows key={c.entity_id} node={c} depth={0} kids={kids} byEntity={byEntity}
                        shown={shown} open={open} onToggle={(id) => setOpen((prev) => {
                          const n = new Set(prev);
                          if (n.has(id)) n.delete(id); else n.add(id);
                          return n;
                        })} />
                    ))}
                    <tr className="adb-sum">
                      <td>합계</td><td />
                      {shown.map((m) => <td key={m.key}>{formatMetric(m.key, total[m.key] ?? 0)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            </>)}
            {w === "creatives" && (<>
    {/* 광고 소재 — 이미지와 성과를 카드로 (쇼핑검색광고는 상품 이미지가 온다) */}
            {creatives.length > 0 && (
              <div className="adb-block">
                <b className="adb-h">광고 소재 <em className="adb-sub">{creatives.length}개</em></b>
                <div className="adb-creatives">
                  {creatives.map((c: any) => (
                    <div key={c.entity_id} className="adb-cre">
                      {c.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={c.image_url} alt={c.name || "소재"} className="adb-cre-img" loading="lazy" referrerPolicy="no-referrer" />
                        : <span className="adb-cre-noimg">이미지 없음</span>}
                      <b className="adb-cre-name" title={c.name || ""}>{c.name || "(이름 없음)"}</b>
                      <span className="adb-cre-head">
                        <em className={c.status === "ELIGIBLE" ? "adb-cre-on" : ""}>{c.status === "ELIGIBLE" ? "활성" : (c.status || "-")}</em>
                        {c.price ? <i>{Math.round(c.price).toLocaleString("ko-KR")}원</i> : null}
                      </span>
                      <dl className="adb-cre-m">
                        {shown.slice(0, 6).map((m) => (
                          <div key={m.key}><dt>{m.label}</dt><dd>{formatMetric(m.key, c.m[m.key] ?? 0)}</dd></div>
                        ))}
                      </dl>
                      {c.link_url && <a href={c.link_url} target="_blank" rel="noopener noreferrer" className="adb-cre-link">상품 보기 →</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>)}
            {w === "daily" && (<>
    {/* 날짜별 표 — 아드리엘의 '일별 데이터' 자리 */}
            <div className="adb-block">
              <b className="adb-h">날짜별 상세</b>
              <div className="adb-tablewrap">
                <table className="adb-table">
                  <thead>
                    <tr><th>날짜</th>{shown.map((m) => <th key={m.key}>{m.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {[...byDay].reverse().map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        {shown.map((m) => <td key={m.key}>{formatMetric(m.key, (d as any)[m.key] ?? 0)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>)}
          </div>
        ))}
      </>)}

      {pickOpen && (
        <div className="pb-doc-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setPickOpen(false); }}>
          <div className="pb-doc-box adb-pick-box">
            <b className="pb-collabels-h">지표 고르기</b>
            <em className="pb-name-hint">고른 지표가 카드·표·그래프에 그대로 쓰입니다. 맨 앞의 것이 날짜별 막대가 됩니다.</em>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="지표 검색" className="adb-pick-search" />
            <div className="adb-pick-list">
              {found.map((m) => (
                <label key={m.key} className="adb-pick-row">
                  <input type="checkbox" checked={picked.includes(m.key)}
                    onChange={() => savePicked(picked.includes(m.key)
                      ? picked.filter((k) => k !== m.key)
                      : [...picked, m.key])} />
                  <span>{m.label}</span>
                  <em>{m.hint || (m.agg === "ratio" ? "합계끼리 나눠 셈합니다" : m.agg === "avg" ? "평균" : "기간 합계")}</em>
                </label>
              ))}
            </div>
            <span className="pb-collabels-foot">
              <button type="button" onClick={() => savePicked(CORE_METRIC_KEYS)}>기본으로</button>
              <button type="button" className="pb-collabels-go" onClick={() => setPickOpen(false)}>닫기</button>
            </span>
          </div>
        </div>
      )}

      {widgetOpen && (
        <div className="pb-doc-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setWidgetOpen(false); }}>
          <div className="pb-doc-box adb-pick-box">
            <b className="pb-collabels-h">위젯</b>
            <em className="pb-name-hint">담을 것을 고르고 ↑↓ 로 차례를 바꿉니다. 이 표에만 적용됩니다.</em>
            <div className="adb-wlist">
              {/* 담긴 것 먼저(순서대로), 그 아래 뺀 것 */}
              {widgets.map((k, i) => {
                const w = WIDGETS.find((x) => x.key === k)!;
                return (
                  <div key={k} className="adb-wrow">
                    <input type="checkbox" checked readOnly
                      onClick={() => saveWidgets(widgets.filter((x) => x !== k))} />
                    <span>{w.label}</span>
                    <em>{w.hint}</em>
                    <button type="button" disabled={i === 0} onClick={() => moveWidget(k, -1)} aria-label="위로">↑</button>
                    <button type="button" disabled={i === widgets.length - 1} onClick={() => moveWidget(k, 1)} aria-label="아래로">↓</button>
                  </div>
                );
              })}
              {WIDGETS.filter((w) => !widgets.includes(w.key)).map((w) => (
                <div key={w.key} className="adb-wrow adb-wrow-off">
                  <input type="checkbox" checked={false} readOnly onClick={() => saveWidgets([...widgets, w.key])} />
                  <span>{w.label}</span>
                  <em>{w.hint}</em>
                </div>
              ))}
            </div>
            <span className="pb-collabels-foot">
              <button type="button" onClick={() => saveWidgets(DEFAULT_WIDGETS)}>기본으로</button>
              <button type="button" className="pb-collabels-go" onClick={() => setWidgetOpen(false)}>닫기</button>
            </span>
          </div>
        </div>
      )}

      {rangeOpen && (
        <AdRangePicker since={since} until={until} onApply={applyRange} onClose={() => setRangeOpen(false)} />
      )}

      {accOpen && (
        <div className="pb-doc-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setAccOpen(false); }}>
          <div className="pb-doc-box pb-adpick-box">
            <b className="pb-collabels-h">이 프로젝트가 볼 광고 계정</b>
            {accounts.length === 0 ? (
              <em className="pb-name-hint">설정 &gt; 연동 &gt; 광고 계정에서 먼저 등록하세요.</em>
            ) : accounts.map((a) => (
              <label key={a.id} className="pb-adpick-row">
                <input type="checkbox" checked={linked.includes(a.id)} onChange={() => toggleAcc(a.id)} />
                <span>{a.label}</span>
                <em>{a.external_id}{a.status === "error" ? " · 연결 오류" : ""}</em>
              </label>
            ))}
            <span className="pb-collabels-foot">
              <button type="button" onClick={() => setAccOpen(false)}>닫기</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 세부 데이터 한 줄과 그 아래 — 캠페인 > 광고그룹 > 소재를 같은 규칙으로 그린다.
 *  펼친 줄만 아래를 그린다(다 펼쳐 두면 소재가 많은 계정에서 표가 못 쓰게 된다). */
function EntityRows({ node, depth, kids, byEntity, shown, open, onToggle }: {
  node: any; depth: number;
  kids: Map<string, any[]>;
  byEntity: Record<string, Record<string, number>>;
  shown: { key: string; label: string }[];
  open: Set<string>;
  onToggle: (id: string) => void;
}) {
  const key = `${node.level}:${node.entity_id}`;
  const m = byEntity[key] || {};
  const children = kids.get(node.entity_id) || [];
  const isOpen = open.has(node.entity_id);
  return (
    <>
      <tr className={depth > 0 ? "adb-sub-row" : ""}>
        <td>
          <span className="adb-name" style={{ paddingLeft: depth * 14 }}>
            {children.length > 0
              ? <button type="button" className="adb-caret" onClick={() => onToggle(node.entity_id)}
                  aria-expanded={isOpen}>{isOpen ? "▾" : "▸"}</button>
              : <i className="adb-caret-none" />}
            {node.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={node.image_url} alt="" className="adb-thumb" loading="lazy" referrerPolicy="no-referrer" />
            )}
            <span title={node.name || ""}>{node.name || node.entity_id}</span>
          </span>
        </td>
        <td>{node.status === "ELIGIBLE" ? "활성" : (node.status || "-")}</td>
        {shown.map((c) => <td key={c.key}>{formatMetric(c.key, m[c.key] ?? 0)}</td>)}
      </tr>
      {isOpen && children.map((c: any) => (
        <EntityRows key={c.entity_id} node={c} depth={depth + 1} kids={kids} byEntity={byEntity}
          shown={shown} open={open} onToggle={onToggle} />
      ))}
    </>
  );
}

/** 차트 한 장 — 무엇을(지표) 무엇별로(기준) 어떻게(종류) 그릴지만 정하면 된다.
 *  ⚠️ 축은 하나다 — 단위가 다른 두 지표를 한 그림에 겹치지 않는다. 콤보도 같은 축의 두 선으로 그린다
 *     (예: 노출과 클릭). 굳이 겹치고 싶으면 그림을 둘로 나누는 게 맞다. */
function ChartBody({ chart, byDay, entities, byEntity }: {
  chart: { type: string; metric: string; metric2: string; by: string };
  byDay: any[];
  entities: any[];
  byEntity: Record<string, Record<string, number>>;
}) {
  const m1 = metricOf(chart.metric);
  const m2 = metricOf(chart.metric2);
  const unit = m1?.unit === "원" ? "원" : m1?.unit === "%" ? "%" : "";

  //   기준이 '날짜'면 하루 한 점, 아니면 그 계층의 대상 하나가 한 점
  const data = chart.by === "date"
    ? byDay.map((d) => ({ label: String(d.date).slice(5), value: Number(d[chart.metric]) || 0, v2: Number(d[chart.metric2]) || 0 }))
    : entities.filter((e) => e.level === chart.by).map((e) => {
        const m = byEntity[`${e.level}:${e.entity_id}`] || {};
        return { label: e.name || e.entity_id, value: Number(m[chart.metric]) || 0, v2: Number(m[chart.metric2]) || 0 };
      }).sort((a, b) => b.value - a.value).slice(0, 12);

  if (data.length === 0) return <p className="pj-sec-empty">그릴 값이 없습니다.</p>;

  //   ⚠️ 도넛·묶음·깔때기는 '무엇이 얼마를 차지하나'를 보는 그림이다 — 조각이 여덟을 넘으면
  //   색이 모자라 읽을 수 없다. 큰 것 일곱만 두고 나머지는 '기타'로 접는다(색을 새로 만들지 않는다).
  const isShare = chart.type === "donut" || chart.type === "cluster" || chart.type === "funnel";
  const shareData = (() => {
    if (!isShare || data.length <= 8) return data;
    const top = data.slice(0, 7);
    const restSum = data.slice(7).reduce((n, d) => n + d.value, 0);
    return [...top, { label: `기타 ${data.length - 7}개`, value: restSum, v2: 0 }];
  })();

  if (chart.type === "bar") return <BarChart data={data} unit={unit} />;
  if (chart.type === "donut") return (<>
    {chart.by === "date" && <p className="adb-warn">도넛은 ‘무엇이 얼마를 차지하나’를 보는 그림입니다 — 날짜별은 세로 막대나 선이 맞습니다.</p>}
    <DonutChart data={shareData} unit={unit} />
    <Legend items={shareData.map((d, i) => ({ name: d.label, color: vizColor(i) }))} />
  </>);
  if (chart.type === "funnel") return <FunnelChart data={shareData} unit={unit} />;
  if (chart.type === "cluster") return <ClusterChart data={shareData} unit={unit} />;
  if (chart.type === "scatter") return (
    <ScatterChart xLabel={m2?.label || ""} yLabel={m1?.label || ""}
      points={data.map((d) => ({ label: d.label, x: d.v2, y: d.value }))} />
  );
  if (chart.type === "line") return (
    <LineChart unit={unit} series={[{ name: m1?.label || "", points: data.map((d) => ({ label: d.label, value: d.value })) }]} />
  );
  if (chart.type === "combo") {
    const same = m1?.unit === m2?.unit;
    return (<>
      {!same && (
        <p className="adb-warn">단위가 다른 지표({m1?.label} · {m2?.label})는 한 축에 겹치면 그림이 거짓말을 합니다 — 같은 단위끼리 고르세요.</p>
      )}
      <LineChart unit={unit} series={[
        { name: m1?.label || "", points: data.map((d) => ({ label: d.label, value: d.value })) },
        { name: m2?.label || "", points: data.map((d) => ({ label: d.label, value: d.v2 })) },
      ]} />
      <Legend items={[{ name: m1?.label || "", color: vizColor(0) }, { name: m2?.label || "", color: vizColor(1) }]} />
    </>);
  }
  return <ColumnChart data={data} unit={unit} />;
}
