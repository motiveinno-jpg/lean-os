"use client";

// 매출/KPI 현황판(결정 144, 드팜므 문의발 P2) — 흩어져 있던 매출 축(전표·목표·판매채널)을
//   위젯 한 판으로. 프로젝트 현황판(결정 141·142)과 **같은 빌더 문법·같은 저장 그릇**
//   (user_preferences.dashboard_grid, 화면 키 'sales-board') — 새로 배울 조작이 없다.
//
//   정직한 범위: 상품별 BEST·판매수량·취소/반품 위젯은 채널 주문 표에 품목·취소 데이터가
//   없어 **P1(이지어드민 연동) 뒤에** 붙는다 — 빈 위젯을 지어내지 않는다.
//   모든 숫자의 출처는 위젯 밑에 적는다(전표 확정 기준 / 채널 주문 / 대시보드 목표).

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { DateRangeField } from "@/components/date-range-field";
import { channelLabel } from "@/lib/inventory-channels";
import { groupByAccount, groupByPartner, monthlySeries, rangeDates } from "@/lib/pnl-status";
import { pnlAmount } from "@/lib/journal-reports";
import { usePnlStatus } from "./PnlStatusKit";

const DASH_KEY = "sales-board";
const CATALOG: { id: string; name: string; desc: string }[] = [
  { id: "nums", name: "숫자 카드 줄", desc: "기간 매출·비교 증감·건수·거래처" },
  { id: "monthly", name: "월별 매출", desc: "조회 기간 월별 · 비교 기간과 나란히" },
  { id: "partners", name: "거래처 TOP 5", desc: "어디서 많이 벌었나" },
  { id: "accounts", name: "계정별 구성", desc: "어떤 매출인지" },
  { id: "target", name: "목표 달성률", desc: "이번 달 목표 대비(대시보드 목표)" },
  { id: "channels", name: "판매채널별", desc: "채널 주문 합(재고 › 채널 주문)" },
];
const DEFAULT_W = ["nums", "monthly", "partners", "target"];

const won0 = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export function SalesBoard({ open, onClose, companyId }: {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
}) {
  const { toast } = useToast();
  //   독립형(2026-09-02 사장님 "재고 쪽으로 옮기자") — 매출 리포트의 조회 기간을 빌리지 않고
  //   전표 데이터를 스스로 불러온다(usePnlStatus — 기본 이번 달·전월 비교). 부모는 열릴 때만
  //   마운트해서(열기 전엔 안 불러옴) 낭비가 없다.
  const s = usePnlStatus();
  const range = s.range;
  const cmpLabel = s.cmpLabel;
  const lines = useMemo(() => s.curLines.filter((l) => l.section === "revenue"), [s.curLines]);
  const cmpLines = useMemo(() => s.cmpLines.filter((l) => l.section === "revenue"), [s.cmpLines]);
  const [edit, setEdit] = useState(false);
  const [cat, setCat] = useState(false);
  const [widgets, setWidgets] = useState<string[]>(DEFAULT_W);
  const [loaded, setLoaded] = useState(false);

  //   내 판 불러오기/저장 — 홈·프로젝트 현황판과 같은 그릇. (user_id, company_id) 유니크라
  //   onConflict 필수(2026-09-01 프로젝트 현황판에서 실측으로 잡은 함정과 동일 문법)
  useEffect(() => {
    if (!open || loaded || !companyId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data } = await (supabase as any).from("user_preferences").select("dashboard_grid")
        .eq("user_id", uid).eq("company_id", companyId).maybeSingle();
      const saved = data?.dashboard_grid?.[DASH_KEY]?.widgets;
      if (Array.isArray(saved) && saved.length > 0) setWidgets(saved.filter((w: string) => CATALOG.some((c) => c.id === w)));
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, companyId]);
  const save = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid || !companyId) { toast("저장 실패 — 로그인을 확인해주세요", "error"); return; }
    const { data } = await (supabase as any).from("user_preferences").select("dashboard_grid")
      .eq("user_id", uid).eq("company_id", companyId).maybeSingle();
    const merged = { ...(data?.dashboard_grid || {}), [DASH_KEY]: { widgets } };
    const { error } = await (supabase as any).from("user_preferences").upsert(
      { user_id: uid, company_id: companyId, dashboard_grid: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id,company_id" });
    if (error) { toast("저장 실패 — 잠시 후 다시 시도해주세요", "error"); return; }
    setEdit(false); setCat(false);
    toast("내 판으로 저장했습니다 — 다른 사람은 기본 판 그대로입니다", "success");
  };

  // ── 전표 축 ──
  const total = useMemo(() => lines.reduce((s, l) => s + pnlAmount(l), 0), [lines]);
  const cmpTotal = useMemo(() => cmpLines.reduce((s, l) => s + pnlAmount(l), 0), [cmpLines]);
  const deltaPct = cmpTotal > 0 ? Math.round(((total - cmpTotal) / cmpTotal) * 100) : null;
  const series = useMemo(() => monthlySeries(lines, rangeDates(range).from, rangeDates(range).to), [lines, range]);
  const partners = useMemo(() => groupByPartner(lines).slice(0, 5), [lines]);
  const accounts = useMemo(() => groupByAccount(lines).slice(0, 5), [lines]);
  const partnerCount = useMemo(() => groupByPartner(lines).length, [lines]);

  // ── 목표 축 — 대시보드(경영 목표)에서 온다. 이번 달 매출은 전표 lines 의 이번 달 합 ──
  const thisYm = new Date().toISOString().slice(0, 7);
  const { data: target } = useQuery({
    queryKey: ["sales-board-target", companyId, thisYm],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await (supabase as any).from("growth_targets")
        .select("period, target_revenue").eq("company_id", companyId).eq("period", thisYm).maybeSingle();
      return data as { period: string; target_revenue: number } | null;
    },
  });
  const thisMonthRev = useMemo(() => lines.filter((l) => l.month === thisYm).reduce((s, l) => s + pnlAmount(l), 0), [lines, thisYm]);
  const rangeHasThisMonth = range.fromYm <= thisYm && thisYm <= range.toYm;

  // ── 판매채널 축 — 채널 주문 합(취소·품목 데이터는 아직 없어 주문 금액만) ──
  const { data: channels = [] } = useQuery({
    queryKey: ["sales-board-channels", companyId, range.fromYm, range.toYm],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await (supabase as any).from("channel_order_imports")
        .select("channel, amount").eq("company_id", companyId)
        .gte("order_date", rangeDates(range).from).lte("order_date", rangeDates(range).to);
      const m = new Map<string, { amount: number; count: number }>();
      for (const r of (data || []) as { channel: string; amount: number }[]) {
        const cur = m.get(r.channel) || { amount: 0, count: 0 };
        cur.amount += Number(r.amount) || 0; cur.count += 1;
        m.set(r.channel, cur);
      }
      return [...m.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.amount - a.amount);
    },
  });

  if (!open) return null;
  const bar = (v: number, max: number) => `${max > 0 ? Math.max(2, (v / max) * 100) : 0}%`;

  return (
    <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="phv3-modal pjv3-dash-modal" role="dialog" aria-modal="true" aria-label="매출 KPI 현황판">
        <div className="pjv3-dash-head">
          <h3 className="phv3-modal-title !mb-0">매출 KPI 현황판</h3>
          <button type="button" className="btn-secondary btn-sm ml-auto"
            onClick={() => { setEdit((v) => !v); setCat(false); }}>{edit ? "편집 그만" : "내 판으로 고치기"}</button>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
        {/* 기간·비교 — 독립형이라 자체 컨트롤(기본 이번 달·전월 비교, 값 하나짜리라 즉시 반영) */}
        <div className="pjv3-pvbar !mb-2">
          <DateRangeField unit="month" label="기간" from={range.fromYm} to={range.toYm}
            onChange={(f, t) => s.setRange({ fromYm: f, toYm: t })} />
          <label>비교</label>
          <select value={s.compare} onChange={(e) => s.setCompare(e.target.value as "prev" | "yoy")} aria-label="비교 기간">
            <option value="prev">직전 기간</option>
            <option value="yoy">전년 동기</option>
          </select>
          {s.loading && <span className="text-[11px] text-[var(--text-dim)]">불러오는 중…</span>}
          <span className="ml-auto text-[10.5px] text-[var(--text-dim)]">확정 전표 기준 — 자세한 내역은 분석 › 손익 현황 › 매출</span>
        </div>
        {edit && (
          <div className="pjv3-dash-editbar">
            <b>편집 중 — 홈 대시보드와 같은 문법(＋위젯·↑↓·✕)</b>
            <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setCat((v) => !v)}>＋ 위젯</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setWidgets([...DEFAULT_W])}>기본 판으로 되돌리기</button>
            <button type="button" className="btn-primary btn-sm" onClick={save}>저장 — 내 판으로</button>
          </div>
        )}
        {edit && cat && (
          <div className="pjv3-dash-cat">
            {CATALOG.map((c) => (
              <button key={c.id} type="button" onClick={() => { setWidgets((w) => [...w, c.id]); setCat(false); }}>
                <b>{c.name}</b><small>{c.desc}</small>
              </button>
            ))}
          </div>
        )}
        <div className="pjv3-dash-body">
          {widgets.map((w, i) => (
            <div key={`${w}-${i}`} className={`pjv3-dw ${edit ? "editing" : ""}`}>
              {edit && (
                <div className="pjv3-dwbar">
                  <b>{CATALOG.find((c) => c.id === w)?.name}</b>
                  <span className="acts">
                    <button type="button" title="위로" disabled={i === 0}
                      onClick={() => setWidgets((arr) => { const n = [...arr]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                    <button type="button" title="아래로" disabled={i === widgets.length - 1}
                      onClick={() => setWidgets((arr) => { const n = [...arr]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>↓</button>
                    <button type="button" className="x" title="빼기"
                      onClick={() => setWidgets((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                  </span>
                </div>
              )}
              {w === "nums" && (
                <div className="pjv3-strow !mb-0">
                  <span className="pjv3-stcard"><span className="k">기간 매출</span><b className="v num">{won0(total)}</b></span>
                  <span className={`pjv3-stcard ${deltaPct != null && deltaPct < 0 ? "warn" : "good"}`}>
                    <span className="k">{cmpLabel} 대비</span>
                    <b className="v num">{deltaPct == null ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`}</b></span>
                  <span className="pjv3-stcard"><span className="k">전표 건수</span><b className="v num">{lines.length.toLocaleString("ko-KR")}</b></span>
                  <span className="pjv3-stcard"><span className="k">거래처</span><b className="v num">{partnerCount}곳</b></span>
                </div>
              )}
              {w === "monthly" && (
                <div className="pjv3-stpanel">
                  <h3>월별 매출 <small>확정 전표 기준</small></h3>
                  {series.map((m) => {
                    const max = Math.max(1, ...series.map((x) => x.amount));
                    return (
                      <div key={m.month} className="pjv3-sthbar" style={{ cursor: "default", gridTemplateColumns: "64px 1fr 110px" }}>
                        <span className="nm num">{m.month.slice(2)}</span>
                        <span className="track"><span className="fill" style={{ width: bar(m.amount, max), background: "var(--primary)" }} /></span>
                        <span className="n num">{won0(m.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {w === "partners" && (
                <div className="pjv3-stpanel">
                  <h3>거래처 TOP 5 <small>확정 전표 기준</small></h3>
                  {partners.length === 0 && <div className="pjv3-stempty">조회 기간에 매출 전표가 없습니다</div>}
                  {partners.map((g) => {
                    const max = Math.max(1, ...partners.map((x) => x.amount));
                    return (
                      <div key={g.key} className="pjv3-sthbar" style={{ cursor: "default", gridTemplateColumns: "110px 1fr 110px" }}>
                        <span className="nm">{g.label}</span>
                        <span className="track"><span className="fill" style={{ width: bar(g.amount, max), background: "var(--primary)" }} /></span>
                        <span className="n num">{won0(g.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {w === "accounts" && (
                <div className="pjv3-stpanel">
                  <h3>계정별 구성 <small>어떤 매출인지 — 확정 전표 기준</small></h3>
                  {accounts.length === 0 && <div className="pjv3-stempty">조회 기간에 매출 전표가 없습니다</div>}
                  {accounts.map((g) => {
                    const max = Math.max(1, ...accounts.map((x) => x.amount));
                    return (
                      <div key={g.key} className="pjv3-sthbar" style={{ cursor: "default", gridTemplateColumns: "110px 1fr 110px" }}>
                        <span className="nm">{g.label}</span>
                        <span className="track"><span className="fill" style={{ width: bar(g.amount, max), background: "#00C875" }} /></span>
                        <span className="n num">{won0(g.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {w === "target" && (
                <div className="pjv3-stpanel">
                  <h3>목표 달성률 <small>이번 달({thisYm.slice(5)}월) — 목표는 홈 대시보드의 경영 목표에서</small></h3>
                  {!target?.target_revenue ? (
                    <div className="pjv3-stempty">이번 달 매출 목표가 없습니다 — 홈 대시보드의 목표 설정에서 월 목표를 넣으면 여기 달성률이 뜹니다</div>
                  ) : !rangeHasThisMonth ? (
                    <div className="pjv3-stempty">조회 기간에 이번 달이 없어 계산하지 않습니다 — 기간을 이번 달로 두면 보입니다</div>
                  ) : (
                    <>
                      <div className="pjv3-sthbar" style={{ cursor: "default", gridTemplateColumns: "64px 1fr 56px" }}>
                        <span className="nm">달성</span>
                        <span className="track"><span className="fill" style={{ width: `${Math.min(100, Math.round(thisMonthRev / Number(target.target_revenue) * 100))}%`, background: "#00C875" }} /></span>
                        <span className="n num">{Math.round(thisMonthRev / Number(target.target_revenue) * 100)}%</span>
                      </div>
                      <p className="pjv3-stnote">이번 달 매출 {won0(thisMonthRev)} / 목표 {won0(Number(target.target_revenue))}</p>
                    </>
                  )}
                </div>
              )}
              {w === "channels" && (
                <div className="pjv3-stpanel">
                  <h3>판매채널별 <small>채널 주문 합(재고 › 채널 주문) — 상품별·취소/반품은 이지어드민 연동 뒤에</small></h3>
                  {channels.length === 0 && <div className="pjv3-stempty">조회 기간에 채널 주문이 없습니다 — 재고 › 채널 주문에서 수집·붙여넣기하면 여기 모입니다</div>}
                  {channels.map((c) => {
                    const max = Math.max(1, ...channels.map((x) => x.amount));
                    return (
                      <div key={c.channel} className="pjv3-sthbar" style={{ cursor: "default", gridTemplateColumns: "110px 1fr 130px" }}>
                        <span className="nm">{channelLabel(c.channel)}</span>
                        <span className="track"><span className="fill" style={{ width: bar(c.amount, max), background: "#FDAB3D" }} /></span>
                        <span className="n num">{won0(c.amount)} · {c.count}건</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {widgets.length === 0 && <div className="pjv3-stempty">위젯을 다 뺐습니다 — [기본 판으로 되돌리기] 또는 ＋ 위젯</div>}
        </div>
        <p className="pjv3-stnote">저장하면 내 계정에만 적용됩니다 · 전표 축은 위 기간을 따릅니다 — 거래처·계정 상세는 분석 › 손익 현황 › 매출, 상품·채널 상세는 이 화면(이익관리)의 표에서</p>
      </div>
    </div>
  );
}
