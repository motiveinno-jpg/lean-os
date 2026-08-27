"use client";

// ── 마감 확정본 — 재무상태표·손익계산서 조회 줄의 버튼 (2026-08-27 ERP 공백 ③, 결정 57~59) ──
//   잠근 달의 확정본 목록 → 골라 열면 계정별 확정 숫자와 **지금 숫자와의 차이**를 보여 준다.
//   차이가 있으면 버튼에 표시가 붙는다 — 마감한 달의 숫자가 소리 없이 바뀐 것을 화면이 말한다.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listClosingSnapshots, computeStatements, diffSnapshot, type ClosingSnapshot, type SnapLine } from "@/lib/closing-snapshot";
import { useModalKeys } from "@/hooks/use-modal-keys";

const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export function ClosingSnapshotButton({ companyId, kind, year }: { companyId: string | null; kind: "bs" | "pnl"; year: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  useModalKeys(open, () => setOpen(false));
  const { data: snaps = [] } = useQuery({
    queryKey: ["closing-snapshots", companyId, year],
    queryFn: () => listClosingSnapshots(companyId!, year),
    enabled: !!companyId, staleTime: 60_000,
  });
  const latest = snaps[0] || null;
  //   최신 확정본과 지금 숫자를 비교 — 다르면 버튼에 알린다
  const { data: liveLatest } = useQuery({
    queryKey: ["closing-snapshot-live", companyId, latest?.month],
    queryFn: () => computeStatements(companyId!, latest!.month),
    enabled: !!companyId && !!latest, staleTime: 60_000,
  });
  const latestDiff = useMemo(() => latest && liveLatest ? diffSnapshot(latest[kind], liveLatest[kind]) : [], [latest, liveLatest, kind]);
  const cur: ClosingSnapshot | null = snaps.find((s) => s.month === pick) || latest;
  const { data: liveCur } = useQuery({
    queryKey: ["closing-snapshot-live", companyId, cur?.month],
    queryFn: () => computeStatements(companyId!, cur!.month),
    enabled: open && !!companyId && !!cur, staleTime: 60_000,
  });
  const diff = useMemo(() => cur && liveCur ? diffSnapshot(cur[kind], liveCur[kind]) : [], [cur, liveCur, kind]);
  const lines: SnapLine[] = cur ? cur[kind] : [];
  const title = kind === "bs" ? "재무상태표" : "손익계산서";
  return (
    <>
      <button type="button" className={latestDiff.length ? "btn-secondary btn-sm cs-btn cs-btn-drift" : "btn-secondary btn-sm cs-btn"} onClick={() => setOpen(true)}
        title={snaps.length ? (latestDiff.length ? `마감 확정본(${latest!.month})과 지금 숫자가 ${latestDiff.length}개 계정에서 다릅니다` : `마감 확정본 ${snaps.length}건`) : "회계마감에서 달을 잠그면 그 순간의 확정본이 남습니다"}>
        마감 확정본{snaps.length ? ` ${snaps.length}` : ""}{latestDiff.length ? " ⚠" : ""}
      </button>
      {open && (
        <div className="inv-modal" onClick={() => setOpen(false)}>
          <div className="inv-modal-box inv-modal-wide cs-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>{title} 마감 확정본</h3><button type="button" className="inv-modal-x" onClick={() => setOpen(false)}>✕</button></div>
            {!snaps.length ? (
              <div className="collect-empty">{year}년에 잠근 달이 없습니다 — 회계마감(경영자 화면 › 월마감 체크리스트)에서 달을 잠그면 그 순간의 {title}가 여기 남습니다.</div>
            ) : (
              <>
                <div className="cs-months">
                  {snaps.map((s) => <button key={s.id} type="button" className={cur?.id === s.id ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setPick(s.month)}>{s.month}</button>)}
                </div>
                {cur && (
                  <>
                    <p className="inv-modal-desc">
                      {cur.month} 잠금 시각 {new Date(cur.taken_at).toLocaleString("ko-KR")} ·
                      {kind === "bs"
                        ? <> 자산 <b>{won(cur.totals.assets)}</b> · 부채 <b>{won(cur.totals.liabilities)}</b> · 자본 <b>{won(cur.totals.equity)}</b> · 당기순이익 <b>{won(cur.totals.netIncome)}</b></>
                        : <> 당월 수익 <b>{won(cur.totals.revenue)}</b> · 비용 <b>{won(cur.totals.expense)}</b> · 순이익 <b>{won(cur.totals.monthNet)}</b> · 누적 순이익 <b>{won(cur.totals.ytdNet)}</b></>}
                    </p>
                    {liveCur && (diff.length
                      ? <div className="cs-drift">⚠ 잠근 뒤 전표가 바뀌어 지금 숫자와 <b>{diff.length}개 계정</b>이 다릅니다 — 마감한 달의 전표를 반려·정정했는지 재무 › 전표 현황에서 확인하세요. 확정본은 잠금을 풀고 다시 잠글 때만 갱신됩니다.</div>
                      : <div className="cs-same">✓ 지금 숫자와 같습니다</div>)}
                    <div className="stg-table-wrap cs-scroll">
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>계정</th><th>{kind === "bs" ? "확정 잔액" : "당월 확정"}</th>{kind === "pnl" && <th>누적 확정</th>}<th>지금</th><th>차이</th></tr></thead>
                        <tbody>{lines.map((l) => {
                          const now = liveCur ? (liveCur[kind].find((x) => x.accountId === l.accountId)?.amount ?? 0) : null;
                          const d = now == null ? 0 : now - l.amount;
                          return (
                            <tr key={l.accountId} className={d ? "inv-row-fix" : undefined}>
                              <td className="text-left"><span className="ev-dim mono-number">{l.code || ""}</span> {l.name}</td>
                              <td className="tr mono-number">{won(l.amount)}</td>
                              {kind === "pnl" && <td className="tr mono-number">{won(l.ytd || 0)}</td>}
                              <td className="tr mono-number">{now == null ? "…" : won(now)}</td>
                              <td className={`tr mono-number ${d ? "aging-b3" : "ev-dim"}`}>{d ? (d > 0 ? "+" : "−") + won(Math.abs(d)).slice(0) : "—"}</td>
                            </tr>
                          );
                        })}{liveCur && diff.filter((x) => !lines.some((l) => l.code === x.code && l.name === x.name)).map((x) => (
                          <tr key={`new-${x.code}-${x.name}`} className="inv-row-fix"><td className="text-left"><span className="ev-dim mono-number">{x.code || ""}</span> {x.name} <span className="ev-dim">(확정본에 없음)</span></td><td className="tr mono-number">—</td>{kind === "pnl" && <td className="tr">—</td>}<td className="tr mono-number">{won(x.now)}</td><td className="tr mono-number aging-b3">+{won(x.now)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}
