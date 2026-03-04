"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getCurrentUser, getTreasuryPositions, getAllTreasuryTransactions } from "@/lib/queries";
import { calculatePortfolio, ASSET_TYPES, TX_TYPES, createPosition, addTransaction, deletePosition } from "@/lib/treasury";

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

export default function TreasuryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"positions" | "transactions" | "archived">("positions");
  const [showForm, setShowForm] = useState(false);
  const [showTxForm, setShowTxForm] = useState<string | null>(null); // positionId

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("stock");
  const [formTicker, setFormTicker] = useState("");
  const [formCurrency, setFormCurrency] = useState("KRW");
  const [formQty, setFormQty] = useState("");
  const [formAvgPrice, setFormAvgPrice] = useState("");
  const [formCurPrice, setFormCurPrice] = useState("");

  // TX form state
  const [txType, setTxType] = useState("buy");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [txQty, setTxQty] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txAmount, setTxAmount] = useState("");

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: getCurrentUser,
    staleTime: 30_000,
  });

  const companyId = user?.company_id || "";

  const { data: positions = [] } = useQuery({
    queryKey: ["treasury-positions", companyId],
    queryFn: () => getTreasuryPositions(companyId),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const { data: recentTxs = [] } = useQuery({
    queryKey: ["treasury-txs", companyId],
    queryFn: () => getAllTreasuryTransactions(companyId),
    enabled: !!companyId && tab === "transactions",
    staleTime: 30_000,
  });

  const portfolio = calculatePortfolio(positions);

  const createMut = useMutation({
    mutationFn: async () => {
      await createPosition({
        companyId,
        assetType: formType,
        name: formName,
        ticker: formTicker || undefined,
        currency: formCurrency,
        quantity: Number(formQty) || 0,
        avgPrice: Number(formAvgPrice) || 0,
        currentPrice: Number(formCurPrice) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treasury-positions"] });
      setShowForm(false);
      setFormName("");
      setFormTicker("");
      setFormQty("");
      setFormAvgPrice("");
      setFormCurPrice("");
    },
  });

  const addTxMut = useMutation({
    mutationFn: async () => {
      if (!showTxForm) return;
      await addTransaction({
        positionId: showTxForm,
        type: txType,
        date: txDate,
        quantity: Number(txQty) || undefined,
        price: Number(txPrice) || undefined,
        amount: Number(txAmount) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treasury-positions"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-txs"] });
      setShowTxForm(null);
      setTxQty("");
      setTxPrice("");
      setTxAmount("");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePosition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treasury-positions"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-txs"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Treasury</h1>
          <p className="text-xs text-[var(--text-dim)]">자산 포트폴리오 + 거래 내역</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-3 py-1.5 text-xs font-semibold bg-[var(--primary)] text-black rounded-lg hover:brightness-110 transition"
        >
          + 포지션 추가
        </button>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">총 투자</div>
          <div className="text-lg font-bold mono-number">{fmtW(portfolio.totalInvested)}</div>
        </div>
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">현재 가치</div>
          <div className="text-lg font-bold mono-number">{fmtW(portfolio.totalCurrentValue)}</div>
        </div>
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">손익</div>
          <div className={`text-lg font-bold mono-number ${portfolio.totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
            {portfolio.totalPnL >= 0 ? "+" : ""}{fmtW(portfolio.totalPnL)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">수익률</div>
          <div className={`text-lg font-bold mono-number ${portfolio.pnLPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
            {portfolio.pnLPercent >= 0 ? "+" : ""}{portfolio.pnLPercent}%
          </div>
        </div>
      </div>

      {/* Asset Type Breakdown */}
      {portfolio.byType.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {portfolio.byType.map((t) => (
            <div key={t.type} className="px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
              <span className="text-[var(--text-muted)]">{t.label}</span>
              <span className="font-bold mono-number">{fmtW(t.currentValue)}</span>
              <span className={`text-[10px] ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {t.pnl >= 0 ? "+" : ""}{fmtW(t.pnl)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] p-1 rounded-lg w-fit">
        {(["positions", "transactions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition ${
              tab === t ? "bg-[var(--bg-card)] text-white" : "text-[var(--text-dim)] hover:text-white"
            }`}
          >
            {t === "positions" ? "포지션" : "거래 내역"}
          </button>
        ))}
      </div>

      {/* Positions Tab */}
      {tab === "positions" && (
        <div className="space-y-2">
          {positions.length === 0 && (
            <div className="text-center py-16 text-[var(--text-dim)] text-sm">
              포지션이 없습니다. 위 버튼으로 추가하세요.
            </div>
          )}
          {positions.map((pos) => {
            const qty = Number(pos.quantity || 0);
            const avgP = Number(pos.avg_price || 0);
            const curP = Number(pos.current_price || 0);
            const invested = qty * avgP;
            const currentVal = qty * curP;
            const pnl = currentVal - invested;
            const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
            const typeInfo = ASSET_TYPES[pos.asset_type] || ASSET_TYPES.other;

            return (
              <div key={pos.id} className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: typeInfo.color }}>
                  {typeInfo.label.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{pos.name}</span>
                    {pos.ticker && <span className="text-[10px] text-[var(--text-dim)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded">{pos.ticker}</span>}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {qty.toLocaleString()}주 x {curP.toLocaleString()} {pos.currency || "KRW"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold mono-number">{fmtW(currentVal)}</div>
                  <div className={`text-[10px] mono-number ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {pnl >= 0 ? "+" : ""}{fmtW(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setShowTxForm(pos.id);
                      setTxType("buy");
                    }}
                    className="px-2 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20 transition"
                  >
                    거래
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`${pos.name} 포지션을 삭제하시겠습니까?`)) deleteMut.mutate(pos.id);
                    }}
                    className="px-2 py-1 text-[10px] bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transactions Tab */}
      {tab === "transactions" && (
        <div className="space-y-2">
          {recentTxs.length === 0 && (
            <div className="text-center py-16 text-[var(--text-dim)] text-sm">
              거래 내역이 없습니다.
            </div>
          )}
          {recentTxs.map((tx: any) => (
            <div key={tx.id} className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center gap-3 text-xs">
              <div className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                tx.type === "buy" || tx.type === "deposit" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              }`}>
                {TX_TYPES[tx.type] || tx.type}
              </div>
              <div className="flex-1">
                <span className="font-semibold">{tx.treasury_positions?.name || "-"}</span>
                {tx.treasury_positions?.ticker && (
                  <span className="text-[var(--text-dim)] ml-1">({tx.treasury_positions.ticker})</span>
                )}
              </div>
              {tx.quantity && <span className="text-[var(--text-dim)]">{Number(tx.quantity).toLocaleString()}주</span>}
              {tx.price && <span className="text-[var(--text-dim)]">@{Number(tx.price).toLocaleString()}</span>}
              <span className="font-bold mono-number">{fmtW(Number(tx.amount))}</span>
              <span className="text-[var(--text-dim)]">{tx.date}</span>
            </div>
          ))}
        </div>
      )}

      {/* Create Position Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold">포지션 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">자산 유형</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs">
                  {Object.entries(ASSET_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">종목명</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="삼성전자" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">티커</label>
                  <input value={formTicker} onChange={(e) => setFormTicker(e.target.value)} placeholder="005930" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">통화</label>
                  <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs">
                    <option value="KRW">KRW</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="JPY">JPY</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">수량</label>
                  <input value={formQty} onChange={(e) => setFormQty(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">평단가</label>
                  <input value={formAvgPrice} onChange={(e) => setFormAvgPrice(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">현재가</label>
                  <input value={formCurPrice} onChange={(e) => setFormCurPrice(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs text-[var(--text-dim)] hover:text-white transition">취소</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!formName || createMut.isPending}
                className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-black rounded-lg hover:brightness-110 disabled:opacity-50 transition"
              >
                {createMut.isPending ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Transaction Form Modal */}
      {showTxForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowTxForm(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold">거래 추가</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">유형</label>
                  <select value={txType} onChange={(e) => setTxType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs">
                    {Object.entries(TX_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">날짜</label>
                  <input value={txDate} onChange={(e) => setTxDate(e.target.value)} type="date" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">수량</label>
                  <input value={txQty} onChange={(e) => setTxQty(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">단가</label>
                  <input value={txPrice} onChange={(e) => setTxPrice(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-dim)] uppercase mb-1 block">금액</label>
                  <input value={txAmount} onChange={(e) => setTxAmount(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowTxForm(null)} className="px-4 py-2 text-xs text-[var(--text-dim)] hover:text-white transition">취소</button>
              <button
                onClick={() => addTxMut.mutate()}
                disabled={!txAmount || addTxMut.isPending}
                className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-black rounded-lg hover:brightness-110 disabled:opacity-50 transition"
              >
                {addTxMut.isPending ? "추가 중..." : "거래 추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
