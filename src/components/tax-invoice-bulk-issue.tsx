"use client";

// 세금계산서 엑셀 일괄발행 (2026-07-30 사장님)
//   흐름: ① 표준 양식(xlsx) 다운로드 → ② 채워서 업로드 → ③ 행별 검증 미리보기
//   (오류 행 사유 표시·정상 건만 집계) → ④ 일괄 등록+국세청 전자발행(진행률) → ⑤ 결과 요약.
//   발행 한도(요금제별 월 한도)를 사전 표시하고 초과분은 발행하지 않는다.
//   실패 건은 '등록됨(미발행)' 상태로 남아 목록에서 개별 재시도 가능.

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { useToast } from "@/components/toast";
import { createTaxInvoice, issueTaxInvoice } from "@/lib/tax-invoice";
import { getTaxInvoiceIssuanceStatus } from "@/lib/billing";
import { useModalKeys } from "@/hooks/use-modal-keys";

type ParsedRow = {
  rowNo: number;               // 엑셀 행 번호(안내용)
  issueDate: string;           // YYYY-MM-DD
  counterpartyName: string;
  counterpartyBizno: string;   // 10자리 숫자
  representative: string;
  businessType: string;
  businessItem: string;
  email: string;
  itemName: string;
  supplyAmount: number;
  taxKind: "taxable" | "zero_rated" | "exempt";
  memo: string;
  errors: string[];            // 비면 정상
};

type IssueResult = { row: ParsedRow; ok: boolean; error?: string; ntsNo?: string };

const HEADERS = [
  "작성일자*", "공급받는자 상호*", "사업자등록번호*", "대표자", "업태", "종목",
  "이메일", "품목명", "공급가액*", "과세유형(과세/영세율/면세)", "비고",
];
const EXAMPLE = [
  "2026-07-01", "(주)오너뷰상사", "123-45-67890", "홍길동", "도소매", "사무용품",
  "billing@example.com", "7월 사무용품 납품", 1000000, "과세", "월 정기 납품분",
];

const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");

/** 엑셀 셀 → YYYY-MM-DD (문자열/엑셀 직렬값/Date 모두 허용) */
function toYmd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000) {
    // 엑셀 날짜 직렬값 (1900 기준)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parseTaxKind(v: unknown): ParsedRow["taxKind"] | null {
  const s = String(v ?? "").trim();
  if (!s || s === "과세") return "taxable";
  if (s.includes("영세")) return "zero_rated";
  if (s.includes("면세")) return "exempt";
  return null;
}

function parseRows(ws: XLSX.WorkSheet): ParsedRow[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const out: ParsedRow[] = [];
  // 1행 = 헤더. 예시 행("(주)오너뷰상사" + 123-45-67890)은 자동 제외.
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || r.every((c) => c == null || String(c).trim() === "")) continue;
    const [dt, name, bizno, rep, btype, bitem, email, item, amt, kind, memo] = r;
    if (String(name ?? "").trim() === "(주)오너뷰상사" && digits(bizno) === "1234567890") continue;

    const errors: string[] = [];
    const issueDate = toYmd(dt);
    if (!issueDate) errors.push("작성일자 형식(YYYY-MM-DD) 오류");
    const cname = String(name ?? "").trim();
    if (!cname) errors.push("상호 누락");
    const bz = digits(bizno);
    if (bz.length !== 10) errors.push("사업자번호 10자리 아님");
    const amount = Number(String(amt ?? "").toString().replace(/[,원\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) errors.push("공급가액이 0보다 큰 숫자가 아님");
    const taxKind = parseTaxKind(kind);
    if (!taxKind) errors.push("과세유형은 과세/영세율/면세 중 하나");
    const mail = String(email ?? "").trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) errors.push("이메일 형식 오류");

    out.push({
      rowNo: i + 1,
      issueDate: issueDate || "",
      counterpartyName: cname,
      counterpartyBizno: bz,
      representative: String(rep ?? "").trim(),
      businessType: String(btype ?? "").trim(),
      businessItem: String(bitem ?? "").trim(),
      email: mail,
      itemName: String(item ?? "").trim(),
      supplyAmount: Number.isFinite(amount) ? amount : 0,
      taxKind: taxKind || "taxable",
      memo: String(memo ?? "").trim(),
      errors,
    });
  }
  return out;
}

export function downloadBulkIssueTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, EXAMPLE]);
  ws["!cols"] = [12, 20, 15, 10, 12, 12, 22, 24, 14, 20, 24].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "일괄발행");
  XLSX.writeFile(wb, "세금계산서_일괄발행_양식.xlsx");
}

export function TaxInvoiceBulkIssueModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<IssueResult[] | null>(null);

  const { data: quota } = useQuery({
    queryKey: ["tax-invoice-quota", companyId],
    queryFn: () => getTaxInvoiceIssuanceStatus(companyId),
  });

  const valid = useMemo(() => (rows || []).filter((r) => r.errors.length === 0), [rows]);
  const invalid = useMemo(() => (rows || []).filter((r) => r.errors.length > 0), [rows]);
  const overQuota = quota?.remaining != null && valid.length > quota.remaining;
  const issuableCount = quota?.remaining == null ? valid.length : Math.min(valid.length, quota.remaining);

  useModalKeys(true, () => { if (!issuing) onClose(); });

  const onFile = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const parsed = parseRows(wb.Sheets[wb.SheetNames[0]]);
      if (parsed.length === 0) { toast("엑셀에 데이터 행이 없습니다. 양식을 확인해주세요.", "error"); return; }
      setRows(parsed);
      setResults(null);
      setFileName(f.name);
    } catch {
      toast("엑셀 파일을 읽지 못했습니다. 양식 파일(.xlsx)인지 확인해주세요.", "error");
    }
  };

  const run = async (issueAfterCreate: boolean) => {
    if (valid.length === 0) { toast("발행 가능한 정상 행이 없습니다.", "error"); return; }
    setIssuing(true);
    setProgress(0);
    const out: IssueResult[] = [];
    const targets = issueAfterCreate ? valid.slice(0, issuableCount) : valid;
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      setProgress(i + 1);
      try {
        const inv = await createTaxInvoice({
          companyId,
          type: "sales",
          counterpartyName: r.counterpartyName,
          counterpartyBizno: r.counterpartyBizno,
          counterpartyBusinessType: r.businessType || undefined,
          counterpartyBusinessItem: r.businessItem || undefined,
          supplyAmount: r.supplyAmount,
          issueDate: r.issueDate,
          taxKind: r.taxKind,
          // 품목은 item_name 으로 — label 에 넣으면 홈택스 품목이 "용역"으로 나간다(2026-08-05 교정).
          //   label(비고)은 발행 엣지의 remark1(비고란)로 전달된다.
          itemName: r.itemName || undefined,
          label: r.memo || undefined,
        });
        if (!inv) throw new Error("등록 실패");
        if (issueAfterCreate) {
          const issued: any = await issueTaxInvoice(inv.id);
          out.push({ row: r, ok: true, ntsNo: issued?.nts_confirm_no || undefined });
        } else {
          out.push({ row: r, ok: true });
        }
      } catch (err: any) {
        out.push({ row: r, ok: false, error: `${err?.message || err}${err?.hint ? " — " + err.hint : ""}` });
      }
    }
    setResults(out);
    setIssuing(false);
    queryClient.invalidateQueries({ queryKey: ["tax-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
    queryClient.invalidateQueries({ queryKey: ["tax-invoice-quota"] });
    const ok = out.filter((x) => x.ok).length;
    const fail = out.length - ok;
    toast(
      issueAfterCreate
        ? (fail === 0 ? `${ok}건 일괄 발행 완료` : `${ok}건 발행 · ${fail}건 실패 (실패 건은 미발행으로 등록됨)`)
        : `${ok}건 등록 완료 (발행은 목록에서 진행)`,
      fail === 0 ? "success" : "info",
    );
  };

  const won = (n: number) => "₩" + n.toLocaleString("ko-KR");
  const totalSupply = valid.reduce((s, r) => s + r.supplyAmount, 0);

  return (
    <div className="bulk-issue-overlay" onClick={() => { if (!issuing) onClose(); }}>
      <div className="bulk-issue-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="bulk-issue-head">
          <div>
            <h3 className="bulk-issue-title">세금계산서 엑셀 일괄발행</h3>
            <p className="bulk-issue-sub">
              양식을 내려받아 채운 뒤 업로드하면, 검증 → 일괄 등록 → 국세청 전자발행까지 한 번에 진행됩니다.
              {quota && (
                <span className="bulk-issue-quota">
                  {" "}이번 달 발행 한도: {quota.limit == null ? "무제한" : `${quota.remaining}건 남음 (${quota.used}/${quota.limit})`}
                </span>
              )}
            </p>
          </div>
          <button onClick={() => { if (!issuing) onClose(); }} className="bulk-issue-close" aria-label="닫기">✕</button>
        </div>

        {/* 1단계 — 양식/업로드 */}
        {!rows && !results && (
          <div className="bulk-issue-step1">
            <button onClick={downloadBulkIssueTemplate} className="btn-secondary">① 엑셀 양식 다운로드</button>
            <label className="btn-primary cursor-pointer">
              ② 채운 양식 업로드
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
            </label>
            <div className="bulk-issue-hint">
              필수: 작성일자 · 상호 · 사업자등록번호 · 공급가액. 과세유형을 비우면 과세(부가세 10%)로 처리됩니다.
              세액과 합계는 자동 계산됩니다.
            </div>
          </div>
        )}

        {/* 2단계 — 검증 미리보기 */}
        {rows && !results && (
          <>
            <div className="bulk-issue-summary">
              <span className="bulk-issue-file">{fileName}</span>
              <span className="bulk-issue-count-ok">정상 {valid.length}건 · {won(totalSupply)}</span>
              {invalid.length > 0 && <span className="bulk-issue-count-bad">오류 {invalid.length}건 (발행 제외)</span>}
              {overQuota && (
                <span className="bulk-issue-count-bad">
                  한도 초과 — 앞 {issuableCount}건만 발행되고 나머지는 등록만 됩니다
                </span>
              )}
              <button className="bulk-issue-reset" onClick={() => { setRows(null); setFileName(""); }}>다른 파일</button>
            </div>
            <div className="bulk-issue-table-wrap">
              <table className="bulk-issue-table">
                <thead>
                  <tr>
                    <th>행</th><th>작성일자</th><th>상호</th><th>사업자번호</th><th>품목</th>
                    <th className="text-right">공급가액</th><th>과세유형</th><th>검증</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNo} className={r.errors.length ? "bulk-issue-row-bad" : ""}>
                      <td>{r.rowNo}</td>
                      <td>{r.issueDate || "—"}</td>
                      <td>{r.counterpartyName || "—"}</td>
                      <td className="mono-number">{r.counterpartyBizno ? `${r.counterpartyBizno.slice(0,3)}-${r.counterpartyBizno.slice(3,5)}-${r.counterpartyBizno.slice(5)}` : "—"}</td>
                      <td>{r.itemName || "—"}</td>
                      <td className="text-right mono-number">{r.supplyAmount ? won(r.supplyAmount) : "—"}</td>
                      <td>{r.taxKind === "taxable" ? "과세" : r.taxKind === "zero_rated" ? "영세율" : "면세"}</td>
                      <td>{r.errors.length ? <span className="bulk-issue-err">{r.errors.join(" · ")}</span> : <span className="bulk-issue-ok">정상</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bulk-issue-actions">
              {issuing ? (
                <div className="bulk-issue-progress">
                  <div className="bulk-issue-progress-bar"><div style={{ width: `${(progress / Math.max(1, valid.length)) * 100}%` }} /></div>
                  <span>{progress} / {issueAfterLabel(valid.length, issuableCount)} 처리 중… 창을 닫지 마세요</span>
                </div>
              ) : (
                <>
                  <button onClick={() => run(false)} className="btn-secondary" disabled={valid.length === 0}>등록만 (발행 안 함)</button>
                  <button onClick={() => run(true)} className="btn-primary" disabled={valid.length === 0}>
                    {issuableCount}건 일괄 등록 + 국세청 발행
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* 3단계 — 결과 */}
        {results && (
          <>
            <div className="bulk-issue-summary">
              <span className="bulk-issue-count-ok">성공 {results.filter((r) => r.ok).length}건</span>
              {results.some((r) => !r.ok) && <span className="bulk-issue-count-bad">실패 {results.filter((r) => !r.ok).length}건 — 미발행 상태로 등록돼 목록에서 재시도할 수 있습니다</span>}
            </div>
            <div className="bulk-issue-table-wrap">
              <table className="bulk-issue-table">
                <thead><tr><th>행</th><th>상호</th><th className="text-right">공급가액</th><th>결과</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.row.rowNo} className={r.ok ? "" : "bulk-issue-row-bad"}>
                      <td>{r.row.rowNo}</td>
                      <td>{r.row.counterpartyName}</td>
                      <td className="text-right mono-number">{won(r.row.supplyAmount)}</td>
                      <td>{r.ok
                        ? <span className="bulk-issue-ok">{r.ntsNo ? `발행 완료 · 승인번호 ${r.ntsNo}` : "완료"}</span>
                        : <span className="bulk-issue-err">{r.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bulk-issue-actions">
              <button onClick={onClose} className="btn-primary">닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function issueAfterLabel(validCount: number, issuable: number) {
  return issuable < validCount ? `${issuable} (한도 내)` : String(validCount);
}
