"use client";

// 회계마감시점 + 기초잔액 설정 (2026-07-01)
//   마감일 이전 자료는 수집(세금계산서/통장/카드)에서 제외 → 오래된 자료로 프로그램이 무거워지는 것 방지.
//   미설정 시 최대 2년 전까지만 수집. 기초잔액은 리포트 잔액 연속성 기준점.
//   세무자동화(tax) 탭에서 렌더.

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { getAccountingClosing, saveAccountingClosing, computeSyncFloor } from "@/lib/accounting-closing";

export function AccountingClosingTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: closing } = useQuery({
    queryKey: ["accounting-closing", companyId],
    queryFn: () => getAccountingClosing(companyId!),
    enabled: !!companyId,
  });

  const [closingDate, setClosingDate] = useState("");
  const [bankBal, setBankBal] = useState("");
  const [cumNet, setCumNet] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (closing) {
      setClosingDate(closing.closing_date ?? "");
      setBankBal(closing.opening_bank_balance ? String(closing.opening_bank_balance) : "");
      setCumNet(closing.opening_cumulative_net ? String(closing.opening_cumulative_net) : "");
      setNote(closing.note ?? "");
    }
  }, [closing]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveAccountingClosing(companyId!, null, {
        closing_date: closingDate || null,
        opening_bank_balance: Number(bankBal) || 0,
        opening_cumulative_net: Number(cumNet) || 0,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounting-closing", companyId] });
      toast("회계마감 설정이 저장되었습니다. 다음 수집부터 마감일 이전 자료는 제외됩니다.", "success");
    },
    onError: (e: any) => toast("저장 실패: " + friendlyError(e, "알 수 없는 오류"), "error"),
  });

  const floor = computeSyncFloor(closingDate || null);

  return (
    <div className="glass-card p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold">회계 마감시점 · 기초잔액</h2>
        <p className="text-xs text-[var(--text-dim)] mt-0.5">
          결산을 끝낸 시점을 지정하면 그 이전의 세금계산서·통장·카드 자료를 다시 불러오지 않습니다. 오래된 자료 수집을 막아 화면이 가벼워집니다.
        </p>
      </div>

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">회계 마감일 (이 날짜까지 결산 완료)</label>
        <DateField
          value={closingDate}
          onChange={(e) => setClosingDate(e.target.value)}
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
        />
        <p className="text-[10px] text-[var(--text-dim)] mt-1">
          비워두면 마감일 없음 — 이 경우 최대 <b>2년 전</b>까지만 수집합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">마감시점 통장잔액 (기초, 원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={bankBal ? Number(bankBal).toLocaleString() : ""}
            onChange={(e) => setBankBal(e.target.value.replace(/[^0-9-]/g, ""))}
            placeholder="0"
            className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">마감시점 누적 손익 (기초, 원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={cumNet ? Number(cumNet).toLocaleString() : ""}
            onChange={(e) => setCumNet(e.target.value.replace(/[^0-9-]/g, ""))}
            placeholder="0"
            className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">메모 (선택)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 2025년 재무제표 기준 마감"
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
        />
      </div>

      <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
        현재 데이터 수집 하한: <b className="text-[var(--text)] mono-number">{floor}</b> — 이 날짜 이전 자료는 수집하지 않습니다.
      </div>

      <button
        onClick={() => companyId && saveMut.mutate()}
        disabled={!companyId || saveMut.isPending}
        className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
      >
        {saveMut.isPending ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}
