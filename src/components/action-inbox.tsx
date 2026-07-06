"use client";

// 처리 대기 큐(액션 인박스) — 라운드7.1 대시보드 재설계 (컨셉 5안).
//   "보는 대시보드 → 하는 대시보드": 미수금 지연·결재 대기·세금 마감을 심각도 순으로 쌓고
//   각 줄에 진입 버튼을 붙인다. 데이터는 부모(대시보드)가 이미 계산한 값 + 세금 마감 헬퍼 재사용 — 신규 쿼리 0.
//   모두 비면 "처리할 항목 없음" 안심 상태를 보여준다(인박스 제로).

import Link from "next/link";
import { getUpcomingTaxDeadlines } from "@/components/upcoming-schedule";

const fmtKR = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(abs / 1e4).toLocaleString()}만`;
  return abs.toLocaleString();
};

type Sev = 0 | 1 | 2; // 0=위험(빨강) 1=주의(주황) 2=예정(회색)
type InboxItem = { key: string; sev: Sev; text: string; meta?: string; href: string; cta: string };

const SEV_DOT: Record<Sev, string> = {
  0: "bg-[var(--danger)]",
  1: "bg-[var(--warning)]",
  2: "bg-[var(--text-dim)]",
};

export function ActionInbox({
  pendingApprovals,
  arOver30,
  arTotal,
}: {
  pendingApprovals: number;
  arOver30: number;
  arTotal: number;
}) {
  const taxItems = getUpcomingTaxDeadlines(30);

  const items: InboxItem[] = [];
  if (arOver30 > 0) {
    items.push({
      key: "ar-over30", sev: 0,
      text: "미수금 30일+ 지연",
      meta: `₩${fmtKR(arOver30)}`,
      href: "/tax-invoices", cta: "회수 관리",
    });
  } else if (arTotal > 0) {
    items.push({
      key: "ar-normal", sev: 2,
      text: "미수금 회수 진행 중",
      meta: `₩${fmtKR(arTotal)}`,
      href: "/tax-invoices", cta: "현황",
    });
  }
  if (pendingApprovals > 0) {
    items.push({
      key: "approvals", sev: 0,
      text: `전자결재 ${pendingApprovals}건 대기`,
      href: "/approvals", cta: "검토",
    });
  }
  taxItems.forEach((t) => {
    items.push({
      key: t.id,
      sev: t.daysLeft <= 7 ? 1 : 2,
      text: t.title,
      meta: t.daysLeft === 0 ? "D-Day" : `D-${t.daysLeft}`,
      href: t.href, cta: "확인",
    });
  });
  items.sort((a, b) => a.sev - b.sev);
  const urgent = items.filter((i) => i.sev === 0).length;

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[var(--text)]">
          처리 대기
          {items.length > 0 && (
            <span className={`ml-1.5 ${urgent > 0 ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>{items.length}</span>
          )}
        </h3>
        <span className="text-[11px] text-[var(--text-dim)]">심각도순</span>
      </div>
      {items.length === 0 ? (
        <div className="py-4 text-center">
          <div className="text-xs font-semibold text-[var(--success)]">지금 처리할 항목이 없습니다</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1">새 결재·지연·마감이 생기면 여기에 쌓입니다</div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]/50">
          {items.map((it) => (
            <div key={it.key} className="py-2.5 flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[it.sev]}`} />
              <span className="flex-1 min-w-0 text-xs text-[var(--text)] truncate">{it.text}</span>
              {it.meta && (
                <span className={`text-[11px] font-bold mono-number shrink-0 ${it.sev === 0 ? "text-[var(--danger)]" : it.sev === 1 ? "text-[var(--warning)]" : "text-[var(--text-muted)]"}`}>
                  {it.meta}
                </span>
              )}
              <Link href={it.href} className={`${it.sev === 0 ? "btn-primary" : "btn-secondary"} btn-sm shrink-0`}>
                {it.cta}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
