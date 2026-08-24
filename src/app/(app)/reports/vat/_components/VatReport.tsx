"use client";
/**
 * 부가세 · 기간별 집계 — 세금계산서 화면에서 **분석으로 옮겨 온 것들** (2026-08-13 사장님 지시).
 *
 *   왜 옮겼나: 세금·증빙은 '오너뷰가 발행하는 곳'이 됐다. 그런데 이 둘은 **매입 자료가 있어야**
 *   계산된다(매출세액 − 매입세액 − 카드공제 = 납부세액). 발행이 아니라 **신고**를 위한 화면이라
 *   발행 메뉴에 두면 성격이 안 맞는다.
 *
 *   ★ 코드는 tax-invoices/page.tsx 에서 **그대로 옮겼다** — 계산·표시 로직 무변경.
 *     옮기면서 고치면 숫자가 달라졌을 때 원인이 '이사' 때문인지 알 수 없다.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";
import { WaterfallChart } from "@/components/charts/kit";
import { summarizeByVatType } from "@/lib/vat-voucher";

// ── Summary Tab ──
export function SummaryTab({ periodSummary, periodType, setPeriodType, cardDeductions, currentYear }: any) {
  const totalCardDeduction = cardDeductions.reduce((s: number, c: any) => s + c.estimatedVatDeduction, 0);

  return (
    <div className="tax-invoice-summary-tab">
      <div className="seg-bar w-fit mb-4">
        {([
          { key: "monthly", label: "월별" },
          { key: "quarterly", label: "분기별" },
          { key: "annual", label: "연간" },
        ] as const).map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodType(p.key)}
            className={`seg-item ${periodType === p.key ? "seg-item-active" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        {periodSummary.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="empty-state-icon mx-auto"><Ico e="📊" /></div>
            <div className="text-base font-semibold text-[var(--text)]">{currentYear}년 세금계산서 데이터가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)] mt-1.5">세금계산서가 쌓이면 기간별 집계가 자동으로 생성됩니다</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead className="sticky-bar">
              <tr className="table-head-row">
                <th className="th-cell text-center">기간</th>
                <th className="th-cell text-center">매출 건수</th>
                <th className="th-cell text-center">매출 공급가</th>
                <th className="th-cell text-center">매출 세액</th>
                <th className="th-cell text-center">매입 건수</th>
                <th className="th-cell text-center">매입 공급가</th>
                <th className="th-cell text-center">매입 세액</th>
                <th className="th-cell text-center">VAT 납부</th>
              </tr>
            </thead>
            <tbody>
              {periodSummary.map((s: any) => (
                <tr key={s.period} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-medium">{s.period}</td>
                  <td className="px-5 py-3 text-sm text-center">{s.salesCount}</td>
                  <td className="px-5 py-3 text-sm text-right text-green-500">₩{s.salesSupply.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">₩{s.salesTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-center">{s.purchaseCount}</td>
                  <td className="px-5 py-3 text-sm text-right text-orange-500">₩{s.purchaseSupply.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">₩{s.purchaseTax.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-sm text-right font-bold ${s.vatPayable >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
                    ₩{s.vatPayable.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
              <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                <td className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]">합계</td>
                <td className="px-5 py-3 text-sm text-center font-bold">{periodSummary.reduce((s: number, p: any) => s + p.salesCount, 0)}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-green-500">₩{periodSummary.reduce((s: number, p: any) => s + p.salesSupply, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">₩{periodSummary.reduce((s: number, p: any) => s + p.salesTax, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-center font-bold">{periodSummary.reduce((s: number, p: any) => s + p.purchaseCount, 0)}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-orange-500">₩{periodSummary.reduce((s: number, p: any) => s + p.purchaseSupply, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">₩{periodSummary.reduce((s: number, p: any) => s + p.purchaseTax, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{periodSummary.reduce((s: number, p: any) => s + p.vatPayable, 0).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table></div>
        )}
      </div>

      {/* Card Deduction Summary */}
      {cardDeductions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">법인카드 매입세액 공제 추정</h3>
          <div className="glass-card overflow-hidden">
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="table-head-row">
                  <th className="th-cell text-center">월</th>
                  <th className="th-cell text-center">건수</th>
                  <th className="th-cell text-center">총 사용액</th>
                  <th className="th-cell text-center">공제대상</th>
                  <th className="th-cell text-center">불공제</th>
                  <th className="th-cell text-center">공제 추정</th>
                </tr>
              </thead>
              <tbody>
                {cardDeductions.map((c: any) => (
                  <tr key={c.month} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{c.month.slice(0, 7)}</td>
                    <td className="px-5 py-3 text-sm text-center">{c.txCount}</td>
                    <td className="px-5 py-3 text-sm text-right">₩{c.totalAmount.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right text-green-500">₩{c.deductible.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right text-red-400">₩{c.nonDeductible.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{c.estimatedVatDeduction.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
                <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                  <td colSpan={5} className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]">연간 카드공제 추정 합계</td>
                  <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{totalCardDeduction.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 전표 기준 부가세 집계 (2026-08-11) ──
//   위 VAT 미리보기는 세금계산서 합계 + 카드 공제 '추정' 이다. 이건 **실제로 친 매입매출전표**를
//   유형별로 모은 것이라 신고서 줄과 같은 모양이 된다. 둘을 나란히 두면 어긋난 만큼이 곧 미기장분이다.
export function VatByVoucherType({ companyId, year }: { companyId: string | null; year: number }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["vat-by-voucher-type", companyId, year],
    queryFn: async () => {
      const data = logRead("tax-invoices:vatVouchers", await (supabase as any)
        .from("journal_entries")
        .select("vat_type, supply_amount, vat_amount")
        .eq("company_id", companyId!)
        .eq("entry_kind", "sale_purchase")
        //   ★ 확정 전표만 (2026-08-24) — 취소(반려)한 전표가 신고용 집계에 얹혀 있었다.
        //     실제로 이 회사 2026년 집계에 반려 3건(공급가액 3,030,909 · 부가세 3,091)이 섞여 있었다.
        .eq("status", "confirmed")
        .gte("entry_date", `${year}-01-01`)
        .lte("entry_date", `${year}-12-31`));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const sum = summarizeByVatType(rows);
  const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;

  return (
    <div className="vat-voucher-card glass-card">
      <div className="vat-voucher-head">
        <div>
          <b>전표 기준 집계</b>
          <span>매입매출전표에 친 유형 그대로 · {year}년</span>
        </div>
        <Link href="/partners/reconciliation/sale-purchase" className="btn-secondary btn-sm">매입매출전표 →</Link>
      </div>
      {rows.length === 0 ? (
        <div className="vat-voucher-empty">
          아직 매입매출전표가 없습니다 — 세금계산서·카드·현금영수증을 전표로 처리하면 여기에 유형별로 쌓입니다.
        </div>
      ) : (
        <>
          <div className="vat-voucher-grid">
            {[{ title: "매출", list: sum.sale }, { title: "매입", list: sum.purchase }].map((g) => (
              <div key={g.title} className="vat-voucher-col">
                <div className="vat-voucher-col-head">{g.title}</div>
                {g.list.length === 0 ? <div className="vat-voucher-none">없음</div> : g.list.map((b: any) => (
                  <div key={b.code} className="vat-voucher-row">
                    <span className="vat-voucher-pill">{b.label}</span>
                    <span className="vat-voucher-cnt">{b.count}건</span>
                    <span className="vat-voucher-num">{won(b.supply)}</span>
                    <span className="vat-voucher-num vat-voucher-tax">{won(b.vat)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="vat-voucher-foot">
            <div><small>매출세액</small><b>{won(sum.salesVat)}</b></div>
            <div><small>공제 매입세액</small><b>{won(sum.purchaseVat)}</b></div>
            <div className="vat-voucher-payable">
              <small>{sum.payable >= 0 ? "납부 예상" : "환급 예상"}</small>
              <b>{won(Math.abs(sum.payable))}</b>
            </div>
          </div>
          <p className="vat-voucher-note">
            ※ <b>불공제(54)</b>는 낸 세액이지만 공제받지 못해 납부액 계산에서 뺍니다 · 영세(12)·면세(13/53)는 세액이 없습니다.
          </p>
        </>
      )}
    </div>
  );
}

// ── VAT Preview Tab ──
export function VATPreviewTab({ vatPreview, cardDeductions }: any) {
  const totalVAT = vatPreview.reduce((s: number, v: any) => s + v.netVAT, 0);

  return (
    <div className="tax-invoice-vat-preview-tab">
      <div className="glass-card p-5 mb-6">
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text)]">VAT 미리보기</strong>: 분기별 부가가치세 납부/환급 예상액입니다.
          매출세액(세금계산서 + 현금영수증 발행분) - 매입세액 - 카드매입세액공제 = 최종 납부세액
        </div>
      </div>

      {/* Annual Total Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매출세액</div>
          <div className="text-base sm:text-xl font-black mono-number truncate text-green-500">₩{vatPreview.reduce((s: number, v: any) => s + v.salesTax, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매입세액 + 카드공제</div>
          <div className="text-base sm:text-xl font-black mono-number truncate text-orange-500">₩{vatPreview.reduce((s: number, v: any) => s + v.purchaseTax + v.cardDeduction, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 예상 납부세액</div>
          <div className={`text-base sm:text-xl font-black mono-number truncate ${totalVAT >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
            ₩{totalVAT.toLocaleString()}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{totalVAT >= 0 ? "납부" : "환급"}</div>
        </div>
      </div>

      {/* 부가세 구조 — 화면에 글로 적힌 수식(매출세액 − 매입세액 − 카드공제 = 납부세액)을
          그림으로 옮긴 것. 무엇이 얼마를 깎는지는 막대 여럿으로는 안 보인다 (2026-08-07) */}
      <div className="glass-card p-5 mb-6">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-[var(--text)]">부가세 구조</h3>
          <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">올해 합계 · 매출세액에서 무엇이 빠져 납부세액이 남는지</p>
        </div>
        {(() => {
          const sales = vatPreview.reduce((n: number, v: any) => n + (v.salesTax || 0), 0);
          const purchase = vatPreview.reduce((n: number, v: any) => n + (v.purchaseTax || 0), 0);
          const card = vatPreview.reduce((n: number, v: any) => n + (v.cardDeduction || 0), 0);
          if (sales === 0 && purchase === 0) {
            return <p className="py-6 text-center text-xs text-[var(--text-dim)]">아직 집계된 세액이 없어요.</p>;
          }
          return (
            <WaterfallChart height={200} unit="원" steps={[
              { label: "매출세액", value: sales, kind: "add" },
              { label: "매입세액", value: purchase, kind: "sub" },
              { label: "카드공제", value: card, kind: "sub" },
              { label: totalVAT >= 0 ? "납부세액" : "환급세액", value: Math.abs(sales - purchase - card), kind: "total" },
            ]} />
          );
        })()}
      </div>

      {/* Quarterly Breakdown */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
          <thead className="sticky-bar">
            <tr className="table-head-row">
              <th className="th-cell text-center">분기</th>
              <th className="th-cell text-center">매출세액</th>
              <th className="th-cell text-center">매입세액</th>
              <th className="th-cell text-center">카드공제</th>
              <th className="th-cell text-center">납부세액</th>
              <th className="th-cell text-center">납부기한</th>
              <th className="th-cell text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {vatPreview.map((v: any) => {
              const isPast = new Date(v.dueDate) < new Date();
              const hasActivity = v.salesTax > 0 || v.purchaseTax > 0;
              return (
                <tr key={v.quarter} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-bold">{v.quarter}</td>
                  <td className="px-5 py-3 text-sm text-right text-green-500" title={v.cashReceiptSalesTax > 0 ? `세금계산서 ₩${(v.invoiceSalesTax ?? 0).toLocaleString()} + 현금영수증 ₩${v.cashReceiptSalesTax.toLocaleString()}` : undefined}>₩{v.salesTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-right text-orange-500">₩{v.purchaseTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-right text-[var(--primary)]">₩{v.cardDeduction.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-sm text-right font-bold ${v.netVAT >= 0 ? "text-[var(--text)]" : "text-red-400"}`}>
                    ₩{v.netVAT.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{v.dueDate}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      !hasActivity ? "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                      : isPast ? "bg-green-500/10 text-green-400"
                      : "bg-yellow-500/10 text-yellow-400"
                    }`}>
                      {!hasActivity ? "데이터 없음" : isPast ? "기한 경과" : "예정"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
