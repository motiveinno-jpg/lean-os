"use client";

interface ActionCardProps {
  cardType: string; // quote | document | approval | payment | milestone
  status?: string;
  summaryJson?: Record<string, any>;
}

const CARD_STYLES: Record<string, { border: string; icon: string; label: string }> = {
  quote:     { border: 'border-l-blue-500',   icon: '📋', label: '견적서' },
  document:  { border: 'border-l-purple-500',  icon: '📄', label: '문서' },
  approval:  { border: 'border-l-yellow-500',  icon: '✅', label: '승인 요청' },
  payment:   { border: 'border-l-green-500',   icon: '💰', label: '결제' },
  milestone: { border: 'border-l-orange-500',  icon: '🎯', label: '마일스톤' },
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-500/10 text-blue-400',
  completed: 'bg-green-500/10 text-green-400',
  approved: 'bg-green-500/10 text-green-400',
  rejected: 'bg-red-500/10 text-red-400',
  pending: 'bg-yellow-500/10 text-yellow-400',
};

export function ActionCard({ cardType, status, summaryJson }: ActionCardProps) {
  const style = CARD_STYLES[cardType] || CARD_STYLES.document;
  const summary = summaryJson || {};

  return (
    <div className={`border-l-3 ${style.border} bg-[var(--bg-surface)] rounded-r-lg p-3 my-1`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{style.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {style.label}
          </span>
        </div>
        {status && (
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[status] || STATUS_COLORS.pending}`}>
            {status}
          </span>
        )}
      </div>
      {summary.title && (
        <div className="text-xs font-semibold text-[var(--text)]">{summary.title}</div>
      )}
      {summary.amount && (
        <div className="text-xs text-[var(--text-muted)] mt-0.5">
          {Number(summary.amount).toLocaleString()}원
        </div>
      )}
      {summary.description && (
        <div className="text-[10px] text-[var(--text-dim)] mt-1">{summary.description}</div>
      )}
    </div>
  );
}
