"use client";

// 경영흐름 월별표 — 금액 셀 클릭 시 산출 내역 모달 (2026-07-01)
//   레코드 기반 행(매출·고정비·변동비·가수금·통장잔액)은 getBudgetCellDetail 로 개별 내역 조회,
//   파생행(수입/지출 총액·순이익·누적·차액·부가세 등)은 FlowMatrix 가 계산해 clientItems 로 전달.
//   .glass-card backdrop-filter + 테이블 overflow 회피 위해 document.body 로 포털.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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

  // 직원 QA #9 — 고정비 중복 정리: 등록 고정비(정기결제/고정비)는 삭제, 통장 고정비 체크는 해제
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<string | null>(null);
  const removeItem = async (it: BudgetDetailItem) => {
    if (!it.refId || !it.refType) return;
    const isBank = it.refType === "bank";
    const ok = window.confirm(isBank
      ? `"${it.label}" 거래의 고정비 체크를 해제할까요? (거래는 유지, 고정비 집계에서만 제외)`
      : `"${it.label}" 등록 고정비를 삭제할까요? 되돌릴 수 없습니다.`);
    if (!ok) return;
    setDeleting(it.refId);
    const db = supabase;
    try {
      if (it.refType === "recurring") await db.from("recurring_payments").delete().eq("id", it.refId);
      else if (it.refType === "fixed_cost") await db.from("fixed_costs").delete().eq("id", it.refId);
      else if (it.refType === "bank") await db.from("bank_transactions").update({ is_fixed_cost: false }).eq("id", it.refId);
      await queryClient.invalidateQueries();
    } finally { setDeleting(null); }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="flow-cell-detail-overlay fixed inset-0" onClick={onClose}>
      <div className="flow-cell-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flow-cell-detail-header">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">{title}</div>
            <div className="text-[11px] text-[var(--text-dim)]">{subtitle ?? `${year}년 ${month}월 · 산출 내역`}</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none">×</button>
        </div>

        {note && <div className="flow-cell-detail-note">{note}</div>}

        <div className="flex-1 overflow-y-auto px-5">
          {isRecord && isLoading ? (
            <div className="py-8 text-center text-xs text-[var(--text-dim)]">불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-dim)]">표시할 내역이 없습니다.</div>
          ) : (
            <div className="flow-cell-detail-list">
              {items.map((it, i) => (
                <div key={i} className="flow-cell-detail-item">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)] truncate">{it.label}</div>
                    {it.sub && <div className="text-[10px] text-[var(--text-dim)]">{it.sub}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`text-sm mono-number whitespace-nowrap ${it.amount < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won(it.amount)}</div>
                    {it.refType && it.refId && (
                      <button type="button" onClick={() => removeItem(it)} disabled={deleting === it.refId}
                        title={it.refType === "bank" ? "이 거래의 고정비 체크 해제 (중복 정리)" : "등록 고정비 삭제 (중복 정리)"}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition disabled:opacity-40">
                        {deleting === it.refId ? "…" : it.refType === "bank" ? "해제" : "삭제"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showTotal && items.length > 0 && (
          <div className="flow-cell-detail-total">
            <span className="text-xs font-semibold text-[var(--text-muted)]">합계 ({items.length}건)</span>
            <span className="text-sm font-bold mono-number text-[var(--primary)]">{won(total)}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
