"use client";

// 수집·전표 — 1단계: 수집 현황판 (2026-08-11 사장님 지시)
//
//   그동안 수집 버튼이 다섯 화면에 흩어져 있어 "지금 어디까지 받아 놨나"를 한눈에 못 봤다.
//   이 화면은 그 질문 하나만 답한다. 자료 카드를 누르면 그 자료의 목록으로,
//   '수집하기'를 누르면 전부/선택으로 받아온다.
//
//   실행 경로는 lib/collect 가 기존 화면들의 호출을 그대로 재사용한다 — 여기서 새로 만들지 않는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { todayKst } from "@/lib/kst";
import {
  SOURCES, HOMETAX_SOURCES, fetchCollectStatus, fetchSyncHistory,
  type SourceKey,
} from "@/lib/collect";
import { useCollectRun, startCollect, restoreCollectRun } from "@/lib/collect-run";
import { EvidenceTab } from "./_components/EvidenceTab";
import { BankTab } from "./_components/BankTab";
import { RulesDialog } from "./_components/RulesDialog";
import { DateRangeField } from "@/components/date-range-field";
import { QueryScreen, QueryHead, QueryBar, ResultStrip, HelperMenu, defaultRange, type HelperItem } from "@/components/query-kit";

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "아직 없음";
const fmtSec = (s: number | null) => {
  if (s == null) return null;
  if (s < 60) return `${s}초`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}분` : `${Math.round(m / 60)}시간 ${m % 60}분`;
};

export default function CollectPage() {
  const { role } = useUser();
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="자료 수집은 대표·관리자 전용입니다." />;
  }
  return <CollectInner />;
}

function CollectInner() {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const companyId = user?.company_id ?? null;

  //   조회기간 — 기본은 **최근 1개월** (2026-08-13 사장님 확정).
  //   이번 달 1일 기준이면 매달 1~2일에 열었을 때 하루이틀치만 보여 '자료 없음'으로 읽힌다.
  const [range, setRange] = useState(defaultRange);
  const { from, to } = range;
  //   탭 — 'status' 는 현황판, 나머지는 그 자료의 목록 (2단계)
  //   ?tab=bank 같은 주소로 바로 그 탭을 연다 — 다른 화면들이 "여기서 처리하세요"로 보낼 때 쓴다
  const [tab, setTab] = useState<"status" | SourceKey>(() => {
    if (typeof window === "undefined") return "status";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (t && (t === "status" || SOURCES.some((s) => s.key === t)) ? t : "status") as "status" | SourceKey;
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SourceKey[]>(SOURCES.map((s) => s.key));
  const [mode, setMode] = useState<"new" | "range">("new");
  const [rangeFrom, setRangeFrom] = useState(() => defaultRange().from);   // 최근 1개월 — 다른 조회 화면과 통일 (2026-09-03 사장님)
  const [rangeTo, setRangeTo] = useState(todayKst());
  //   ★ 진행 상태는 화면 밖(collect-run 싱글턴)에 있다 — 다른 메뉴로 갔다 와도 그대로 보이고, 통장·카드 수집도 끊기지 않는다
  //     (2026-08-27 사장님: "전표 수집 시 백그라운드 수집이 안 됨"). 새로고침 뒤에는 스냅샷을 되살려 홈택스 job 을 이어 기다린다.
  const run = useCollectRun();
  const running = run.running;
  const state = run.state;
  useEffect(() => { restoreCollectRun(); }, []);
  //   끝났을 때 알린다 — 시작한 화면이 아니어도(여기로 돌아온 순간) 한 번
  const seenFinish = useRef<number | null>(null);
  useEffect(() => {
    if (!run.finishedAt || seenFinish.current === run.finishedAt) return;
    seenFinish.current = run.finishedAt;
    qc.invalidateQueries({ queryKey: ["collect-status"] });
    qc.invalidateQueries({ queryKey: ["sync-cooldowns"] });
    if (Date.now() - run.finishedAt < 60_000) {
      const errs = Object.values(run.state).filter((r) => r.phase === "error").length;
      toast(errs ? `수집이 끝났습니다 — ${errs}종은 받지 못했습니다(창을 열어 확인)` : "수집이 끝났습니다", errs ? "info" : "success");
    }
  }, [run.finishedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  //   쿨타임·요금제 — 자료마다 세는 단위가 달라 셋을 다 본다
  const cdHometax = useSyncCooldown(companyId, "hometax");
  const cdBank = useSyncCooldown(companyId, "bank");
  const cdCard = useSyncCooldown(companyId, "card");
  const cdOf = (key: SourceKey) =>
    HOMETAX_SOURCES.includes(key) ? cdHometax : key === "bank" ? cdBank : cdCard;

  const { data: status, isLoading } = useQuery({
    queryKey: ["collect-status", companyId, from, to],
    queryFn: () => fetchCollectStatus(companyId!, from, to),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  //   최근 수집 이력 — '받았는데 0건'인지 '못 받은' 것인지 여기서 갈린다 (2026-08-13 C안)
  const { data: history = [] } = useQuery({
    queryKey: ["collect-history", companyId],
    queryFn: () => fetchSyncHistory(companyId!, 30),
    enabled: !!companyId && tab === "status",
    staleTime: 30_000,
  });

  //   ★ 조회기간은 **기억하지 않는다** (2026-08-13 사장님 지시).
  //     예전엔 localStorage 에 마지막 기간을 남겨 다녀와도 그대로 떴다. 두 가지가 나빴다 —
  //     ① 지금 보고 있는 게 무슨 조건인지 모른 채 목록만 본다  ② PC 를 바꾸면 안 따라온다.
  //     화면 안에 머무는 동안만 유지하고(그냥 상태다), 자주 쓰는 조건은 '내 조건'에 이름을 붙인다.
  const applyRange = (f: string, t: string) => setRange({ from: f, to: t });

  //   마지막에 고른 대로 다시 열린다 — 매번 통장만 받는 사람이 매번 체크를 다시 할 이유가 없다
  useEffect(() => {
    try {
      const saved = localStorage.getItem("collect-picked");
      if (saved) {
        const arr = JSON.parse(saved) as SourceKey[];
        if (Array.isArray(arr) && arr.length > 0) setPicked(arr.filter((k) => SOURCES.some((s) => s.key === k)));
      }
    } catch { /* 저장값이 깨졌으면 기본(전부)으로 */ }
  }, []);

  const allPicked = picked.length === SOURCES.length;
  const toggle = (key: SourceKey) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  //   '새로 들어온 것만' = 고른 자료 중 가장 오래된 마지막 수집일부터. 기록이 없으면 이번 달 1일부터.
  const autoFrom = useMemo(() => {
    if (!status) return from;
    const days = picked
      .map((k) => status[k]?.lastSyncAt)
      .filter(Boolean)
      .map((iso) => String(iso).slice(0, 10));
    if (days.length === 0) return from;
    return days.sort()[0];
  }, [status, picked, from]);

  const start = mode === "new" ? autoFrom : rangeFrom;
  const end = mode === "new" ? todayKst() : rangeTo;

  //   고른 것 중 하나라도 막혀 있으면 그 자료만 빠진다 — 전체를 못 하게 막지 않는다
  const runnable = picked.filter((k) => !cdOf(k).disabled);
  const blocked = picked.filter((k) => cdOf(k).disabled);
  const estimate = useMemo(() => {
    if (!status) return null;
    const secs = runnable.map((k) => status[k]?.lastSeconds).filter((v): v is number => typeof v === "number");
    if (secs.length === 0) return null;
    //   홈택스는 차례대로, 통장·카드는 동시에 — 합이 아니라 '홈택스 합 vs 나머지 최댓값' 중 큰 쪽
    const ht = runnable.filter((k) => HOMETAX_SOURCES.includes(k))
      .reduce((sum, k) => sum + (status[k]?.lastSeconds ?? 0), 0);
    const rest = runnable.filter((k) => !HOMETAX_SOURCES.includes(k))
      .reduce((max, k) => Math.max(max, status[k]?.lastSeconds ?? 0), 0);
    return Math.max(ht, rest);
  }, [status, runnable]);

  const go = async () => {
    if (!companyId || runnable.length === 0 || running) return;
    try { localStorage.setItem("collect-picked", JSON.stringify(picked)); } catch { /* ignore */ }
    //   요금제·쿨타임을 서버가 한 번 더 검사하고 기록한다 (자료 종류별로 각각)
    const types = [...new Set(runnable.map((k) => (HOMETAX_SOURCES.includes(k) ? "hometax" : k)))];
    for (const t of types) {
      await (t === "hometax" ? cdHometax : t === "bank" ? cdBank : cdCard).run(async () => { /* 소모만 */ });
    }
    //   여기서부터는 화면 밖에서 돈다 — 창을 닫고 다른 메뉴로 가도 계속된다
    startCollect({ companyId, sources: runnable, startDate: start, endDate: end });
  };

  const totalPending = SOURCES.reduce((n, s) => n + (status?.[s.key]?.pending ?? 0), 0);
  //   진행 카운트 — 창을 닫아도 겉 버튼에 몇 개째인지 보인다
  const totalCount = Object.keys(state).length;
  const doneCount = Object.values(state).filter((r) => r.phase === "done" || r.phase === "error" || r.phase === "skip").length;

  //   조회 줄의 공통 조각 — 현황판이 직접 쓰고, 목록 탭에는 통째로 내려보낸다.
  //   탭마다 조건(매출·매입, 미처리만 …)이 달라서 **조회 줄은 탭이 완성**한다.
  //   기간과 '수집하기'까지 탭 안에 다시 만들면 두 벌이 되어 언젠가 어긋난다.
  //   ★ 현황판에는 검색조건 패널이 없으므로 여기서만 달력(parts="all")을 쓴다.
  //     목록 탭은 숫자 칸만 두고 달력을 검색조건 안으로 넣는다 (탭이 직접 그린다).
  const rangeField = <DateRangeField from={from} to={to} onChange={applyRange} />;
  //   ★ 도는 중에도 **누를 수 있다** — 창을 닫았다가 진행 상황을 다시 열어 보는 길이다
  //     (2026-08-13 사장님 지시: "닫기 눌렀을 때 창 닫히고 백그라운드에서 돌고").
  //     막아 두면 닫는 순간 진행 상황을 볼 방법이 사라진다.
  const syncButton = (
    <button type="button" onClick={() => setOpen(true)}
      className={running ? "btn-secondary btn-sm collect-running" : "btn-primary btn-sm"}>
      {running ? `수집 중 ${doneCount}/${totalCount} · 보기` : "수집하기"}
    </button>
  );
  //   배운 규칙을 볼 수 있어야 한다 — 안 보이는 자동화는 틀렸을 때 고칠 방법이 없다.
  //   조회 조건이 아니므로 조회 줄이 아니라 '도움' 안에 둔다.
  //   ★ 출처를 적는다 — 이건 AI 가 아니라 **사람이 고른 것을 기억해 둔 것**이다.
  //     'AI 제안' 안에 있다고 전부 AI 라고 하면 틀렸을 때 원인을 엉뚱한 데서 찾는다.
  const rulesHelper: HelperItem = {
    label: "배운 규칙 보기",
    source: "내가 배운 규칙",
    hint: "전에 고른 계정을 어떻게 기억해 뒀는지 보고 고칩니다",
    onClick: () => setRulesOpen(true),
  };

  //   ── 갈래 탭 — 현황판 + 자료별 목록.
  //   ★ 탭도 **조회 상자 안에** 들어간다 (2026-08-13 사장님 지시) — 탭·조회 줄·결과 요약이
  //     낱장으로 흩어져 있으면 어디까지가 '조회하는 곳'인지 눈으로 안 갈린다.
  //     그래서 탭을 여기서 만들어 목록 탭에도 내려보낸다(조회 줄은 탭이 완성하므로).
  const tabsNode = (
    <div className="collect-tabs">
      <button type="button" onClick={() => setTab("status")}
        className={tab === "status" ? "collect-tab collect-tab-on" : "collect-tab"}>수집 현황</button>
      {SOURCES.map((s) => (
        <button key={s.key} type="button" onClick={() => setTab(s.key)}
          className={tab === s.key ? "collect-tab collect-tab-on" : "collect-tab"}>
          {s.label}
          <span className="collect-tab-cnt">{won(status?.[s.key]?.pending ?? 0)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="collect-page">
      {/* ── 자료별 목록 (2단계) · 통장은 매칭까지 흡수한 3단계 화면 ── */}
      {tab !== "status" && companyId && (
        tab === "bank"
          ? <BankTab companyId={companyId} from={from} to={to} tabsNode={tabsNode}
              onRange={applyRange} syncButton={syncButton} rulesHelper={rulesHelper} />
          : <EvidenceTab companyId={companyId} from={from} to={to} kind={tab} tabsNode={tabsNode}
              onRange={applyRange} syncButton={syncButton} rulesHelper={rulesHelper} />
      )}

      {/* ── 현황판 — 탭·조회 줄·자료 표·수집 이력을 **한 상자**에 (2026-08-13 사장님 C안 승인).
             카드 격자였는데, 상자에 높이를 주자 격자가 남는 높이를 행에 나눠 줘 카드가
             351px 로 늘어나고 아래가 텅 비었다. 그리고 이 화면이 하는 일은 다섯 자료를
             **비교**하는 것이라 세로로 줄 세우는 표가 맞다(다른 탭도 전부 표다). ── */}
      {tab === "status" && (
        <QueryScreen>
          <QueryHead>
            {tabsNode}
            <QueryBar right={<>
              <HelperMenu items={[rulesHelper]} />
              {syncButton}
            </>}>{rangeField}</QueryBar>
            <ResultStrip>
              <span className="collect-toolbar-hint">
                자료를 누르면 그 목록으로 갑니다 · 처리할 것 <b>{won(totalPending)}</b>건
              </span>
            </ResultStrip>
          </QueryHead>

          {isLoading ? (
            <div className="collect-empty">현황을 읽는 중…</div>
          ) : (
            <div className="cs-split">
              {/* 자료별 현황 — 다섯 줄 */}
              <div className="cs-top">
                <table className="ev-table cs-table">
                  <thead>
                    <tr>
                      <th className="th-c cs-name-th">자료</th>
                      <th className="th-c" title="이 자료로 받아 둔 건수">받아온 건수</th>
                      <th className="th-c" title="받아왔지만 아직 전표를 만들지 않은 건수">전표 안 만든 것</th>
                      <th className="th-c" title="받아 둔 자료 중 가장 최근 거래일">자료 최근일</th>
                      <th className="th-c">마지막 수집</th>
                      <th className="th-c" title="마지막 수집에 걸린 시간">걸린 시간</th>
                      <th className="th-c">다음 수집</th>
                      <th className="th-c" />
                    </tr>
                  </thead>
                  <tbody>
                    {SOURCES.map((s) => {
                      const st = status?.[s.key];
                      const cd = cdOf(s.key);
                      const run = state[s.key];
                      const broken = !!st?.brokenNote;
                      return (
                        <tr key={s.key} onClick={() => setTab(s.key)}
                          className={broken ? "cs-row cs-row-bad" : "cs-row"}>
                          <td>
                            <span className="cs-name">
                              <i className="cs-ico">{s.icon}</i>{s.label}
                            </span>
                          </td>
                          <td className="tr mono-number cs-total">{won(st?.total ?? 0)}</td>
                          <td className="tc">
                            {broken ? (
                              <span className="collect-pill collect-pill-err">{st!.brokenNote}</span>
                            ) : (st?.pending ?? 0) > 0 ? (
                              <span className="collect-pill collect-pill-todo">{won(st!.pending)}</span>
                            ) : (st?.total ?? 0) === 0 ? (
                              //   0건을 '처리 완료'라고 하면 다 해놓은 것처럼 읽힌다 — 받아온 게 없는 것뿐이다
                              <span className="collect-pill collect-pill-none">자료 없음</span>
                            ) : (
                              <span className="collect-pill collect-pill-done">완료</span>
                            )}
                          </td>
                          <td className="tc mono-number cs-dim">{st?.latestDate ?? "—"}</td>
                          <td className="tc cs-dim">{fmtWhen(st?.lastSyncAt ?? null)}</td>
                          <td className="tc cs-dim">{fmtSec(st?.lastSeconds ?? null) ?? "—"}</td>
                          <td className="tc cs-dim">{cd.disabled ? cd.label : "지금 가능"}</td>
                          <td className="tc">
                            <span className="cs-go">
                              {run?.phase === "running" ? `수집 중… ${run.message ?? ""}`
                                : run?.phase === "done" ? `${won(run.synced ?? 0)}건 받음`
                                : run?.phase === "error" ? run.message
                                //   고장난 자료는 목록을 열어 봐야 볼 게 없다 — 알아야 할 건 '왜 0건인가'다
                                : broken ? "원인 보기 →"
                                : (st?.total ?? 0) === 0 ? "받아오기 →"
                                : s.key === "bank" ? "처리하기 →" : "전표 만들기 →"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>합계</td>
                      <td className="tr mono-number">{won(SOURCES.reduce((n, s) => n + (status?.[s.key]?.total ?? 0), 0))}</td>
                      <td className="tc mono-number">{won(totalPending)}</td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* 최근 수집 이력 — '받았는데 0건'인지 '못 받은' 것인지 여기서 갈린다 */}
              <div className="cs-btm">
                <div className="cs-hist-h">
                  최근 수집 이력
                  <span>· 언제 누가 무엇을 받았나 (실패도 남습니다)</span>
                </div>
                {history.length === 0 ? (
                  <p className="cs-hist-empty">아직 수집 기록이 없습니다.</p>
                ) : (
                  <table className="ev-table cs-hist">
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td className="mono-number cs-dim cs-hist-when">{fmtWhen(h.at)}</td>
                          <td className="cs-hist-who">{h.auto ? <em className="cs-auto">자동</em> : (h.by ?? "—")}</td>
                          <td>
                            <span className={h.status === "success" ? "cs-dot" : h.status === "partial" ? "cs-dot cs-dot-warn" : "cs-dot cs-dot-bad"} />
                            {h.what}
                          </td>
                          <td className="tr mono-number cs-hist-n">{h.count != null ? `${won(h.count)}건` : "—"}</td>
                          <td className="cs-hist-note">{h.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </QueryScreen>
      )}
      {rulesOpen && companyId && <RulesDialog companyId={companyId} onClose={() => setRulesOpen(false)} />}

      {/* ── 수집 창 ── */}
      {open && (
        <div className="collect-overlay" onClick={() => setOpen(false)}>
          <div className="collect-box" onClick={(e) => e.stopPropagation()}>
            <div className="collect-box-head">
              <b>자료 수집</b>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
            </div>

            <div className="collect-box-body">
              <div className="collect-seg-row">
                <div className="collect-seg">
                  <button type="button" className={allPicked ? "collect-seg-on" : ""}
                    onClick={() => setPicked(SOURCES.map((s) => s.key))}>전부</button>
                  {/*   '선택'은 전부 해제 — 그 다음 원하는 것만 켠다. 체크를 하나라도 풀면 자동으로 이 상태다 */}
                  <button type="button" className={!allPicked ? "collect-seg-on" : ""}
                    onClick={() => setPicked([])}>
                    선택
                  </button>
                </div>
                <span className="collect-dim text-[11px]">마지막에 고른 대로 열립니다</span>
              </div>

              <div className="collect-picks">
                {SOURCES.map((s) => {
                  const st = status?.[s.key];
                  const cd = cdOf(s.key);
                  const on = picked.includes(s.key);
                  return (
                    <button key={s.key} type="button" onClick={() => !running && toggle(s.key)}
                      className={on ? "collect-pick collect-pick-on" : "collect-pick"}>
                      <span className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</span>
                      <span className="collect-pick-col">
                        <span className="collect-pick-name">{s.icon} {s.label}</span>
                        <span className="collect-pick-sub mono-number">
                          마지막 수집 {fmtWhen(st?.lastSyncAt ?? null)}
                          {cd.disabled && <span className="collect-pick-block"> · {cd.label}</span>}
                        </span>
                      </span>
                      <span className={st?.brokenNote ? "collect-est collect-est-err" : "collect-est"}>
                        {st?.brokenNote ? "점검 중" : st?.lastSeconds != null ? `${fmtSec(st.lastSeconds)}` : "기록 없음"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="collect-seg-row">
                <span className="collect-toolbar-label">받아올 기간</span>
                <div className="collect-seg">
                  <button type="button" className={mode === "new" ? "collect-seg-on" : ""} onClick={() => setMode("new")}>
                    새로 들어온 것만
                  </button>
                  <button type="button" className={mode === "range" ? "collect-seg-on" : ""} onClick={() => setMode("range")}>
                    기간 지정
                  </button>
                </div>
                {mode === "new" ? (
                  <span className="collect-dim mono-number text-[11px]">{start} ~ {end}</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <DateField value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="collect-date" />
                    <span className="collect-dim">~</span>
                    <DateField value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="collect-date" />
                  </span>
                )}
              </div>

              {running && (
                <p className="collect-bg-note">
                  창을 닫아도 <b>수집은 계속됩니다</b> — 다른 화면에서 일하셔도 됩니다.
                  진행 상황은 <b>수집 중 · 보기</b> 를 눌러 다시 열 수 있습니다.
                </p>
              )}
              {/*   끝난 뒤에도 지난 결과가 남는다 — 다른 화면에 갔다 와서 "받았나?" 를 여기서 확인한다 (2026-08-27) */}
              {!running && run.finishedAt && Object.keys(state).length > 0 && (
                <p className="collect-bg-note">
                  지난 수집 결과 ({new Date(run.finishedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}) — 실패한 자료는 다시 받으세요.
                </p>
              )}
              {(running || Object.keys(state).length > 0) && (
                <div className="collect-steps">
                  {(running ? picked : run.sources).map((k) => {
                    const s = SOURCES.find((x) => x.key === k)!;
                    const r = state[k];
                    return (
                      <div key={k} className={r?.phase && r.phase !== "wait" ? "collect-step" : "collect-step collect-step-wait"}>
                        <span className="collect-step-lbl">{s.label}</span>
                        <span className="collect-step-bar">
                          <i style={{ width: r?.phase === "done" ? "100%" : r?.phase === "running" ? "60%" : "0%" }} />
                        </span>
                        <span className="collect-step-val">
                          {r?.phase === "done" ? `완료 ${won(r.synced ?? 0)}건`
                            : r?.phase === "error" ? <span title={r.message}>실패{r.message ? ` — ${r.message}` : ""}</span>
                            : r?.phase === "running" ? (r.message || "수집 중…")
                            : "대기"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="collect-sumbar">
                <span className="collect-sum-big">
                  {picked.length === SOURCES.length ? "전부" : `${picked.length}종`} 선택
                </span>
                <span className="collect-dim text-[11.5px]">
                  {estimate != null ? <>예상 <b className="mono-number">{fmtSec(estimate)}</b></> : "예상 시간은 한 번 받아 본 뒤부터 나옵니다"}
                  {blocked.length > 0 && <span className="collect-pick-block"> · {blocked.length}종은 지금 못 받습니다</span>}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {/*   ★ 예전엔 '뒤에서 계속됩니다' 라고 적어 놓고 **못 누르게** 해 뒀다 —
                        되는 척하는 UI 는 없느니만 못하다. 이제 정말 닫히고 수집은 계속된다. */}
                  <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-sm">
                    {running ? "닫고 계속 받기" : "취소"}
                  </button>
                  <button type="button" onClick={go} disabled={running || runnable.length === 0}
                    className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
                    {running ? "수집 중…" : "수집 시작"}
                  </button>
                </span>
              </div>

              {blocked.length > 0 && (
                <p className="collect-block-note">
                  {blocked.map((k) => `${SOURCES.find((s) => s.key === k)!.label}(${cdOf(k).label})`).join(" · ")}
                  {" — "}{cdOf(blocked[0]).hint}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
