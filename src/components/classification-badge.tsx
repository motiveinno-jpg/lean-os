"use client";

interface ClassificationBadgeProps {
  classification: string;
  color?: string;
  size?: 'sm' | 'md';
}

const DEFAULT_COLORS: Record<string, string> = {
  B2B: '#3b82f6',
  B2C: '#22c55e',
  B2G: '#f59e0b',
};

export function ClassificationBadge({ classification, color, size = 'sm' }: ClassificationBadgeProps) {
  const c = color || DEFAULT_COLORS[classification] || '#8b5cf6';
  const cls = classification || 'B2B';

  return (
    <span
      className={`inline-flex items-center rounded font-semibold uppercase tracking-wider ${
        size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'
      }`}
      style={{
        color: c,
        background: `${c}15`,
        border: `1px solid ${c}30`,
      }}
    >
      {cls}
    </span>
  );
}
