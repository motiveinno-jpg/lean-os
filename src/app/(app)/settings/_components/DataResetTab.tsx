"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const DIRECT_DELETE_TABLES = [
  // ── Layer 1: 최하위 자식 (다른 테이블을 참조만 함) ──
  "deal_files", "deal_classifications",
  "certificate_logs",
  "tax_invoice_queue",
  "expense_approvals",
  "document_notifications",
  "billing_events", "feedback", "finance_access_logs",
  "audit_logs", "auto_discovery_results",
  "ai_pending_actions", "ai_interactions",
  "growth_targets",

  // ── Layer 2: bank_transactions/card_transactions (→ deals, bank_accounts, tax_invoices 참조) ──
  "bank_transactions", "card_transactions",
  "bank_classification_rules",
  "payment_queue",
  "deal_cost_schedule",
  "expense_requests",
  "financial_items",
  "vault_docs",

  // ── Layer 3: documents 자식 (signature_requests, quote_tracking → documents 참조) ──
  "quote_tracking", "signature_requests",
  "document_shares",

  // ── Layer 4: tax_invoices (→ deals, partners 참조 + 자기참조) ──
  "tax_invoices",

  // ── Layer 5: documents, chat_channels (→ deals 참조) ──
  "documents",
  "chat_channels",
  "partner_invitations",

  // ── Layer 6: deals (→ partners, bank_accounts, programs 참조) ──
  "deals",

  // ── Layer 7: bank_accounts 자식 ──
  "loans", "recurring_payments", "routing_rules",
  "payment_batches",
  "contract_archives",
  "hr_contract_packages",
  "closing_checklists",

  // ── Layer 8: 핵심 엔티티 ──
  "partners",
  "bank_accounts", "corporate_cards",

  // ── Layer 9: approval (requests → policies) ──
  "approval_requests", "approval_policies",

  // ── Layer 10: 독립 테이블 ──
  "automation_credentials", "automation_logs", "automation_runs",
  "sync_jobs", "hometax_sync_log", "company_integrations",
  "monthly_financials", "treasury_positions",
  "vault_assets", "vault_accounts",
  "invoices", "transactions",
  "doc_templates", "programs",
  "notifications",
  "vendors", "cash_snapshot",
] as const;

// company_id 없이 부모 FK로 삭제해야 하는 테이블
const CHILD_DELETE_GROUPS: { parent: string; parentKey: string; children: { table: string; fk: string }[] }[] = [
  {
    parent: "deals",
    parentKey: "deal_id",
    children: [
      { table: "deal_milestones", fk: "deal_id" },
      { table: "deal_assignments", fk: "deal_id" },
      { table: "deal_revenue_schedule", fk: "deal_id" },
      { table: "deal_nodes", fk: "deal_id" },
      { table: "sub_deals", fk: "parent_deal_id" },
    ],
  },
  {
    parent: "approval_requests",
    parentKey: "request_id",
    children: [{ table: "approval_steps", fk: "request_id" }],
  },
  {
    parent: "documents",
    parentKey: "document_id",
    children: [
      { table: "doc_revisions", fk: "document_id" },
      { table: "doc_approvals", fk: "document_id" },
      { table: "hr_contract_package_items", fk: "document_id" },
    ],
  },
  {
    parent: "document_shares",
    parentKey: "share_id",
    children: [
      { table: "document_share_feedback", fk: "share_id" },
      { table: "document_share_views", fk: "share_id" },
    ],
  },
  {
    parent: "chat_channels",
    parentKey: "channel_id",
    children: [
      { table: "chat_mentions", fk: "channel_id" },
      { table: "chat_files", fk: "channel_id" },
      { table: "chat_action_cards", fk: "channel_id" },
      { table: "chat_messages", fk: "channel_id" },
      { table: "chat_events", fk: "channel_id" },
      { table: "chat_members", fk: "channel_id" },
      { table: "chat_participants", fk: "channel_id" },
    ],
  },
  {
    parent: "loans",
    parentKey: "loan_id",
    children: [{ table: "loan_payments", fk: "loan_id" }],
  },
  {
    parent: "closing_checklists",
    parentKey: "checklist_id",
    children: [{ table: "closing_checklist_items", fk: "checklist_id" }],
  },
  {
    parent: "treasury_positions",
    parentKey: "position_id",
    children: [{ table: "treasury_transactions", fk: "position_id" }],
  },
  {
    parent: "payment_batches",
    parentKey: "batch_id",
    children: [{ table: "payroll_items", fk: "batch_id" }],
  },
  {
    parent: "transactions",
    parentKey: "transaction_id",
    children: [{ table: "transaction_matches", fk: "transaction_id" }],
  },
];

export function DataResetTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "confirm" | "processing" | "done">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTable: "" });
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) setCompanyName(data.name);
      });
  }, [companyId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  async function fetchIds(table: string, col: string = "id"): Promise<string[]> {
    const { data } = await db.from(table).select(col).eq("company_id", companyId);
    if (!data || data.length === 0) return [];
    return data.map((r: Record<string, string>) => r[col]);
  }

  async function deleteByIds(table: string, fk: string, ids: string[]): Promise<string | null> {
    if (ids.length === 0) return null;
    // .in()은 URL 길이 제한이 있으므로 100개씩 배치
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error } = await db.from(table).delete().in(fk, batch);
      if (error) return `${table}: ${error.message}`;
    }
    return null;
  }

  async function handleReset() {
    setStep("processing");
    setErrors([]);
    const totalSteps = 3; // 2026-05-22 서버 RPC 1회 + 회사정보 초기화 + 완료
    let current = 0;
    const failedTables: string[] = [];

    function tick(label: string) {
      current++;
      setProgress({ current, total: totalSteps, currentTable: label });
    }

    // ── 서버 RPC 1회로 전체 데이터 일괄 삭제 ──
    //   2026-05-22: 기존 클라이언트 테이블별 단건 거대 DELETE(트리거·FK CASCADE 로 hang) →
    //   reset_company_data RPC(SECDEF, session_replication_role=replica 로 FK·트리거 우회) 1회.
    //   자식·DIRECT·멤버 detach 모두 RPC 가 트랜잭션으로 처리. 순환 FK NULL 도 불요(replica).
    tick("전체 데이터 삭제 중...");
    const { error: resetErr } = await (db as any).rpc("reset_company_data", { p_company_id: companyId });
    if (resetErr) failedTables.push(`데이터 삭제: ${resetErr.message}`);

    // ── 회사 레코드 부가 필드 초기화 (companies 레코드 자체는 보존) ──
    tick("회사 정보 초기화");
    await db
      .from("companies")
      .update({
        business_number: null,
        representative: null,
        address: null,
        phone: null,
        fax: null,
        business_type: null,
        business_category: null,
        seal_url: null,
        logo_url: null,
        tax_settings: null,
        cert_settings: null,
      })
      .eq("id", companyId);

    // CODEF connectedId도 초기화 (stale CF-04019 방지)
    await db
      .from("company_settings")
      .update({ codef_connected_id: null, codef_connected_at: null })
      .eq("company_id", companyId);

    // localStorage 온보딩 상태 초기화
    if (typeof window !== "undefined") {
      localStorage.removeItem("leanos-onboarding-done");
      localStorage.removeItem("leanos-onboarding-dismissed");
    }

    queryClient.clear();
    setErrors(failedTables);
    setStep("done");

    if (failedTables.length === 0) {
      toast("모든 데이터가 초기화되었습니다.", "success");
    } else {
      toast(`초기화 완료 (${failedTables.length}개 테이블 오류)`, "error");
    }
  }

  return (
    <div className="space-y-6">
      {/* 경고 배너 */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-lg shrink-0">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-red-500">위험 구역</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              이 작업은 되돌릴 수 없습니다. 신중하게 진행해주세요.
            </p>
          </div>
        </div>
      </div>

      {/* 전체 데이터 초기화 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-red-500/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-lg">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">전체 데이터 초기화</h3>
            <p className="text-xs text-[var(--text-muted)]">설정 및 업무 데이터를 모두 삭제합니다</p>
          </div>
        </div>

        {/* 삭제 대상 목록 */}
        <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-5">
          <p className="text-xs font-semibold text-[var(--text)] mb-3">삭제되는 데이터:</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              "통장 / 법인카드",
              "거래처",
              "프로젝트",
              "세금계산서",
              "은행·카드 거래내역",
              "승인정책 / 결재",
              "문서 / 계약",
              "CODEF 인증서 연동",
              "은행연동 자격증명",
              "알림 설정 / 내역",
              "회사 부가정보",
            ].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <span className="text-red-400 text-xs">x</span>
                <span className="text-xs text-[var(--text-muted)]">{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--text)] mb-1.5">유지되는 데이터:</p>
            <div className="flex flex-wrap gap-3">
              {["계정 (이메일/비밀번호)", "회사명", "직원 / 관리자 정보", "구독/결제 정보"].map((item) => (
                <div key={item} className="flex items-center gap-1.5">
                  <span className="text-green-400 text-xs">o</span>
                  <span className="text-xs text-[var(--text-muted)]">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {step === "idle" && (
          <button
            onClick={() => setStep("confirm")}
            className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl font-semibold text-sm transition border border-red-500/20"
          >
            데이터 초기화 시작
          </button>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
              <p className="text-sm font-bold text-red-500 mb-2">
                정말 모든 데이터를 삭제하시겠습니까?
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                확인을 위해 회사명 <span className="font-bold text-[var(--text)]">&ldquo;{companyName}&rdquo;</span>을 입력해주세요.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={companyName}
                className="w-full px-4 py-3 bg-[var(--bg)] border border-red-500/30 rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-red-500 transition"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setStep("idle"); setConfirmText(""); }}
                className="flex-1 py-3 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-xl font-semibold text-sm transition border border-[var(--border)]"
              >
                취소
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== companyName}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-sm transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                초기화 실행
              </button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-semibold text-[var(--text)]">초기화 진행 중...</span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--text-muted)]">{progress.currentTable}</span>
                <span className="text-xs text-[var(--text-muted)]">{progress.current} / {progress.total}</span>
              </div>
              <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-[var(--text-dim)]">브라우저를 닫지 마세요. 잠시만 기다려주세요.</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className={`p-4 rounded-xl border ${errors.length === 0 ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
              <div className="flex items-center gap-2 mb-2">
                {errors.length === 0 ? (
                  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c-.866 1.5.217 3.374 1.948 3.374H2.697c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                )}
                <span className={`text-sm font-bold ${errors.length === 0 ? "text-green-600" : "text-amber-600"}`}>
                  {errors.length === 0 ? "초기화가 완료되었습니다" : `초기화 완료 (${errors.length}개 항목 오류)`}
                </span>
              </div>
              {errors.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">모든 데이터가 삭제되었습니다. 온보딩부터 다시 시작할 수 있습니다.</p>
              ) : (
                <div className="mt-2">
                  <p className="text-xs text-[var(--text-muted)] mb-2">일부 테이블 삭제 중 오류가 발생했습니다 (데이터가 없거나 권한 문제):</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {errors.map((err, i) => (
                      <p key={i} className="text-[10px] text-amber-600 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => window.location.href = "/dashboard"}
              className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition"
            >
              대시보드로 이동
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
