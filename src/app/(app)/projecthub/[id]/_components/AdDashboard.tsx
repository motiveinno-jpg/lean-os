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
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { todayKst } from "@/lib/kst";
import { listAdAccounts, listDealAdAccounts, linkAdAccount, unlinkAdAccount } from "@/lib/project-ads";
import { AD_METRICS, CORE_METRIC_KEYS, aggregate, formatMetric, metricOf } from "@/lib/ad-metrics";

const db = supabase as any;
/** 합친 한 줄 — 지표 키가 무엇이 될지는 사장님이 고르는 것이라 느슨하게 둔다 */
type Row = { date?: string; key?: string; name?: string; [metric: string]: any };
const PICK_KEY = "ov.ads.metrics.";     // + boardId
const dayStr = (offset: number) =>
  new Date(new Date(`${todayKst()}T00:00:00`).getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const QUICK = [
  { label: "최근 7일", since: () => dayStr(-6), until: () => todayKst() },
  { label: "최근 30일", since: () => dayStr(-29), until: () => todayKst() },
  { label: "이번 달", since: () => `${todayKst().slice(0, 7)}-01`, until: () => todayKst() },
  { label: "지난 달", since: () => {
      const d = new Date(`${todayKst().slice(0, 7)}-01T00:00:00`);
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().slice(0, 10);
    }, until: () => {
      const d = new Date(`${todayKst().slice(0, 7)}-01T00:00:00`);
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

  //   고른 지표는 표마다 기억한다 — 사람마다 보는 눈이 다르다
  useEffect(() => {
    try {
      const s = localStorage.getItem(`${PICK_KEY}${boardId}`);
      if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) setPicked(a); }
    } catch { /* 저장소 못 쓰면 기본값 */ }
  }, [boardId]);
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
      const data = logRead("AdDashboard:rows", await db.from("ad_metrics_daily")
        .select("ad_account_id, platform, campaign_id, campaign_name, stat_date, impressions, clicks, cost, conversions, conv_value, raw")
        .in("ad_account_id", linked).gte("stat_date", since).lte("stat_date", until)
        .order("stat_date", { ascending: true }).limit(5000));
      return (data || []) as any[];
    },
  });

  const total = useMemo(() => aggregate(rows, picked), [rows, picked]);
  const byDay = useMemo<Row[]>(() => {
    const m = new Map<string, any[]>();
    for (const r of rows) {
      const cur = m.get(r.stat_date) || [];
      cur.push(r);
      m.set(r.stat_date, cur);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rs]) => ({ date, ...aggregate(rs, picked) }));
  }, [rows, picked]);
  const byCampaign = useMemo(() => {
    const m = new Map<string, { name: string; rows: any[] }>();
    for (const r of rows) {
      const k = `${r.ad_account_id}:${r.campaign_id}`;
      const cur = m.get(k) || { name: String(r.campaign_name || r.campaign_id), rows: [] as any[] };
      cur.rows.push(r);
      if (r.campaign_name) cur.name = r.campaign_name;
      m.set(k, cur);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, name: v.name, ...aggregate(v.rows, picked) }) as Row)
      .sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0));
  }, [rows, picked]);

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

        <span className="adb-dates">
          <DateField value={since} onChange={(e) => setSince(e.target.value)} className="adb-date" />
          <i>~</i>
          <DateField value={until} onChange={(e) => setUntil(e.target.value)} className="adb-date" />
        </span>
        <span className="adb-quick">
          {QUICK.map((p) => (
            <button key={p.label} type="button"
              aria-pressed={since === p.since() && until === p.until()}
              className={`adb-quick-btn ${since === p.since() && until === p.until() ? "adb-quick-on" : ""}`}
              onClick={() => { setSince(p.since()); setUntil(p.until()); }}>{p.label}</button>
          ))}
        </span>

        <button type="button" className="adb-metrics" onClick={() => { setQ(""); setPickOpen(true); }}>
          지표 고르기 {picked.length}
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
        <p className="pj-sec-empty">{since} ~ {until} 사이에 집행된 광고가 없어요.</p>
      ) : (<>
        {/* 고른 지표를 카드로 — 아드리엘의 '데이터 총괄 지표'와 같은 자리 */}
        <div className="adb-cards">
          {shown.map((m) => (
            <div key={m.key} className="adb-card" title={m.hint || m.label}>
              <span>{m.label}</span>
              <b>{formatMetric(m.key, total[m.key] ?? 0)}</b>
            </div>
          ))}
        </div>

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

        {/* 캠페인별 표 — 고른 지표가 그대로 칸이 된다 */}
        <div className="adb-block">
          <b className="adb-h">캠페인별</b>
          <div className="adb-tablewrap">
            <table className="adb-table">
              <thead>
                <tr><th>캠페인</th>{shown.map((m) => <th key={m.key}>{m.label}</th>)}</tr>
              </thead>
              <tbody>
                {byCampaign.map((c) => (
                  <tr key={c.key}>
                    <td title={c.name}>{c.name}</td>
                    {shown.map((m) => <td key={m.key}>{formatMetric(m.key, (c as any)[m.key] ?? 0)}</td>)}
                  </tr>
                ))}
                <tr className="adb-sum">
                  <td>합계</td>
                  {shown.map((m) => <td key={m.key}>{formatMetric(m.key, total[m.key] ?? 0)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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
