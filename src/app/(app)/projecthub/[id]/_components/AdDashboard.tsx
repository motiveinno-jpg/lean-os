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
import { todayKst } from "@/lib/kst";
import { listAdAccounts, listDealAdAccounts, linkAdAccount, unlinkAdAccount } from "@/lib/project-ads";
import { AD_METRICS, CORE_METRIC_KEYS, aggregate, formatMetric, metricOf } from "@/lib/ad-metrics";
import { AdRangePicker } from "./AdRangePicker";

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
  const [rangeOpen, setRangeOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());   // 세부 데이터에서 펼친 줄

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
        .select("ad_account_id, platform, level, entity_id, campaign_id, campaign_name, stat_date, impressions, clicks, cost, conversions, conv_value, raw")
        .in("ad_account_id", linked).gte("stat_date", since).lte("stat_date", until)
        .order("stat_date", { ascending: true }).limit(20000));
      return (data || []) as any[];
    },
  });

  //   계층(캠페인 > 광고그룹 > 소재)과 소재 정보 — 세부 데이터 표·소재 카드가 쓴다
  const { data: entities = [] } = useQuery({
    queryKey: ["ad-entities", linked.join()],
    enabled: linked.length > 0,
    queryFn: async () => {
      const data = logRead("AdDashboard:entities", await db.from("ad_entities")
        .select("ad_account_id, level, entity_id, parent_id, name, status, daily_budget, ad_type, image_url, link_url, price")
        .in("ad_account_id", linked).limit(3000));
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
    for (let t0 = new Date(`${since}T00:00:00`).getTime(); t0 <= new Date(`${until}T00:00:00`).getTime(); t0 += 86_400_000) {
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
    for (let t0 = new Date(`${s2}T00:00:00`).getTime(); t0 <= new Date(`${u2}T00:00:00`).getTime(); t0 += 86_400_000) {
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
