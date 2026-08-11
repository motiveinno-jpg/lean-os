"use client";

// 수집·전표 — 1단계: 수집 현황판 (2026-08-11 사장님 지시)
//
//   그동안 수집 버튼이 다섯 화면에 흩어져 있어 "지금 어디까지 받아 놨나"를 한눈에 못 봤다.
//   이 화면은 그 질문 하나만 답한다. 자료 카드를 누르면 그 자료의 목록으로,
//   '수집하기'를 누르면 전부/선택으로 받아온다.
//
//   실행 경로는 lib/collect 가 기존 화면들의 호출을 그대로 재사용한다 — 여기서 새로 만들지 않는다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { todayKst } from "@/lib/kst";
import {
  SOURCES, HOMETAX_SOURCES, fetchCollectStatus,
  runCollect, type SourceKey, type RunState,
} from "@/lib/collect";

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

  const [month, setMonth] = useState(todayKst().slice(0, 7));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SourceKey[]>(SOURCES.map((s) => s.key));
  const [mode, setMode] = useState<"new" | "range">("new");
  const [rangeFrom, setRangeFrom] = useState(`${todayKst().slice(0, 7)}-01`);
  const [rangeTo, setRangeTo] = useState(todayKst());
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<Record<string, RunState>>({});

  //   쿨타임·요금제 — 자료마다 세는 단위가 달라 셋을 다 본다
  const cdHometax = useSyncCooldown(companyId, "hometax");
  const cdBank = useSyncCooldown(companyId, "bank");
  const cdCard = useSyncCooldown(companyId, "card");
  const cdOf = (key: SourceKey) =>
    HOMETAX_SOURCES.includes(key) ? cdHometax : key === "bank" ? cdBank : cdCard;

  const { data: status, isLoading } = useQuery({
    queryKey: ["collect-status", companyId, month],
    queryFn: () => fetchCollectStatus(companyId!, month),
    enabled: !!companyId,
    staleTime: 30_000,
  });

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
    if (!status) return `${month}-01`;
    const days = picked
      .map((k) => status[k]?.lastSyncAt)
      .filter(Boolean)
      .map((iso) => String(iso).slice(0, 10));
    if (days.length === 0) return `${month}-01`;
    return days.sort()[0];
  }, [status, picked, month]);

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
    if (!companyId || runnable.length === 0) return;
    setRunning(true);
    setState(Object.fromEntries(runnable.map((k) => [k, { phase: "wait" } as RunState])));
    try { localStorage.setItem("collect-picked", JSON.stringify(picked)); } catch { /* ignore */ }
    //   요금제·쿨타임을 서버가 한 번 더 검사하고 기록한다 (자료 종류별로 각각)
    const types = [...new Set(runnable.map((k) => (HOMETAX_SOURCES.includes(k) ? "hometax" : k)))];
    for (const t of types) {
      await (t === "hometax" ? cdHometax : t === "bank" ? cdBank : cdCard).run(async () => { /* 소모만 */ });
    }
    try {
      await runCollect({
        companyId, sources: runnable, startDate: start, endDate: end,
        onChange: (key, s) => setState((prev) => ({ ...prev, [key]: s })),
      });
      qc.invalidateQueries({ queryKey: ["collect-status"] });
      qc.invalidateQueries({ queryKey: ["sync-cooldowns"] });
      toast("수집이 끝났습니다", "success");
    } catch (e: any) {
      toast(`수집 실패: ${e?.message || "알 수 없는 오류"}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const totalPending = SOURCES.reduce((n, s) => n + (status?.[s.key]?.pending ?? 0), 0);

  return (
    <div className="collect-page">
      {/* ── 툴바 ── */}
      <div className="collect-toolbar">
        <label className="collect-toolbar-label">조회월</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="collect-month" />
        <span className="collect-toolbar-hint">
          자료를 누르면 그 목록으로 갑니다 · 처리할 것 <b>{won(totalPending)}</b>건
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setOpen(true)} disabled={running}
            className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {running ? "수집 중…" : "수집하기"}
          </button>
        </div>
      </div>

      {/* ── 자료 카드 ── */}
      {isLoading ? (
        <div className="collect-empty">현황을 읽는 중…</div>
      ) : (
        <div className="collect-grid">
          {SOURCES.map((s) => {
            const st = status?.[s.key];
            const cd = cdOf(s.key);
            const run = state[s.key];
            const broken = !!st?.brokenNote;
            return (
              <Link key={s.key} href={s.href}
                className={broken ? "collect-src collect-src-bad no-underline" : "collect-src no-underline"}>
                <div className="collect-src-top">
                  <span className="collect-src-ico">{s.icon}</span>
                  <span className="collect-src-name">{s.label}</span>
                  <span className="collect-src-n mono-number">
                    {won(st?.total ?? 0)}<small>건</small>
                  </span>
                </div>
                <div className="collect-src-meta">
                  <span>마지막 수집 {fmtWhen(st?.lastSyncAt ?? null)}
                    {st?.lastSeconds != null && <span className="collect-dim"> · 지난번 {fmtSec(st.lastSeconds)}</span>}
                  </span>
                  <span className="mono-number">
                    {st?.latestDate ? `가진 자료 최근 ${st.latestDate}` : "이 달에 받아온 자료가 없습니다"}
                  </span>
                </div>
                <div className="collect-src-foot">
                  {broken ? (
                    <span className="collect-pill collect-pill-err">{st!.brokenNote}</span>
                  ) : (st?.pending ?? 0) > 0 ? (
                    <span className="collect-pill collect-pill-todo">
                      {s.key === "bank" ? "미처리" : "전표 미처리"} {won(st!.pending)}
                    </span>
                  ) : (st?.total ?? 0) === 0 ? (
                    //   0건을 '처리 완료'라고 하면 다 해놓은 것처럼 읽힌다 — 받아온 게 없는 것뿐이다
                    <span className="collect-pill collect-pill-none">받아온 자료 없음</span>
                  ) : (
                    <span className="collect-pill collect-pill-done">처리 완료</span>
                  )}
                  {cd.disabled && <span className="collect-lock">{cd.label}</span>}
                  <span className="collect-mini">
                    {run?.phase === "running" ? `수집 중… ${run.message ?? ""}`
                      : run?.phase === "done" ? `${won(run.synced ?? 0)}건 받음`
                      : run?.phase === "error" ? run.message
                      //   고장난 자료는 목록을 열어 봐야 볼 게 없다 — 알아야 할 건 '왜 0건인가'다
                      : broken ? "원인 보기 →"
                      : (st?.total ?? 0) === 0 ? "받아오기 →"
                      : s.key === "bank" ? "처리하기 →" : "전표 만들기 →"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="collect-note">
        ※ 수집은 <b>회사 전체가 함께</b> 씁니다 — 팀원이 방금 받았으면 30분 동안 다시 받을 수 없습니다.
        홈택스는 같은 계정으로 동시 접속이 안 되어 <b>세금계산서·계산서·현금영수증은 차례대로</b> 돌고,
        <b>통장·카드는 그와 동시에</b> 돕니다.
      </p>

      {/* ── 수집 창 ── */}
      {open && (
        <div className="collect-overlay" onClick={() => !running && setOpen(false)}>
          <div className="collect-box" onClick={(e) => e.stopPropagation()}>
            <div className="collect-box-head">
              <b>자료 수집</b>
              <button type="button" onClick={() => !running && setOpen(false)} aria-label="닫기">✕</button>
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
                        {st?.brokenNote ? "점검 중" : st?.lastSeconds != null ? `지난번 ${fmtSec(st.lastSeconds)}` : "기록 없음"}
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
                    <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="collect-date" />
                    <span className="collect-dim">~</span>
                    <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="collect-date" />
                  </span>
                )}
              </div>

              {running && (
                <div className="collect-steps">
                  {picked.map((k) => {
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
                            : r?.phase === "error" ? "실패"
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
                  <button type="button" onClick={() => setOpen(false)} disabled={running} className="btn-secondary btn-sm">
                    {running ? "뒤에서 계속됩니다" : "취소"}
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
