"use client";

import { useState } from "react";

interface DrillDownItem {
  name: string;
  category: string;
  amount: number;
  status: string;
  due_date: string | null;
}

interface DrillDownTableProps {
  items: DrillDownItem[];
  month: string;
  onExport: () => void;
  onClose: () => void;
}

const CAT_LABELS: Record<string, string> = {
  income: '수입',
  expense: '지출',
  receivable: '미수금',
  payable: '미지급',
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'text-[var(--success)]',
  pending: 'text-[var(--warning)]',
  overdue: 'text-[var(--danger)]',
  paid: 'text-[var(--success)]',
};

type SortKey = 'name' | 'category' | 'amount' | 'status';

export function DrillDownTable({ items, month, onExport, onClose }: DrillDownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...items].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === 'amount') return (a.amount - b.amount) * dir;
    return String(a[sortKey]).localeCompare(String(b[sortKey])) * dir;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const totalIncome = items.filter(i => i.category === 'income').reduce((s, i) => s + i.amount, 0);
  const totalExpense = items.filter(i => i.category === 'expense' || i.category === 'payable').reduce((s, i) => s + i.amount, 0);

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-0.5 text-[8px] opacity-50">{sortKey === k ? (sortAsc ? '▲' : '▼') : '⇅'}</span>
  );

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 mt-4 animate-[slide-in_0.3s]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold">{month} 상세 내역</h3>
        <div className="flex gap-2">
          <button onClick={onExport} className="text-[10px] px-2 py-1 rounded bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 transition">
            Excel 다운로드
          </button>
          <button onClick={onClose} className="text-[10px] px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--border)] transition">
            닫기
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex gap-4 mb-3 text-[10px]">
        <span className="text-[var(--success)] mono-number">수입 ₩{totalIncome.toLocaleString()}</span>
        <span className="text-[var(--danger)] mono-number">지출 ₩{totalExpense.toLocaleString()}</span>
        <span className={`mono-number ${totalIncome - totalExpense >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
          순이익 ₩{(totalIncome - totalExpense).toLocaleString()}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-[var(--text-dim)] text-center py-4">해당 월 상세 데이터 없음</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-dim)] text-[10px] border-b border-[var(--border)]">
                <th className="text-left py-1.5 cursor-pointer" onClick={() => toggleSort('name')}>항목<SortIcon k="name" /></th>
                <th className="text-left py-1.5 cursor-pointer" onClick={() => toggleSort('category')}>구분<SortIcon k="category" /></th>
                <th className="text-right py-1.5 cursor-pointer" onClick={() => toggleSort('amount')}>금액<SortIcon k="amount" /></th>
                <th className="text-center py-1.5 cursor-pointer" onClick={() => toggleSort('status')}>상태<SortIcon k="status" /></th>
                <th className="text-right py-1.5">만기일</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
                <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                  <td className="py-1.5 text-[var(--text)]">{item.name}</td>
                  <td className="py-1.5 text-[var(--text-muted)]">{CAT_LABELS[item.category] || item.category}</td>
                  <td className={`py-1.5 text-right mono-number ${item.category === 'income' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    ₩{Math.abs(item.amount).toLocaleString()}
                  </td>
                  <td className={`py-1.5 text-center ${STATUS_COLORS[item.status] || 'text-[var(--text-muted)]'}`}>
                    {item.status}
                  </td>
                  <td className="py-1.5 text-right text-[var(--text-dim)] mono-number">{item.due_date || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
