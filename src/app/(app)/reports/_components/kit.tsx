"use client";

// 분석 대표화면 공용 소품 — 포맷·기간 헬퍼 + 지난달 대비 화살표 + 미니 막대 추세.

export const fmt = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export function ymNow() {
  const d = new Date();
  return { year: d.getFullYear(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
}
export function prevMonthStr(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 지난달 대비 화살표 (invert: 값이 오르는 게 나쁜 지표 — 비용 등)
export function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="text-[11px] text-[var(--text-dim)]">지난달과 같음</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  const pct = Math.abs(Math.round((diff / Math.abs(prev)) * 100));
  return (
    <span className={`text-[11px] font-semibold ${good ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
      {up ? "▲" : "▼"} 지난달 대비 {pct}%
    </span>
  );
}

// 월별 · 전년 비교 표 — [월 | 올해 | 작년 동월 | 증감 | 막대]. 행 클릭 시 구성 드릴다운(onRowClick).
export function MonthlyCompareCard({ title, rows, onRowClick, accent = "var(--primary)" }: {
  title: string;
  rows: { monthNum: number; label: string; cur: number; prev: number | null }[];
  onRowClick?: (monthNum: number) => void;
  accent?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.cur));
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm font-bold text-[var(--text)]">{title}</div>
        <span className="text-[11px] text-[var(--text-dim)]">전년 동월 대비{onRowClick ? " · 행을 클릭하면 구성 내역" : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ minWidth: 420 }}>
          <thead>
            <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left py-1.5 px-2 font-semibold">월</th>
              <th className="text-right py-1.5 px-2 font-semibold">올해</th>
              <th className="text-right py-1.5 px-2 font-semibold">작년 동월</th>
              <th className="text-right py-1.5 px-2 font-semibold">증감</th>
              <th style={{ width: "26%" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.prev == null ? null : r.cur - r.prev;
              const pct = r.prev ? Math.round(((diff as number) / Math.abs(r.prev)) * 100) : null;
              const up = (diff ?? 0) >= 0;
              return (
                <tr key={r.monthNum} onClick={onRowClick ? () => onRowClick(r.monthNum) : undefined}
                  className={`border-b border-[var(--border)]/30 ${onRowClick ? "cursor-pointer hover:bg-[var(--primary)]/[0.05]" : ""}`}>
                  <td className="py-2 px-2 text-[var(--text-muted)]">{r.label}</td>
                  <td className="py-2 px-2 text-right mono-number font-semibold text-[var(--text)]">{fmt(r.cur)}</td>
                  <td className="py-2 px-2 text-right mono-number text-[var(--text-dim)]">{r.prev == null ? "—" : fmt(r.prev)}</td>
                  <td className={`py-2 px-2 text-right mono-number text-[11px] font-semibold ${pct == null ? "text-[var(--text-dim)]" : up ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                    {pct == null ? "—" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`}
                  </td>
                  <td className="py-2 px-2">
                    <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((r.cur / max) * 100)}%`, background: accent }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 월별 미니 막대 추세 — 값 배열을 최대값 기준 상대 높이로. 마지막(이번 달) 강조.
export function MiniBars({ data, color = "var(--primary)" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5 h-28">
      {data.map((d, i) => {
        const h = Math.max(2, Math.round((d.value / max) * 100));
        const last = i === data.length - 1;
        return (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full rounded-t-md transition-all" style={{ height: `${h}%`, background: last ? color : `color-mix(in srgb, ${color} 35%, transparent)` }} title={`${d.label}: ${fmt(d.value)}`} />
            <span className={`text-[9px] truncate w-full text-center ${last ? "font-bold text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
