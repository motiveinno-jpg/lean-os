"use client";

import { useState, useCallback } from "react";
import { useUser } from "@/components/user-context";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { detectFileType, FILE_TYPE_LABELS, type DetectedFileType, type FileDetectionResult } from "@/lib/file-detector";
import { parseHomeTaxExcel, bulkImportTaxInvoices } from "@/lib/tax-invoice";
import { parseFlexExport, type FlexEmployee } from "@/lib/flex-parser";
import { parseHandoverDoc, type HandoverParseResult } from "@/lib/handover-parser";
import { parseExcel, type ParsedExcelData } from "@/lib/excel-parser";
import { setupRecurringFromExcel } from "@/lib/smart-setup";
import { runAllAutomation } from "@/lib/automation";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";

const db = supabase as any;

// ── Formatters ──
function fmtN(n: number): string {
  return n.toLocaleString("ko-KR");
}

// ── Upload state machine ──
type ImportStep = "idle" | "detecting" | "preview" | "importing" | "done" | "error";

interface ImportState {
  step: ImportStep;
  file: File | null;
  detection: FileDetectionResult | null;
  previewData: any;
  result: ImportResult | null;
  error: string | null;
}

interface ImportResult {
  inserted: number;
  type: DetectedFileType;
  automationRan: boolean;
  details: string[];
}

const INITIAL_STATE: ImportState = { step: "idle", file: null, detection: null, previewData: null, result: null, error: null };

export default function ImportHubPage() {
  const { role } = useUser();
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const [isDragging, setIsDragging] = useState(false);

  // ── 최근 import 이력 (automation_runs) ──
  const { data: recentRuns = [] } = useQuery({
    queryKey: ["import-hub-runs"],
    queryFn: async () => {
      const u = await getCurrentUser();
      if (!u) return [];
      const { data } = await db
        .from("automation_runs")
        .select("id, trigger, run_type, status, summary, created_at")
        .eq("company_id", u.company_id)
        .in("trigger", ["import_hub", "manual", "excel_upload"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
  });

  // ── 파일 선택 / 드롭 핸들러 ──
  const handleFile = useCallback(async (file: File) => {
    const MAX_FILE_MB = 20;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setState(s => ({ ...s, step: "error", error: `파일 크기가 ${MAX_FILE_MB}MB를 초과합니다. 더 작은 파일을 선택해주세요.` }));
      return;
    }
    setState({ ...INITIAL_STATE, step: "detecting", file });

    try {
      const detection = await detectFileType(file);
      if (detection.type === "unknown") {
        setState(s => ({ ...s, step: "error", detection, error: detection.reason }));
        return;
      }

      // 유형별 미리보기 데이터 생성
      const buffer = await file.arrayBuffer();
      let previewData: any = null;

      switch (detection.type) {
        case "bank_csv":
        case "card_csv": {
          const text = await file.text();
          const lines = text.split("\n").filter(l => l.trim());
          const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
          const rows = lines.slice(1, 51).map(line => {
            const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
            const row: Record<string, string> = {};
            headers.forEach((h, i) => { row[h] = vals[i] || ""; });
            return row;
          });
          previewData = { headers, rows, totalRows: lines.length - 1 };
          break;
        }
        case "hometax_excel": {
          const wb = XLSX.read(buffer, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const jsonRows = XLSX.utils.sheet_to_json(sheet) as any[];
          const parsed = parseHomeTaxExcel(jsonRows);
          previewData = {
            items: parsed.slice(0, 50),
            totalRows: parsed.length,
            salesCount: parsed.filter(p => p.type === "sales").length,
            purchaseCount: parsed.filter(p => p.type === "purchase").length,
          };
          break;
        }
        case "flex_hr_excel": {
          const result = parseFlexExport(buffer);
          previewData = result;
          break;
        }
        case "ceo_report_excel": {
          const result = parseExcel(buffer);
          previewData = result;
          break;
        }
        case "handover_excel": {
          const result = parseHandoverDoc(buffer);
          previewData = result;
          break;
        }
      }

      setState(s => ({ ...s, step: "preview", detection, previewData }));
    } catch (e: any) {
      setState(s => ({ ...s, step: "error", error: e.message || "파일 파싱 실패" }));
    }
  }, []);

  // ── 가져오기 실행 ──
  const handleImport = useCallback(async () => {
    if (!state.file || !state.detection) return;
    setState(s => ({ ...s, step: "importing" }));

    try {
      const u = await getCurrentUser();
      if (!u) throw new Error("로그인이 필요합니다");
      const companyId = u.company_id;
      const details: string[] = [];
      let inserted = 0;

      switch (state.detection.type) {
        case "bank_csv": {
          const { rows } = state.previewData;
          const bankRows = rows.map((r: any) => ({
            company_id: companyId,
            transaction_date: r["거래일"] || r["거래일시"] || r["일자"] || null,
            counterparty: r["적요"] || r["기재내용"] || r["거래내용"] || "",
            description: r["내용"] || r["비고"] || "",
            amount: Math.abs(parseFloat(String(r["출금"] || r["입금"] || r["금액"] || "0").replace(/,/g, ""))),
            type: (parseFloat(String(r["입금"] || "0").replace(/,/g, "")) > 0) ? "deposit" : "withdrawal",
            balance: parseFloat(String(r["잔액"] || r["거래후잔액"] || "0").replace(/,/g, "")) || null,
            mapping_status: "unmapped",
          })).filter((r: any) => r.amount > 0);

          const { data, error } = await db.from("bank_transactions").insert(bankRows).select("id");
          if (error) throw error;
          inserted = data?.length || 0;
          details.push(`은행 거래 ${inserted}건 저장`);
          break;
        }

        case "card_csv": {
          const { rows } = state.previewData;
          const cardRows = rows.map((r: any) => ({
            company_id: companyId,
            transaction_date: r["승인일"] || r["이용일"] || null,
            merchant_name: r["가맹점"] || r["가맹점명"] || "",
            amount: Math.abs(parseFloat(String(r["결제금액"] || r["이용금액"] || r["승인금액"] || "0").replace(/,/g, ""))),
            approval_number: r["승인번호"] || null,
            installment: r["할부"] || null,
            mapping_status: "unmapped",
          })).filter((r: any) => r.amount > 0);

          const { data, error } = await db.from("card_transactions").insert(cardRows).select("id");
          if (error) throw error;
          inserted = data?.length || 0;
          details.push(`카드 거래 ${inserted}건 저장`);
          break;
        }

        case "hometax_excel": {
          const items = state.previewData.items;
          const data = await bulkImportTaxInvoices(companyId, items);
          inserted = data?.length || 0;
          details.push(`세금계산서 ${inserted}건 저장`);
          details.push(`  매출: ${items.filter((i: any) => i.type === "sales").length}건`);
          details.push(`  매입: ${items.filter((i: any) => i.type === "purchase").length}건`);
          break;
        }

        case "flex_hr_excel": {
          const employees: FlexEmployee[] = state.previewData.employees;
          for (const emp of employees) {
            const { error } = await db.from("employees").upsert({
              company_id: companyId,
              name: emp.name,
              employee_number: emp.employee_number,
              department: emp.department,
              position: emp.position,
              job_title: emp.job_title,
              salary: emp.salary || 0,
              email: emp.email,
              phone: emp.phone,
              bank_name: emp.bank_name,
              bank_account: emp.bank_account,
              bank_holder: emp.bank_holder,
              contract_type: emp.contract_type,
              status: emp.status,
              hire_date: emp.hire_date,
              is_4_insurance: true,
            }, { onConflict: "company_id,name" });
            if (!error) inserted++;
          }
          details.push(`직원 ${inserted}명 등록/업데이트`);
          break;
        }

        case "ceo_report_excel": {
          const parsed: ParsedExcelData = state.previewData;
          // monthly_financials upsert
          for (const m of parsed.months) {
            await db.from("monthly_financials").upsert({
              company_id: companyId,
              month: m.month,
              total_income: m.totalIncome,
              total_expense: m.totalExpense,
              fixed_cost: m.fixedCost,
              variable_cost: m.variableCost,
              net_cashflow: m.netCashflow,
              revenue: m.revenue,
              bank_balance: m.bankBalance,
            }, { onConflict: "company_id,month" });
          }
          inserted = parsed.months.length;
          details.push(`월별 재무 ${inserted}건 저장`);

          // 고정비 항목 → recurring_payments
          const fixedItems = parsed.items.filter(i => i.category === "fixed_cost");
          if (fixedItems.length > 0) {
            const recurResult = await setupRecurringFromExcel(companyId, fixedItems.map(i => ({
              name: i.name,
              amount: i.amount,
            })));
            details.push(`반복비용 ${recurResult.registered}건 등록 (${recurResult.skipped}건 중복 스킵)`);
          }
          break;
        }

        case "handover_excel": {
          const parsed: HandoverParseResult = state.previewData;

          // 딜 등록
          for (const deal of parsed.detectedDeals) {
            const { error } = await db.from("deals").insert({
              company_id: companyId,
              name: deal.name,
              counterparty: deal.counterparty,
              amount: deal.amount,
              contract_total: deal.amount,
              status: deal.status === "완료" ? "completed" : deal.status === "취소" ? "cancelled" : "active",
              start_date: deal.startDate,
              end_date: deal.endDate,
              memo: deal.memo,
            });
            if (!error) inserted++;
          }
          details.push(`딜/프로젝트 ${inserted}건 등록`);

          // 미수금 → deal_revenue_schedule
          let arCount = 0;
          for (const ar of parsed.detectedReceivables) {
            const { error } = await db.from("deal_revenue_schedule").insert({
              company_id: companyId,
              label: ar.counterparty,
              amount: ar.amount,
              due_date: ar.dueDate,
              status: "scheduled",
            });
            if (!error) arCount++;
          }
          if (arCount > 0) details.push(`미수금 ${arCount}건 등록`);

          // 미지급 → deal_cost_schedule
          let apCount = 0;
          for (const ap of parsed.detectedPayables) {
            const { error } = await db.from("deal_cost_schedule").insert({
              company_id: companyId,
              label: ap.name,
              amount: ap.amount,
              due_date: ap.dueDate,
              status: "scheduled",
            });
            if (!error) apCount++;
          }
          if (apCount > 0) details.push(`미지급 ${apCount}건 등록`);

          // 반복비용
          if (parsed.detectedRecurring.length > 0) {
            const recurResult = await setupRecurringFromExcel(companyId, parsed.detectedRecurring.map(r => ({
              name: r.name,
              amount: r.amount,
              category: r.category || undefined,
              recipientName: r.recipientName || undefined,
            })));
            details.push(`반복비용 ${recurResult.registered}건 등록 (${recurResult.skipped}건 중복 스킵)`);
          }

          // 직원
          let empCount = 0;
          for (const emp of parsed.detectedEmployees) {
            const { error } = await db.from("employees").upsert({
              company_id: companyId,
              name: emp.name,
              department: emp.department,
              position: emp.position,
              salary: emp.salary || 0,
              status: "active",
              is_4_insurance: true,
            }, { onConflict: "company_id,name" });
            if (!error) empCount++;
          }
          if (empCount > 0) details.push(`직원 ${empCount}명 등록`);

          // excelData 있으면 월별 재무도 저장
          if (parsed.excelData) {
            for (const m of parsed.excelData.months) {
              await db.from("monthly_financials").upsert({
                company_id: companyId,
                month: m.month,
                total_income: m.totalIncome,
                total_expense: m.totalExpense,
                fixed_cost: m.fixedCost,
                variable_cost: m.variableCost,
                net_cashflow: m.netCashflow,
                revenue: m.revenue,
                bank_balance: m.bankBalance,
              }, { onConflict: "company_id,month" });
            }
            if (parsed.excelData.months.length > 0) {
              details.push(`월별 재무 ${parsed.excelData.months.length}건 저장`);
            }
          }
          break;
        }
      }

      // automation_runs 이력 기록
      await db.from("automation_runs").insert({
        company_id: companyId,
        trigger: "import_hub",
        run_type: state.detection.type,
        status: "completed",
        summary: { inserted, type: state.detection.type, details },
      });

      // 자동화 파이프라인 실행
      let automationRan = false;
      try {
        await runAllAutomation(companyId);
        automationRan = true;
        details.push("자동화 파이프라인 실행 완료");
      } catch {
        details.push("자동화 파이프라인 실행 실패 (데이터는 저장됨)");
      }

      setState(s => ({
        ...s,
        step: "done",
        result: { inserted, type: state.detection!.type, automationRan, details },
      }));
    } catch (e: any) {
      setState(s => ({ ...s, step: "error", error: e.message || "가져오기 실패" }));
    }
  }, [state]);

  // ── 리셋 ──
  const handleReset = () => setState(INITIAL_STATE);

  // ── 파일 드롭/선택 ──
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  // ── 접근 제어 ──
  if (role !== "owner" && role !== "admin") {
    return (
      <div className="p-8 text-center text-[var(--text-muted)]">
        <p className="text-lg font-semibold">접근 권한이 없습니다</p>
        <p className="text-sm mt-1">대표 또는 관리자만 사용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">데이터 통합 가져오기</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Excel/CSV 파일을 업로드하면 자동으로 유형을 감지하고 데이터를 등록합니다
        </p>
      </div>

      {/* ── 파일 업로드 영역 ── */}
      {(state.step === "idle" || state.step === "error") && (
        <div>
          <button
            type="button"
            onClick={() => document.getElementById("import-file-input")?.click()}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`w-full rounded-xl border-2 border-dashed p-8 transition-all text-center cursor-pointer ${
              isDragging
                ? "border-[var(--primary)] bg-[var(--primary)]/5 scale-[1.01]"
                : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/3"
            }`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                isDragging ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "bg-[var(--border)]/50 text-[var(--text-muted)]"
              }`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  파일을 드래그하거나 클릭하여 선택
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Excel (.xlsx) / CSV 지원 — 파일 유형 자동 감지
                </p>
              </div>
            </div>
          </button>
          <input
            id="import-file-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFileInput}
          />

          {state.step === "error" && state.error && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {state.error}
              <button onClick={handleReset} className="ml-2 underline">다시 시도</button>
            </div>
          )}
        </div>
      )}

      {/* ── 감지 중 ── */}
      {state.step === "detecting" && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--text-muted)] mt-3">파일 분석 중...</p>
        </div>
      )}

      {/* ── 미리보기 ── */}
      {state.step === "preview" && state.detection && (
        <div className="space-y-4">
          {/* 감지 결과 카드 */}
          <DetectionCard detection={state.detection} fileName={state.file?.name || ""} />

          {/* 유형별 미리보기 */}
          {state.detection.type === "bank_csv" && <BankCSVPreview data={state.previewData} />}
          {state.detection.type === "card_csv" && <CardCSVPreview data={state.previewData} />}
          {state.detection.type === "hometax_excel" && <HometaxPreview data={state.previewData} />}
          {state.detection.type === "flex_hr_excel" && <FlexHRPreview data={state.previewData} />}
          {state.detection.type === "ceo_report_excel" && <CEOReportPreview data={state.previewData} />}
          {state.detection.type === "handover_excel" && <HandoverPreview data={state.previewData} />}

          {/* 액션 버튼 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              className="px-5 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition"
            >
              가져오기
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] transition"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* ── 가져오기 중 ── */}
      {state.step === "importing" && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--text-muted)] mt-3">데이터 저장 + 자동화 실행 중...</p>
        </div>
      )}

      {/* ── 완료 ── */}
      {state.step === "done" && state.result && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2 text-green-700 font-semibold text-sm mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              가져오기 완료
            </div>
            <ul className="text-sm text-green-800 space-y-1 ml-6">
              {state.result.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
          <button
            onClick={handleReset}
            className="px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition"
          >
            다른 파일 가져오기
          </button>
        </div>
      )}

      {/* ── 최근 이력 ── */}
      {recentRuns.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)] mb-2">최근 가져오기 이력</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  <th className="px-3 py-2 text-left font-medium">일시</th>
                  <th className="px-3 py-2 text-left font-medium">유형</th>
                  <th className="px-3 py-2 text-left font-medium">건수</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">트리거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recentRuns.map((run: any) => {
                  const summary = run.summary || {};
                  const typeLabel = FILE_TYPE_LABELS[summary.type as DetectedFileType]?.label || run.run_type || "-";
                  return (
                    <tr key={run.id} className="hover:bg-[var(--bg-surface)] transition">
                      <td className="px-3 py-2 text-[var(--text)]">
                        {new Date(run.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-[var(--text)]">{typeLabel}</td>
                      <td className="px-3 py-2 text-[var(--text)]">{summary.inserted ?? "-"}건</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          run.status === "completed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          {run.status === "completed" ? "완료" : "실패"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{run.trigger}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════

function DetectionCard({ detection, fileName }: { detection: FileDetectionResult; fileName: string }) {
  const meta = FILE_TYPE_LABELS[detection.type];
  return (
    <div className={`p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]`}>
      <div className="flex items-center gap-3">
        <span className={`text-2xl`}>{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text)]">{meta.label}</p>
          <p className="text-xs text-[var(--text-muted)] truncate">{fileName}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
          detection.confidence === "high" ? "bg-green-100 text-green-700" :
          detection.confidence === "medium" ? "bg-amber-100 text-amber-700" :
          "bg-gray-100 text-gray-500"
        }`}>
          신뢰도 {detection.confidence === "high" ? "높음" : detection.confidence === "medium" ? "보통" : "낮음"}
        </span>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-2">{detection.reason}</p>
    </div>
  );
}

function BankCSVPreview({ data }: { data: { headers: string[]; rows: Record<string, string>[]; totalRows: number } }) {
  return (
    <PreviewTable
      title={`은행 거래 미리보기 (총 ${data.totalRows}건)`}
      headers={data.headers.slice(0, 6)}
      rows={data.rows.slice(0, 10)}
    />
  );
}

function CardCSVPreview({ data }: { data: { headers: string[]; rows: Record<string, string>[]; totalRows: number } }) {
  return (
    <PreviewTable
      title={`카드 거래 미리보기 (총 ${data.totalRows}건)`}
      headers={data.headers.slice(0, 6)}
      rows={data.rows.slice(0, 10)}
    />
  );
}

function HometaxPreview({ data }: { data: { items: any[]; totalRows: number; salesCount: number; purchaseCount: number } }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--text)]">
        세금계산서 {data.totalRows}건 (매출 {data.salesCount} / 매입 {data.purchaseCount})
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-left font-medium">거래처명</th>
              <th className="px-3 py-2 text-right font-medium">공급가액</th>
              <th className="px-3 py-2 text-right font-medium">세액</th>
              <th className="px-3 py-2 text-left font-medium">발행일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.items.slice(0, 10).map((item: any, i: number) => (
              <tr key={i} className="hover:bg-[var(--bg-surface)]">
                <td className="px-3 py-2 text-[var(--text-muted)]">{i + 1}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    item.type === "sales" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                  }`}>
                    {item.type === "sales" ? "매출" : "매입"}
                  </span>
                </td>
                <td className="px-3 py-2 text-[var(--text)]">{item.counterpartyName}</td>
                <td className="px-3 py-2 text-right text-[var(--text)]">{fmtN(item.supplyAmount)}</td>
                <td className="px-3 py-2 text-right text-[var(--text-muted)]">{fmtN(item.taxAmount || 0)}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{item.issueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlexHRPreview({ data }: { data: ReturnType<typeof parseFlexExport> }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--text)]">
        직원 {data.employees.length}명 ({data.totalRows}행 중)
      </p>
      {data.warnings.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
          {data.warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">부서</th>
              <th className="px-3 py-2 text-left font-medium">직급</th>
              <th className="px-3 py-2 text-right font-medium">급여</th>
              <th className="px-3 py-2 text-left font-medium">입사일</th>
              <th className="px-3 py-2 text-center font-medium">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.employees.slice(0, 15).map((emp, i) => (
              <tr key={i} className={`hover:bg-[var(--bg-surface)] ${emp._confidence === "low" ? "bg-amber-50/50" : ""}`}>
                <td className="px-3 py-2 text-[var(--text)] font-medium">{emp.name}</td>
                <td className="px-3 py-2 text-[var(--text)]">{emp.department || "-"}</td>
                <td className="px-3 py-2 text-[var(--text)]">{emp.position || "-"}</td>
                <td className="px-3 py-2 text-right text-[var(--text)]">{emp.salary > 0 ? fmtN(emp.salary) : "-"}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{emp.hire_date || "-"}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    emp._confidence === "high" ? "bg-green-100 text-green-700" :
                    emp._confidence === "medium" ? "bg-amber-100 text-amber-700" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {emp._confidence}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.parseLog.length > 0 && (
        <details className="text-[11px] text-[var(--text-muted)]">
          <summary className="cursor-pointer hover:text-[var(--text)]">파싱 로그</summary>
          <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded text-[10px] whitespace-pre-wrap">{data.parseLog.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

function CEOReportPreview({ data }: { data: ParsedExcelData }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--text)]">
        CEO 보고자료: {data.months.length}개월 데이터, {data.items.length}개 항목
      </p>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="통장 잔고" value={`${fmtN(data.bankBalance)}원`} />
        <MiniStat label="월 고정비" value={`${fmtN(data.summary.fixedCost)}원`} />
        <MiniStat label="순현금흐름" value={`${fmtN(data.summary.netCashflow)}원`} />
      </div>
      {data.parseLog.length > 0 && (
        <details className="text-[11px] text-[var(--text-muted)]">
          <summary className="cursor-pointer hover:text-[var(--text)]">파싱 로그</summary>
          <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded text-[10px] whitespace-pre-wrap">{data.parseLog.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

function HandoverPreview({ data }: { data: HandoverParseResult }) {
  const counts = [
    data.detectedDeals.length > 0 && `딜 ${data.detectedDeals.length}건`,
    data.detectedReceivables.length > 0 && `미수금 ${data.detectedReceivables.length}건`,
    data.detectedPayables.length > 0 && `미지급 ${data.detectedPayables.length}건`,
    data.detectedRecurring.length > 0 && `반복비용 ${data.detectedRecurring.length}건`,
    data.detectedEmployees.length > 0 && `직원 ${data.detectedEmployees.length}명`,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[var(--text)]">
        인수인계 데이터: {counts.join(" / ")}
      </p>

      {data.detectedDeals.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">딜/프로젝트</p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 text-left font-medium">프로젝트</th>
                  <th className="px-3 py-1.5 text-left font-medium">거래처</th>
                  <th className="px-3 py-1.5 text-right font-medium">금액</th>
                  <th className="px-3 py-1.5 text-left font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.detectedDeals.slice(0, 8).map((d, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-surface)]">
                    <td className="px-3 py-1.5 text-[var(--text)]">{d.name}</td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{d.counterparty || "-"}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--text)]">{d.amount > 0 ? fmtN(d.amount) : "-"}</td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.detectedRecurring.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">반복비용</p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 text-left font-medium">항목</th>
                  <th className="px-3 py-1.5 text-right font-medium">금액</th>
                  <th className="px-3 py-1.5 text-left font-medium">분류</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.detectedRecurring.slice(0, 8).map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-surface)]">
                    <td className="px-3 py-1.5 text-[var(--text)]">{r.name}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--text)]">{fmtN(r.amount)}</td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{r.category || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.parseLog.length > 0 && (
        <details className="text-[11px] text-[var(--text-muted)]">
          <summary className="cursor-pointer hover:text-[var(--text)]">파싱 로그</summary>
          <pre className="mt-1 p-2 bg-[var(--bg-surface)] rounded text-[10px] whitespace-pre-wrap">{data.parseLog.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

function PreviewTable({ title, headers, rows }: { title: string; headers: string[]; rows: Record<string, string>[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--text)]">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
              {headers.map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--bg-surface)]">
                {headers.map(h => (
                  <td key={h} className="px-3 py-2 text-[var(--text)] whitespace-nowrap max-w-[200px] truncate">{row[h] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
      <p className="text-sm font-bold text-[var(--text)] mt-0.5">{value}</p>
    </div>
  );
}
