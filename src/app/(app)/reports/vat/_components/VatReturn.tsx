"use client";

// ── 부가세 신고서 준비 — 신고기간별 신고서 항목 + 매출·매입처별 세금계산서 합계표 + 세무사 전달 엑셀 (2026-08-27 ERP 공백 ④) ──
//
//   History: 분석 › 부가세는 '예상'(원본 자료)과 '전표 기준 집계'(유형별 합)까지였다. 분기마다 실제로 하는 일 —
//   신고서 칸에 맞춰 옮겨 적기, 거래처별 합계표 뽑기, 세무사에게 보내기 — 는 밖에서 손으로 했다.
//
//   결정 60 — 기준: **확정 매입매출전표**(journal_entries entry_kind=sale_purchase, status=confirmed)의 부가세 유형. 원본(홈택스 자료)이 아니다 —
//             장부에 올린 것만 신고서에 간다(2026-08-11 사장님 "전표로 처리된 것만"). 전표 없는 자료는 재무 › 전표 현황이 센다.
//   결정 61 — 신고기간 = 1기 예정(1–3월) / 1기 확정(4–6월) / 2기 예정(7–9월) / 2기 확정(10–12월). 확정 신고는 예정분을 뺀 3개월만 — 예정 신고를 안 했으면 '반기' 칩으로 6개월.
//   결정 62 — 항목 대응: 매출 ①세금계산서 발급분[11] ②카드·현금영수증 발행분[17,22] ③영세율[12] ⑤면세매출[13, 참고] /
//             매입 ⑩세금계산서 수취분[51] ⑭기타공제(카드·현금영수증)[57,61] ⑯불공제[54, 차감] 면세매입[53,58,59 참고]. 납부(환급)세액 = 매출세액 − 공제매입세액.
//   결정 63 — 합계표는 세금계산서 유형만(11·12·13 / 51·53·54). 카드·현금영수증은 합계표에 안 들어간다(국세청 서식과 같다). 거래처는 전표 줄 거래처 → 없으면 연결 계산서의 상대.
//   결정 64 — 자동으로 못 푸는 것: 신고서 제출. 여기서는 옮겨 적을 숫자와 엑셀까지만 — 신고는 홈택스에서 사람이.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { vatType } from "@/lib/vat-voucher";
import { Stat } from "@/components/query-kit";
import { useToast } from "@/components/toast";

type Row = { id: string; entry_date: string; vat_type: string | null; supply_amount: number; vat_amount: number; description: string | null;
  partnerName: string | null; partnerBizno: string | null; partnerKey: string };

export const VAT_PERIODS = [
  { key: "1p", label: "1기 예정 (1–3월)", from: "01-01", to: "03-31" },
  { key: "1c", label: "1기 확정 (4–6월)", from: "04-01", to: "06-30" },
  { key: "1h", label: "1기 반기 (1–6월)", from: "01-01", to: "06-30" },
  { key: "2p", label: "2기 예정 (7–9월)", from: "07-01", to: "09-30" },
  { key: "2c", label: "2기 확정 (10–12월)", from: "10-01", to: "12-31" },
  { key: "2h", label: "2기 반기 (7–12월)", from: "07-01", to: "12-31" },
] as const;
type PeriodKey = (typeof VAT_PERIODS)[number]["key"];
const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);

export function VatReturn({ companyId, year }: { companyId: string | null; year: number }) {
  const { toast } = useToast();
  const [period, setPeriod] = useState<PeriodKey>(() => { const m = new Date().getMonth() + 1; return m <= 3 ? "1p" : m <= 6 ? "1c" : m <= 9 ? "2p" : "2c"; });
  const P = VAT_PERIODS.find((p) => p.key === period)!;
  const from = `${year}-${P.from}`, to = `${year}-${P.to}`;

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["vat-return-rows", companyId, from, to],
    enabled: !!companyId,
    queryFn: async () => {
      const out: Row[] = []; const PAGE = 1000;
      for (let page = 0; ; page++) {
        const data = logRead("vat-return:rows", await (supabase as any).from("journal_entries")
          .select("id, entry_date, vat_type, supply_amount, vat_amount, description, tax_invoices:linked_invoice_id(counterparty_name, counterparty_bizno), journal_lines(partner_id, partners(name, business_number))")
          .eq("company_id", companyId!).eq("entry_kind", "sale_purchase").eq("status", "confirmed")
          .gte("entry_date", from).lte("entry_date", to).order("entry_date").range(page * PAGE, page * PAGE + PAGE - 1));
        const list = (data || []) as any[];
        for (const e of list) {
          const pl = (e.journal_lines || []).find((l: any) => l.partners?.name);
          const name = pl?.partners?.name || e.tax_invoices?.counterparty_name || null;
          const bizno = pl?.partners?.business_number || e.tax_invoices?.counterparty_bizno || null;
          out.push({ id: e.id, entry_date: e.entry_date, vat_type: e.vat_type, supply_amount: Number(e.supply_amount || 0), vat_amount: Number(e.vat_amount || 0), description: e.description,
            partnerName: name, partnerBizno: bizno, partnerKey: bizno || name || "(거래처 없음)" });
        }
        if (list.length < PAGE) break;
      }
      return out;
    },
  });

  const R = useMemo(() => {
    const by = (codes: string[]) => { const r = rows.filter((x) => codes.includes(String(x.vat_type || ""))); return { n: r.length, supply: r.reduce((s, x) => s + x.supply_amount, 0), vat: r.reduce((s, x) => s + x.vat_amount, 0) }; };
    const s11 = by(["11"]), s17 = by(["17", "22"]), s12 = by(["12"]), s13 = by(["13"]);
    const p51 = by(["51"]), p57 = by(["57", "61"]), p54 = by(["54"]), p53 = by(["53", "58", "59"]);
    const salesVat = s11.vat + s17.vat + s12.vat;
    const deductible = p51.vat + p57.vat;           // 불공제(54)는 뺀다
    const unknown = rows.filter((x) => !vatType(x.vat_type)).length;
    //   거래처별 합계표 — 세금계산서 유형만
    const table = (codes: string[]) => {
      const m = new Map<string, { name: string; bizno: string | null; n: number; supply: number; vat: number }>();
      for (const x of rows) {
        if (!codes.includes(String(x.vat_type || ""))) continue;
        const cur = m.get(x.partnerKey) || { name: x.partnerName || "(거래처 없음)", bizno: x.partnerBizno, n: 0, supply: 0, vat: 0 };
        cur.n += 1; cur.supply += x.supply_amount; cur.vat += x.vat_amount; m.set(x.partnerKey, cur);
      }
      return [...m.values()].sort((a, b) => b.supply - a.supply);
    };
    return { s11, s17, s12, s13, p51, p57, p54, p53, salesVat, deductible, payable: salesVat - deductible, unknown, saleTable: table(["11", "12", "13"]), buyTable: table(["51", "53", "54"]) };
  }, [rows]);

  const exportXlsx = () => {
    if (!rows.length) { toast("내보낼 전표가 없습니다", "info"); return; }
    const wb = XLSX.utils.book_new();
    const sheet1 = [
      ["부가가치세 신고서 준비", `${year}년 ${P.label}`, `${from} ~ ${to}`, "확정 매입매출전표 기준 (오너뷰)"], [],
      ["구분", "항목", "건수", "공급가액", "세액"],
      ["매출", "① 세금계산서 발급분 (11)", R.s11.n, num(R.s11.supply), num(R.s11.vat)],
      ["매출", "② 신용카드·현금영수증 발행분 (17·22)", R.s17.n, num(R.s17.supply), num(R.s17.vat)],
      ["매출", "③ 영세율 (12)", R.s12.n, num(R.s12.supply), 0],
      ["매출", "(참고) 면세매출 (13)", R.s13.n, num(R.s13.supply), 0],
      ["매출", "매출세액 합계", R.s11.n + R.s17.n + R.s12.n, num(R.s11.supply + R.s17.supply + R.s12.supply), num(R.salesVat)],
      ["매입", "⑩ 세금계산서 수취분 (51)", R.p51.n, num(R.p51.supply), num(R.p51.vat)],
      ["매입", "⑭ 기타 공제 — 카드·현금영수증 (57·61)", R.p57.n, num(R.p57.supply), num(R.p57.vat)],
      ["매입", "⑯ 공제받지 못할 매입세액 (54)", R.p54.n, num(R.p54.supply), num(R.p54.vat)],
      ["매입", "(참고) 면세매입 (53·58·59)", R.p53.n, num(R.p53.supply), 0],
      ["매입", "공제 매입세액 합계", R.p51.n + R.p57.n, num(R.p51.supply + R.p57.supply), num(R.deductible)],
      ["", "납부(환급)세액 = 매출세액 − 공제매입세액", "", "", num(R.payable)],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1); ws1["!cols"] = [{ wch: 6 }, { wch: 40 }, { wch: 8 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "신고서");
    const tbl = (t: typeof R.saleTable) => [["거래처", "사업자번호", "건수", "공급가액", "세액"], ...t.map((r) => [r.name, r.bizno || "", r.n, num(r.supply), num(r.vat)]), ["합계", "", t.reduce((s, r) => s + r.n, 0), num(t.reduce((s, r) => s + r.supply, 0)), num(t.reduce((s, r) => s + r.vat, 0))]];
    const ws2 = XLSX.utils.aoa_to_sheet(tbl(R.saleTable)); ws2["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 6 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, "매출처별 합계표");
    const ws3 = XLSX.utils.aoa_to_sheet(tbl(R.buyTable)); ws3["!cols"] = ws2["!cols"];
    XLSX.utils.book_append_sheet(wb, ws3, "매입처별 합계표");
    const ws4 = XLSX.utils.json_to_sheet(rows.map((x) => ({ 일자: x.entry_date, 유형: vatType(x.vat_type)?.label || x.vat_type || "", 거래처: x.partnerName || "", 사업자번호: x.partnerBizno || "", 공급가액: num(x.supply_amount), 세액: num(x.vat_amount), 적요: x.description || "" })));
    XLSX.utils.book_append_sheet(wb, ws4, "전표 목록");
    XLSX.writeFile(wb, `부가세신고준비_${year}_${P.label.replace(/\s|\(|\)|–/g, "")}.xlsx`);
  };

  const Line = ({ label, b, vatZero, minus }: { label: string; b: { n: number; supply: number; vat: number }; vatZero?: boolean; minus?: boolean }) => (
    <tr className={minus ? "vr-minus" : undefined}><td className="text-left">{label}</td><td className="tr mono-number">{b.n}</td><td className="tr mono-number">{won(b.supply)}</td><td className="tr mono-number">{vatZero ? "—" : (minus ? "−" : "") + won(b.vat)}</td></tr>
  );
  const Sum = ({ label, n, supply, vat }: { label: string; n: number; supply: number; vat: number }) => (
    <tr className="vr-sum"><td className="text-left">{label}</td><td className="tr mono-number">{n}</td><td className="tr mono-number">{won(supply)}</td><td className="tr mono-number">{won(vat)}</td></tr>
  );
  const Table = ({ title, t }: { title: string; t: typeof R.saleTable }) => (
    <div className="pnl-panel">
      <h3>{title}</h3><p>세금계산서·계산서 유형만 · 거래처 {t.length}곳 · 공급가액 큰 순</p>
      <div className="stg-table-wrap vr-scroll">
        <table className="ev-table ev-lined table-inv-status-sm">
          <thead><tr><th>거래처</th><th>사업자번호</th><th>건수</th><th>공급가액</th><th>세액</th></tr></thead>
          <tbody>{t.map((r) => <tr key={r.bizno || r.name}><td className="text-left">{r.name}</td><td className="tc mono-number">{r.bizno || <span className="ev-dim">—</span>}</td><td className="tr mono-number">{r.n}</td><td className="tr mono-number">{won(r.supply)}</td><td className="tr mono-number">{won(r.vat)}</td></tr>)}
            {!t.length && <tr><td colSpan={5} className="tc ev-dim">이 기간에 해당 전표가 없습니다</td></tr>}</tbody>
          {t.length > 0 && <tfoot><tr className="vr-sum"><td className="text-left">합계</td><td></td><td className="tr mono-number">{t.reduce((s, r) => s + r.n, 0)}</td><td className="tr mono-number">{won(t.reduce((s, r) => s + r.supply, 0))}</td><td className="tr mono-number">{won(t.reduce((s, r) => s + r.vat, 0))}</td></tr></tfoot>}
        </table>
      </div>
    </div>
  );

  return (
    <div className="vr-wrap">
      <div className="vr-bar">
        <span className="qk-chips">{VAT_PERIODS.map((p) => <button key={p.key} type="button" className={period === p.key ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</span>
        <span className="doc-sums-sp" />
        <button type="button" className="btn-secondary btn-sm" onClick={exportXlsx} title="신고서 · 매출처별 · 매입처별 합계표 · 전표 목록 — 4개 시트">세무사 전달 엑셀</button>
      </div>
      <div className="qk-strip vr-stats">
        <Stat label="매출세액" value={won(R.salesVat)} />
        <Stat label="공제 매입세액" value={won(R.deductible)} />
        <Stat label="불공제" value={won(R.p54.vat)} tone={R.p54.vat ? "minus" : undefined} />
        <Stat label={R.payable >= 0 ? "납부 예상" : "환급 예상"} value={won(Math.abs(R.payable))} tone={R.payable > 0 ? "minus" : "plus"} />
        <Stat label="전표" value={`${rows.length}건`} />
      </div>
      <p className="inv-hint">{from} ~ {to} 확정 매입매출전표 기준 — 홈택스 원본이 아니라 <b>장부에 올린 것</b>만. 전표 없는 자료는 재무 › 전표 현황 › 처리할 것에서. 신고는 홈택스에서 사람이 합니다.{R.unknown ? <b className="vr-warn"> · 부가세 유형이 비어 있는 전표 {R.unknown}건은 어느 칸에도 못 들어갔습니다 — 매입매출전표에서 유형을 채우세요.</b> : null}</p>
      {isLoading ? <div className="collect-empty">전표를 읽는 중…</div> : (
        <>
          <div className="pnl-grid2">
            <div className="pnl-panel">
              <h3>과세표준 및 매출세액</h3><p>신고서 ①②③ 칸에 옮겨 적는 숫자</p>
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr><th>항목</th><th>건수</th><th>공급가액</th><th>세액</th></tr></thead>
                <tbody>
                  <Line label="① 세금계산서 발급분 (11)" b={R.s11} />
                  <Line label="② 신용카드·현금영수증 발행분 (17·22)" b={R.s17} />
                  <Line label="③ 영세율 (12)" b={R.s12} vatZero />
                  <Line label="(참고) 면세매출 (13) — 신고서 밖" b={R.s13} vatZero />
                  <Sum label="매출세액 합계" n={R.s11.n + R.s17.n + R.s12.n} supply={R.s11.supply + R.s17.supply + R.s12.supply} vat={R.salesVat} />
                </tbody>
              </table>
            </div>
            <div className="pnl-panel">
              <h3>매입세액</h3><p>신고서 ⑩⑭⑯ 칸 — 불공제는 공제 합계에서 빠집니다</p>
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr><th>항목</th><th>건수</th><th>공급가액</th><th>세액</th></tr></thead>
                <tbody>
                  <Line label="⑩ 세금계산서 수취분 (51)" b={R.p51} />
                  <Line label="⑭ 기타 공제 — 카드·현금영수증 (57·61)" b={R.p57} />
                  <Line label="⑯ 공제받지 못할 매입세액 (54)" b={R.p54} minus />
                  <Line label="(참고) 면세매입 (53·58·59)" b={R.p53} vatZero />
                  <Sum label="공제 매입세액 합계" n={R.p51.n + R.p57.n} supply={R.p51.supply + R.p57.supply} vat={R.deductible} />
                  <tr className="vr-total"><td className="text-left"><b>{R.payable >= 0 ? "납부세액" : "환급세액"}</b> = 매출세액 − 공제매입세액</td><td></td><td></td><td className="tr mono-number"><b>{won(Math.abs(R.payable))}</b></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="pnl-grid2">
            <Table title="매출처별 세금계산서 합계표" t={R.saleTable} />
            <Table title="매입처별 세금계산서 합계표" t={R.buyTable} />
          </div>
        </>
      )}
    </div>
  );
}
