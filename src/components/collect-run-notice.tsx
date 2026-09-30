"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { collectRunLabel, restoreCollectRun, useCollectRun } from "@/lib/collect-run";
import { SOURCES } from "@/lib/collect";

// 앱 셸에 상주한다. 메뉴를 옮겨도 결과를 알리고 확인할 때까지 남긴다.
export function CollectRunNotice() {
  const { user } = useUser();
  const companyId = user?.company_id;
  const run = useCollectRun();
  const qc = useQueryClient();
  const { toast } = useToast();
  const refreshed = useRef(new Set<string>());
  const notified = useRef<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const noticeId = `${companyId}:${run.startedAt}`;

  useEffect(() => { if (companyId) restoreCollectRun(companyId); }, [companyId]);
  useEffect(() => {
    if (!companyId) return;
    try { setDismissed(localStorage.getItem(`collect-notice-dismissed:${companyId}`)); } catch { /* 저장 차단 */ }
  }, [companyId]);

  useEffect(() => {
    if (!companyId || run.companyId !== companyId) return;
    const terminal = Object.entries(run.state).filter(([, s]) => ["done", "error", "skip"].includes(s.phase));
    // 각 자료 완료 즉시 현황·목록·이력을 갱신한다. 나머지 자료가 끝나기를 기다리지 않는다.
    const changes = terminal.map(([key, s]) => `${run.startedAt}:${key}:${s.phase}`);
    if (run.finishedAt) changes.push(`finished:${run.finishedAt}`);
    if (changes.some((key) => !refreshed.current.has(key))) {
      changes.forEach((key) => refreshed.current.add(key));
      for (const key of ["collect-status", "collect-history", "collect-rows", "bank-rows", "sync-cooldowns", "sync-quota"])
        void qc.invalidateQueries({ queryKey: [key, companyId] });
    }
    if (!run.finishedAt || notified.current === run.finishedAt) return;
    notified.current = run.finishedAt;
    if (Date.now() - run.finishedAt < 60_000 && dismissed !== noticeId) {
      const errors = terminal.filter(([, s]) => s.phase === "error").length;
      toast(errors ? `자료 수집 종료 · ${errors}종 실패. 상단에서 결과를 확인하세요.` : "자료 수집이 완료됐습니다. 목록과 이력을 갱신했습니다.", errors ? "info" : "success");
    }
  }, [companyId, run, qc, toast, dismissed, noticeId]);

  if (!companyId || run.companyId !== companyId || !run.startedAt || (!run.running && !run.finishedAt)) return null;
  if (!run.running && dismissed === noticeId) return null;
  const { done, total } = collectRunLabel(run);
  const errors = Object.values(run.state).filter((s) => s.phase === "error").length;
  const title = run.running ? `자료 수집 중 · ${done}/${total}종 완료`
    : errors ? `자료 수집 종료 · ${errors}종 실패` : "자료 수집 완료";

  return (
    <section role="status" aria-live="polite" aria-atomic="true"
      className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className={errors ? "text-[var(--danger)]" : "text-[var(--text)]"}>{title}</strong>
        <div className="flex items-center gap-3">
          <Link href="/collect" className="font-semibold text-[var(--primary)] underline">수집 결과 보기</Link>
          {!run.running && <button type="button" className="btn-secondary btn-sm" onClick={() => {
            setDismissed(noticeId);
            try { localStorage.setItem(`collect-notice-dismissed:${companyId}`, noticeId); } catch { /* 저장 차단 */ }
          }}>확인했어요</button>}
        </div>
      </div>
      <p className="mt-2 text-[var(--text-muted)]">
        {run.running ? "다른 메뉴로 이동해도 수집은 계속됩니다. 완료되면 이곳에 결과가 표시됩니다."
          : errors ? "받지 못한 자료와 사유를 아래에서 확인하세요."
          : "선택한 자료의 수집이 끝났습니다. 처리 건수에는 기존 자료 확인이 포함될 수 있습니다."}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {run.sources.map((key) => {
          const state = run.state[key];
          const label = SOURCES.find((s) => s.key === key)?.label ?? key;
          return <li key={key} className={state?.phase === "error" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>
            {label}: {state?.phase === "done" ? `${(state.synced ?? 0).toLocaleString("ko-KR")}건 처리 완료`
              : state?.phase === "error" ? `실패 · ${state.message || "수집 실패"}`
              : state?.phase === "skip" ? "건너뜀" : state?.phase === "running" ? "수집 중" : "대기 중"}
          </li>;
        })}
      </ul>
    </section>
  );
}
