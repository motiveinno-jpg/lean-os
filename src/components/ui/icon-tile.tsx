"use client";

// 시안 색깔 그라데이션 아이콘 타일 — 2026-05-27. 섹션 헤더의 둥근 사각형 아이콘 배지.
//   tone 별 그라데이션 + 컬러 그림자. 내부에 흰색 svg(또는 텍스트) children.
//   재무 히어로/하단카드와 동일 비주얼 언어를 전 페이지 섹션 헤더에 부여.

type Tone = "brand" | "info" | "success" | "danger" | "warning" | "muted";

const GRAD: Record<Tone, string> = {
  brand: "from-[var(--brand)] to-[var(--brand-to)] shadow-[var(--brand)]/30",
  info: "from-[var(--brand-info)] to-[#2563EB] shadow-[var(--brand-info)]/30",
  success: "from-[var(--success)] to-[#047857] shadow-[var(--success)]/30",
  danger: "from-[var(--danger)] to-[#B91C1C] shadow-[var(--danger)]/30",
  warning: "from-[var(--warning)] to-[#B45309] shadow-[var(--warning)]/30",
  muted: "from-[#6B7280] to-[#4B5563] shadow-black/20",
};

export function IconTile({
  tone = "brand",
  size = 40,
  children,
  className = "",
}: {
  tone?: Tone;
  size?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-gradient-to-br ${GRAD[tone]} flex items-center justify-center shadow-lg shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

// 자주 쓰는 흰색 svg 아이콘 모음 (시안 헤더용)
const ICON_PATH: Record<string, string> = {
  card: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  trendingDown: "M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6",
  trendingUp: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  repeat: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  bank: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3",
  wallet: "M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a2 2 0 000 4h4v-4h-4z",
  building: "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1",
  check: "M5 13l4 4L19 7",
  users: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 00-1-5.83",
};

export function TileIcon({ name, className = "w-5 h-5 text-white" }: { name: keyof typeof ICON_PATH | string; className?: string }) {
  const d = ICON_PATH[name] || ICON_PATH.card;
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}
