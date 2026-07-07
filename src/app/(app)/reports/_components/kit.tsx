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
