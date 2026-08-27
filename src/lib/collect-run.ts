"use client";

// ── 수집 진행 상태 — 화면 밖(앱 전역)에 둔다 (2026-08-27 사장님: "전표 수집 시 백그라운드 수집이 안 됨") ──
//
//   History: '수집 시작'의 진행·결과는 수집·전표 page.tsx 의 useState 에 있었다. 다른 메뉴로 가면 화면이
//   내려가며 상태가 사라져, 돌아와도 "수집 중"도 "끝났다"도 안 보였다(쿨타임만 남아 '16분 후 가능').
//   홈택스 3종은 서버 job(pg_cron)이라 뒤에서 계속 돌지만 화면은 그걸 몰랐고, 통장·카드는 브라우저가
//   엣지 함수를 직접 기다리는 구조라 화면과 함께 끊겼다.
//
//   결정 49 — 진행 상태는 이 모듈(앱이 떠 있는 동안 살아 있는 싱글턴)에 두고 화면은 구독만 한다.
//     · 메뉴를 옮겨도 runCollect 는 계속 돈다(모듈 스코프 프라미스). 돌아오면 그대로 보인다.
//     · localStorage 에 스냅샷을 남긴다 — 새로고침·탭 닫힘 뒤에도 "무엇을 받고 있었나"가 남는다.
//       홈택스는 jobId 로 서버 job 을 다시 기다리고(이어 보기), 통장·카드는 끊긴 것이라 그렇게 적는다.
//     · 끝나면 finishedAt 이 바뀐다 — 화면(어느 화면이든)은 그걸 보고 알린다.

import { useSyncExternalStore } from "react";
import { runCollect, waitForJob, SOURCES, HOMETAX_SOURCES, type SourceKey, type RunState, type CollectOptions } from "@/lib/collect";

export type CollectRun = {
  running: boolean;
  companyId: string | null;
  sources: SourceKey[];
  state: Record<string, RunState>;
  startedAt: number | null;
  finishedAt: number | null;
  startDate?: string; endDate?: string;
};

const KEY = "collect-run";
const EMPTY: CollectRun = { running: false, companyId: null, sources: [], state: {}, startedAt: null, finishedAt: null };
let cur: CollectRun = EMPTY;
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); persist(); };
const set = (patch: Partial<CollectRun>) => { cur = { ...cur, ...patch }; emit(); };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* 저장 못 해도 진행은 계속 */ } };

export const getCollectRun = () => cur;
export function useCollectRun(): CollectRun {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cur, () => EMPTY);
}

/** 수집 시작 — 화면은 이걸 부르고 구독만 한다. 이미 돌고 있으면 무시. */
export function startCollect(opts: Omit<CollectOptions, "onChange">): boolean {
  if (cur.running) return false;
  cur = {
    running: true, companyId: opts.companyId, sources: opts.sources, startDate: opts.startDate, endDate: opts.endDate,
    state: Object.fromEntries(opts.sources.map((k) => [k, { phase: "wait" } as RunState])),
    startedAt: Date.now(), finishedAt: null,
  };
  emit();
  runCollect({ ...opts, onChange: (key, s) => set({ state: { ...cur.state, [key]: s } }) })
    .catch((e: any) => { const msg = e?.message || "수집 실패"; set({ state: Object.fromEntries(Object.entries(cur.state).map(([k, v]) => [k, v.phase === "running" || v.phase === "wait" ? { phase: "error", message: msg } : v])) }); })
    .finally(() => set({ running: false, finishedAt: Date.now() }));
  return true;
}

/** 새로고침·탭 닫힘 뒤 — 스냅샷을 되살린다. 홈택스는 서버 job 을 이어 기다리고, 통장·카드는 끊긴 것으로 적는다. */
let restored = false;
export function restoreCollectRun() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  let snap: CollectRun | null = null;
  try { snap = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { snap = null; }
  if (!snap || !snap.startedAt) return;
  if (!snap.running) { cur = { ...snap, running: false }; emit(); return; }
  //   돌던 중에 끊겼다
  const state: Record<string, RunState> = { ...snap.state };
  const resumable: { key: SourceKey; jobId: string }[] = [];
  for (const k of snap.sources) {
    const s = state[k];
    if (!s || s.phase === "done" || s.phase === "error" || s.phase === "skip") continue;
    if (HOMETAX_SOURCES.includes(k) && s.jobId) resumable.push({ key: k, jobId: s.jobId });
    else state[k] = { phase: "error", message: s.phase === "wait" ? "시작 전에 화면이 닫혀 받지 못했습니다 — 다시 받으세요" : "받는 중에 화면이 닫혀 끊겼습니다 — 다시 받으세요" };
  }
  cur = { ...snap, state, running: resumable.length > 0 };
  emit();
  if (resumable.length === 0) { set({ running: false, finishedAt: snap.finishedAt || Date.now() }); return; }
  //   홈택스 job 은 서버(pg_cron)가 계속 돌린다 — 끝날 때까지 다시 기다린다
  Promise.all(resumable.map(async ({ key, jobId }) => {
    set({ state: { ...cur.state, [key]: { phase: "running", jobId, message: "서버에서 계속 받는 중 (이어 보기)" } } });
    const { synced, error } = await waitForJob(jobId, (done, total) => set({ state: { ...cur.state, [key]: { phase: "running", jobId, message: total ? `${done}/${total}` : undefined } } }));
    set({ state: { ...cur.state, [key]: error ? { phase: "error", message: error, synced } : { phase: "done", synced } } });
  })).finally(() => set({ running: false, finishedAt: Date.now() }));
}

export const collectRunLabel = (r: CollectRun) => {
  const total = Object.keys(r.state).length;
  const done = Object.values(r.state).filter((s) => s.phase === "done" || s.phase === "error" || s.phase === "skip").length;
  return { total, done, names: r.sources.map((k) => SOURCES.find((s) => s.key === k)?.label || k) };
};
