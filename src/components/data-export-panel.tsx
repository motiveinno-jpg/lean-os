"use client";

// 내 자료 내려받기 (2026-09-21) — 랜딩 「거래·거래처·전표를 언제든 엑셀로 내려받습니다. 해지 후에도 동일합니다」 를 참으로.
//   그전엔 해지 후 기간이 끝나면 페이월이 화면을 닫아(허용 라우트 /billing·/mypage·… 뿐) 거래 화면이 안 열려 내려받을 수 없었다.
//   ▸ 요금제 › 자료 내려받기 탭에 두고, 페이월에서 이 탭으로 보낸다 — 해지 상태에서도 /billing 은 열린다.
//   ▸ 자료별 한 파일, 또는 전부 한 파일(시트별). 회사 자료 전부(기간 제한 없음). RLS 는 그대로라 권한 있는 자료만 나온다.
//   ▸ 화면 값이 아니라 표를 그대로 뽑는다 — 다른 프로그램에 올릴 원본이라 계산·요약을 섞지 않는다.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

type Row = Record<string, unknown>;
type Dataset = { key: string; label: string; table: string; desc: string; fetch: (companyId: string) => Promise<Row[]> };

const MAX = 200000;
const n = (v: unknown) => (v == null ? "" : Number(v));

const DATASETS: Dataset[] = [
  { key: "bank", label: "통장 거래", table: "bank_transactions", desc: "거래일·입출금·상대·적요·분류",
    fetch: async (c) => (await fetchPaged<any>("export:bank", () => supabase.from("bank_transactions")
      .select("transaction_date, type, amount, balance_after, counterparty, description, memo, category, classification, bank_accounts(bank_name, alias)")
      .eq("company_id", c).order("transaction_date"), MAX)).map((r) => ({
        "거래일": r.transaction_date, "계좌": [r.bank_accounts?.bank_name, r.bank_accounts?.alias].filter(Boolean).join(" "), "구분": r.type === "income" ? "입금" : r.type === "expense" ? "출금" : r.type,
        "금액": n(r.amount), "거래 후 잔액": n(r.balance_after), "상대": r.counterparty || "", "적요": r.description || "", "메모": r.memo || "", "분류": r.category || "", "계정": r.classification || "" })) },
  { key: "card", label: "카드 거래", table: "card_transactions", desc: "승인일·가맹점·금액·할부·분류",
    fetch: async (c) => (await fetchPaged<any>("export:card", () => supabase.from("card_transactions")
      .select("transaction_date, transaction_time, card_name, merchant_name, merchant_bizno, amount, installments, category, classification, memo, approval_number")
      .eq("company_id", c).order("transaction_date"), MAX)).map((r) => ({
        "승인일": r.transaction_date, "시각": r.transaction_time || "", "카드": r.card_name || "", "가맹점": r.merchant_name || "", "가맹점 사업자번호": r.merchant_bizno || "",
        "금액": n(r.amount), "할부": r.installments ?? "", "분류": r.category || "", "계정": r.classification || "", "메모": r.memo || "", "승인번호": r.approval_number || "" })) },
  { key: "tax", label: "세금계산서", table: "tax_invoices", desc: "발행일·매출/매입·거래처·공급가·세액·승인번호",
    fetch: async (c) => (await fetchPaged<any>("export:tax", () => supabase.from("tax_invoices")
      .select("issue_date, type, counterparty_name, counterparty_bizno, item_name, supply_amount, tax_amount, total_amount, status, nts_confirm_no, settled_amount, doc_kind")
      .eq("company_id", c).order("issue_date"), MAX)).map((r) => ({
        "발행일": r.issue_date, "구분": r.type === "sales" ? "매출" : r.type === "purchase" ? "매입" : r.type, "종류": r.doc_kind || "", "거래처": r.counterparty_name || "", "사업자번호": r.counterparty_bizno || "",
        "품목": r.item_name || "", "공급가액": n(r.supply_amount), "세액": n(r.tax_amount), "합계": n(r.total_amount), "정산액": n(r.settled_amount), "상태": r.status || "", "국세청 승인번호": r.nts_confirm_no || "" })) },
  { key: "cash", label: "현금영수증", table: "cash_receipts", desc: "발행일·거래처·금액·승인번호",
    fetch: async (c) => (await fetchPaged<any>("export:cash", () => supabase.from("cash_receipts")
      .select("issue_date, type, counterparty_name, counterparty_bizno, amount, supply_amount, tax_amount, approval_number, purpose, status")
      .eq("company_id", c).order("issue_date"), MAX)).map((r) => ({
        "발행일": r.issue_date, "구분": r.type || "", "거래처": r.counterparty_name || "", "사업자번호": r.counterparty_bizno || "", "금액": n(r.amount), "공급가액": n(r.supply_amount), "세액": n(r.tax_amount),
        "승인번호": r.approval_number || "", "용도": r.purpose || "", "상태": r.status || "" })) },
  { key: "partners", label: "거래처", table: "partners", desc: "사업자번호·대표·담당자·연락처·결제조건",
    fetch: async (c) => (await fetchPaged<any>("export:partners", () => supabase.from("partners")
      .select("code, name, type, business_number, representative, business_type, business_item, contact_name, contact_email, contact_phone, address, bank_name, account_number, payment_terms_days, is_active, notes")
      .eq("company_id", c).order("name"), MAX)).map((r) => ({
        "코드": r.code ?? "", "거래처명": r.name, "구분": r.type || "", "사업자번호": r.business_number || "", "대표": r.representative || "", "업태": r.business_type || "", "종목": r.business_item || "",
        "담당자": r.contact_name || "", "이메일": r.contact_email || "", "연락처": r.contact_phone || "", "주소": r.address || "", "은행": r.bank_name || "", "계좌": r.account_number || "",
        "결제조건(일)": r.payment_terms_days ?? "", "상태": r.is_active === false ? "비활성" : "활성", "메모": r.notes || "" })) },
  { key: "journal", label: "전표 · 분개", table: "journal_entries", desc: "전표(일자·번호·적요·상태) + 분개 줄(계정·차변·대변·거래처)",
    fetch: async (c) => {
      const entries = await fetchPaged<any>("export:je", () => supabase.from("journal_entries")
        .select("id, entry_date, voucher_no, voucher_type, description, status, is_approved, vat_type, supply_amount, vat_amount, source")
        .eq("company_id", c).order("entry_date"), MAX);
      const lines = await fetchPaged<any>("export:jl", () => (supabase as any).from("journal_lines")
        .select("entry_id, debit, credit, description, chart_of_accounts(code, name), partners(name)")
        .eq("company_id", c).order("entry_id"), MAX);
      const byEntry = new Map<string, any>(entries.map((e) => [e.id, e]));
      return lines.map((l) => { const e = byEntry.get(l.entry_id) || {}; return {
        "전표일": e.entry_date || "", "전표번호": e.voucher_no || "", "전표 종류": e.voucher_type || "", "전표 적요": e.description || "", "상태": e.status || "", "승인": e.is_approved ? "예" : "아니오",
        "계정코드": l.chart_of_accounts?.code || "", "계정과목": l.chart_of_accounts?.name || "", "차변": n(l.debit), "대변": n(l.credit), "거래처": l.partners?.name || "", "줄 적요": l.description || "",
        "부가세 유형": e.vat_type || "", "출처": e.source || "" }; });
    } },
];

export function DataExportPanel({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  //   건수 — 비어 있는 자료를 눌러 빈 파일을 받지 않게. head 요청이라 가볍다
  const { data: counts = {} } = useQuery({
    queryKey: ["data-export-counts", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(DATASETS.map(async (d) => {
        const { count } = await (supabase as any).from(d.table).select("id", { count: "exact", head: true }).eq("company_id", companyId!);
        out[d.key] = count || 0;
      }));
      return out;
    },
  });
  const stamp = () => todayKst().replace(/-/g, "");

  const one = async (d: Dataset) => {
    if (!companyId || busy) return;
    setBusy(d.key);
    try {
      const rows = await d.fetch(companyId);
      if (!rows.length) { toast(`${d.label} 자료가 없습니다`, "info"); return; }
      const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, d.label);
      XLSX.writeFile(wb, `오너뷰_${d.label}_${stamp()}.xlsx`);
      toast(`${d.label} ${rows.length.toLocaleString("ko-KR")}건을 내려받았습니다`, "success");
    } catch (e) { toast(friendlyError(e, "내려받지 못했습니다"), "error"); }
    finally { setBusy(null); }
  };
  const all = async () => {
    if (!companyId || busy) return;
    setBusy("all");
    try {
      const wb = XLSX.utils.book_new(); let total = 0;
      for (const d of DATASETS) {
        const rows = await d.fetch(companyId);
        if (!rows.length) continue;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), d.label); total += rows.length;
      }
      if (!total) { toast("내려받을 자료가 없습니다", "info"); return; }
      XLSX.writeFile(wb, `오너뷰_전체자료_${stamp()}.xlsx`);
      toast(`전체 ${total.toLocaleString("ko-KR")}건을 한 파일로 내려받았습니다`, "success");
    } catch (e) { toast(friendlyError(e, "내려받지 못했습니다"), "error"); }
    finally { setBusy(null); }
  };

  return (
    <div className="data-export">
      <div className="data-export-head">
        <div>
          <h3 className="data-export-title">내 자료 내려받기</h3>
          <p className="data-export-sub">거래·거래처·전표를 엑셀(.xlsx)로 통째로 내려받습니다. 구독을 해지해도 이 화면은 그대로 열립니다. 권한이 있는 자료만 나옵니다.</p>
        </div>
        <button type="button" className="btn-primary btn-sm" disabled={!companyId || !!busy} onClick={all}>{busy === "all" ? "만드는 중…" : "전부 한 파일로"}</button>
      </div>
      <table className="ev-table ev-lined data-export-table">
        <thead><tr><th className="text-left">자료</th><th className="text-left">들어 있는 것</th><th>건수</th><th></th></tr></thead>
        <tbody>
          {DATASETS.map((d) => (
            <tr key={d.key}>
              <td className="text-left"><b>{d.label}</b></td>
              <td className="text-left ev-dim">{d.desc}</td>
              <td className="tc mono-number">{counts[d.key] == null ? "…" : counts[d.key].toLocaleString("ko-KR")}</td>
              <td className="tc"><button type="button" className="btn-secondary btn-sm" disabled={!companyId || !!busy || counts[d.key] === 0} onClick={() => one(d)}>{busy === d.key ? "만드는 중…" : "내려받기"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="data-export-foot">파일보관함의 파일은 파일보관함에서, 급여명세서는 구성원 › 급여에서 따로 내려받습니다.</p>
    </div>
  );
}
