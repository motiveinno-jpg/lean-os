"use client";

// 경영흐름 월별표 — 금액 셀 클릭 시 산출 내역 모달 (2026-07-01)
//   레코드 기반 행(매출·고정비·변동비·가수금·통장잔액)은 getBudgetCellDetail 로 개별 내역 조회,
//   파생행(수입/지출 총액·순이익·누적·차액·부가세 등)은 FlowMatrix 가 계산해 clientItems 로 전달.
//   .glass-card backdrop-filter + 테이블 overflow 회피 위해 document.body 로 포털.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { getBudgetCellDetail, RECORD_BACKED_KEYS, type BudgetDetailItem } from "@/lib/budget-detail";

const won = (n: number) => `${n < 0 ? "-" : ""}${Math.round(Math.abs(n)).toLocaleString("ko-KR")}`;

export function CellDetail({
  companyId, year, month, rowKey, title, clientItems, note, subtitle, showTotal = true, onClose,
}: {
  companyId: string; year: number; month: number; rowKey: string; title: string;
  clientItems: BudgetDetailItem[] | null; note?: string; subtitle?: string; showTotal?: boolean; onClose: () => void;
}) {
  const isRecord = RECORD_BACKED_KEYS.has(rowKey);
  const { data, isLoading } = useQuery({
    queryKey: ["budget-cell-detail", companyId, year, month, rowKey],
    queryFn: () => getBudgetCellDetail(companyId, year, month, rowKey),
    enabled: isRecord && !!companyId,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = isRecord ? (data ?? []) : (clientItems ?? []);
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">{title}</div>
            <div className="text-[11px] text-[var(--text-dim)]">{subtitle ?? `${year}년 ${month}월 · 산출 내역`}</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none">×</button>
        </div>

        {note && <div className="mx-5 mb-2 text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-lg px-3 py-2 leading-relaxed">{note}</div>}

        <div className="flex-1 overflow-y-auto px-5">
          {isRecord && isLoading ? (
            <div className="py-8 text-center text-xs text-[var(--text-dim)]">불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-dim)]">표시할 내역이 없습니다.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)] truncate">{it.label}</div>
                    {it.sub && <div className="text-[10px] text-[var(--text-dim)]">{it.sub}</div>}
                  </div>
                  <div className={`text-sm mono-number whitespace-nowrap ${it.amount < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won(it.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showTotal && items.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] mt-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">합계 ({items.length}건)</span>
            <span className="text-sm font-bold mono-number text-[var(--primary)]">{won(total)}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
