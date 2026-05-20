"use client";

// PR3.5: 견적 품목 + 결제 단계 인라인 편집 컴포넌트.
//   슬라이드 패널 돈 탭에 임베드. saveQuoteAndPayment 와 동일한 데이터 모델
//   (deals.custom_scope JSONB { quoteItems, paymentStages, quoteContent }) 사용.
//   /deals/page.tsx 의 견적 품목/결제 단계 UI(L312~352) 와 동일 동작 + 같은 함수 호출.
//   다음 라운드에서 deals/page.tsx 도 이 컴포넌트로 통합.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";

type QuoteItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  note?: string;
};
type PaymentStage = { label: string; ratio: number; condition: string; milestone_id?: string };

interface Props {
  dealId: string;
  companyId: string;
  readonly?: boolean;
}

export function ProjectQuoteStages({ dealId, readonly }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [stages, setStages] = useState<PaymentStage[]>([
    { label: "선금", ratio: 30, condition: "계약 후 7일 이내" },
    { label: "잔금", ratio: 70, condition: "납품 완료 후 14일 이내" },
  ]);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dealName, setDealName] = useState<string>("");
  const [contractTotal, setContractTotal] = useState<number>(0);

  // 초기 로드 — custom_scope 에서 복원
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: deal } = await (supabase as any)
        .from("deals")
        .select("name, contract_total, custom_scope")
        .eq("id", dealId)
        .maybeSingle();
      if (deal) {
        setDealName(deal.name || "");
        setContractTotal(Number(deal.contract_total || 0));
        const scope = (deal.custom_scope as any) || {};
        if (Array.isArray(scope.quoteItems) && scope.quoteItems.length) setItems(scope.quoteItems);
        if (Array.isArray(scope.paymentStages) && scope.paymentStages.length) setStages(scope.paymentStages);
        if (typeof scope.quoteContent === "string") setContent(scope.quoteContent);
      }
      setLoading(false);
    })();
  }, [dealId]);

  async function save() {
    if (readonly) return;
    setSaving(true);
    try {
      const { data: deal } = await (supabase as any)
        .from("deals")
        .select("custom_scope")
        .eq("id", dealId)
        .maybeSingle();
      const scope = { ...((deal?.custom_scope as any) || {}), quoteItems: items, paymentStages: stages, quoteContent: content };
      const { error } = await (supabase as any).from("deals").update({ custom_scope: scope }).eq("id", dealId);
      if (error) throw error;
      toast("견적 품목 / 결제 단계가 저장되었습니다", "success");
      queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal-detail", dealId] });
    } catch (e: unknown) {
      toast(`저장 실패: ${friendlyError(e, "알 수 없는 오류")}`, "error");
    }
    setSaving(false);
  }

  function addItem() {
    setItems((prev) => prev.length === 0
      ? [{ name: dealName, quantity: 1, unitPrice: contractTotal, supplyAmount: contractTotal, taxAmount: Math.round(contractTotal * 0.1), totalAmount: Math.round(contractTotal * 1.1), note: "" }]
      : [...prev, { name: "", quantity: 1, unitPrice: 0, supplyAmount: 0, taxAmount: 0, totalAmount: 0, note: "" }]);
  }

  function updateItem(idx: number, patch: Partial<QuoteItem>) {
    setItems((prev) => {
      const arr = [...prev];
      const next = { ...arr[idx], ...patch };
      const q = Number(next.quantity || 0);
      const u = Number(next.unitPrice || 0);
      const supply = q * u;
      arr[idx] = { ...next, supplyAmount: supply, taxAmount: Math.round(supply * 0.1), totalAmount: Math.round(supply * 1.1) };
      return arr;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStage() {
    setStages((prev) => [...prev, { label: `${prev.length + 1}차`, ratio: 0, condition: "" }]);
  }

  function updateStage(idx: number, patch: Partial<PaymentStage>) {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeStage(idx: number) {
    setStages((prev) => prev.filter((_, i) => i !== idx));
  }

  const stageSum = stages.reduce((s, st) => s + (st.ratio || 0), 0);
  const supplyTotal = items.reduce((s, i) => s + Number(i.supplyAmount || 0), 0);
  const taxTotal = items.reduce((s, i) => s + Number(i.taxAmount || 0), 0);
  const grandTotal = items.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

  if (loading) {
    return <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-[11px] text-[var(--text-dim)] text-center">불러오는 중…</div>;
  }

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">견적 품목 / 결제 단계</h3>
        {!readonly && (
          <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-semibold disabled:opacity-50 transition">
            {saving ? "저장 중…" : "💾 저장"}
          </button>
        )}
      </div>

      {/* 결제 단계 */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[var(--text-dim)] font-medium">결제 단계 ({stages.length}단계)</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-dim)]">합계 {stageSum}%
              {stageSum !== 100 && <span className="text-red-400 ml-1">(100%가 아님)</span>}
            </span>
            {!readonly && (
              <button onClick={addStage} className="text-[10px] text-[var(--primary)] hover:underline font-semibold">+ 단계 추가</button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          {stages.map((stage, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-1.5">
              <input value={stage.label} onChange={(e) => updateStage(idx, { label: e.target.value })}
                disabled={readonly} placeholder="단계명"
                className="w-16 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)]" />
              <input type="text" inputMode="numeric" value={stage.ratio === 0 ? "" : String(stage.ratio)}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, "");
                  const num = v === "" ? 0 : Math.min(100, parseInt(v, 10));
                  updateStage(idx, { ratio: num });
                }}
                disabled={readonly} placeholder="0"
                className="w-12 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] text-right focus:outline-none focus:border-[var(--primary)]" />
              <span className="text-[10px] text-[var(--text-dim)]">%</span>
              <input value={stage.condition} onChange={(e) => updateStage(idx, { condition: e.target.value })}
                disabled={readonly} placeholder="지급 조건 (예: 계약 후 7일)"
                className="flex-1 min-w-[100px] px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)]" />
              {!readonly && stages.length > 1 && (
                <button onClick={() => removeStage(idx)} className="text-red-400/70 hover:text-red-400 text-[10px]">✕</button>
              )}
            </div>
          ))}
        </div>
        {stages.length > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden flex">
            {stages.map((stage, idx) => (
              <div key={idx} className="h-full" style={{ width: `${stage.ratio}%`, backgroundColor: idx === 0 ? "#3B82F6" : idx === 1 ? "#22C55E" : idx === 2 ? "#EAB308" : "#8B5CF6", opacity: 0.8 }} title={`${stage.label} ${stage.ratio}%`} />
            ))}
          </div>
        )}
      </div>

      {/* 견적 품목 */}
      <div className="mb-3 pt-3 border-t border-[var(--border)]/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[var(--text-dim)] font-medium">견적 품목 ({items.length}건)</span>
          {!readonly && (
            <button onClick={addItem} className="text-[10px] text-[var(--primary)] hover:underline font-semibold">+ 품목 추가</button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] text-center py-3">품목을 추가하면 견적서 생성 시 자동 반영됩니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--text-dim)] border-b border-[var(--border)]/40">
                  <th className="text-left py-1 px-1 font-medium">품명</th>
                  <th className="text-right py-1 px-1 font-medium w-12">수량</th>
                  <th className="text-right py-1 px-1 font-medium w-20">단가</th>
                  <th className="text-right py-1 px-1 font-medium w-24">공급가액</th>
                  <th className="text-right py-1 px-1 font-medium w-20">세액(10%)</th>
                  <th className="text-right py-1 px-1 font-medium w-24">합계</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-[var(--border)]/30">
                    <td className="py-1 px-1">
                      <input value={item.name || ""} onChange={(e) => updateItem(idx, { name: e.target.value })}
                        disabled={readonly} placeholder="품목명"
                        className="w-full bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <input type="number" value={item.quantity || 0} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                        disabled={readonly}
                        className="w-full text-right bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <input type="text" inputMode="numeric" value={item.unitPrice ? Number(item.unitPrice).toLocaleString("ko-KR") : "0"}
                        onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
                        disabled={readonly}
                        className="w-full text-right bg-transparent border-b border-[var(--border)]/40 focus:outline-none focus:border-[var(--primary)] px-1 py-0.5 text-[10px]" />
                    </td>
                    <td className="py-1 px-1 text-right text-[var(--text-muted)]">{Number(item.supplyAmount || 0).toLocaleString()}</td>
                    <td className="py-1 px-1 text-right text-[var(--text-muted)]">{Number(item.taxAmount || 0).toLocaleString()}</td>
                    <td className="py-1 px-1 text-right font-bold">{Number(item.totalAmount || 0).toLocaleString()}</td>
                    <td className="py-1 px-1 text-center">
                      {!readonly && items.length > 0 && (
                        <button onClick={() => removeItem(idx)} className="text-red-400/70 hover:text-red-400 text-[10px]">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-[var(--bg)]/40">
                  <td colSpan={3} className="py-1 px-1 text-[10px] font-bold text-[var(--text-muted)]">합계</td>
                  <td className="py-1 px-1 text-right text-[10px] font-bold">{supplyTotal.toLocaleString()}</td>
                  <td className="py-1 px-1 text-right text-[10px] font-bold">{taxTotal.toLocaleString()}</td>
                  <td className="py-1 px-1 text-right text-[10px] font-black">{grandTotal.toLocaleString()}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 견적 내용 / 비고 */}
      <div className="pt-3 border-t border-[var(--border)]/40">
        <label className="block text-[10px] text-[var(--text-dim)] font-medium mb-1.5">견적서 내용 / 비고</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={readonly}
          rows={2} placeholder="견적서에 포함할 내용, 조건, 비고 등"
          className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[10px] focus:outline-none focus:border-[var(--primary)] resize-none" />
      </div>
    </div>
  );
}

export default ProjectQuoteStages;
