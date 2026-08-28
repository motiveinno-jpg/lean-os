"use client";

// ── 변경 이력 — 누가 언제 무엇을 바꿨나 (2026-08-27 ERP 3순위 ④, 결정 84~85) ──
//   audit_logs(수정·삭제 금지 RLS)를 회사 관리자가 본다. 전표·급여·서명·결재·파일·프로젝트·마감.
//   조회 화면 표준: 검색조건(기간·종류)·빠른검색 → 표(50줄) → 줄 클릭 = 전/후 상세 팝업.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst } from "@/lib/kst";
import { DateRangeField } from "@/components/date-range-field";
import { QuickSearch, quickSearchHit, Pager, usePager } from "@/components/query-kit";
import { SimpleCond, SimpleApplied, condHit, type CondLive } from "@/app/(app)/inventory/_components/simple-cond";
import { useModalKeys } from "@/hooks/use-modal-keys";

type Row = { id: string; user_id: string | null; entity_type: string; entity_id: string | null; action: string; before_json: any; after_json: any; metadata: any; created_at: string };
const TYPE_LABEL: Record<string, string> = {
  journal_entry: "전표", payroll_item: "급여명세", signature: "전자서명", approval_request: "결재 상신", approval_step: "결재 단계", file: "파일", folder: "폴더",
  deal: "프로젝트", document: "문서", closing: "회계마감", certificate: "증명서", payment_queue: "지급 실행", contract_template: "계약 서식", partner: "거래처", employee: "직원",
};
const ACTION_LABEL: Record<string, string> = {
  create: "생성", created: "생성", update: "수정", delete: "삭제", lock: "잠금", unlock: "잠금 해제", approve: "승인", approved: "승인", rejected: "반려", confirmed: "확정",
  ai_suggested: "초안", issue: "발행", issued: "발급", sign: "서명", remind: "재알림", file_uploaded: "올림", file_deleted: "삭제", folder_deleted: "폴더 삭제",
  execute_success: "지급 성공", issue_certificate: "증명서 발급", amount_changed: "금액 수정",
};
const COND_GROUPS = [{ key: "type", label: "종류", hint: "비우면 전체", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) }];
const when = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const monthAgo = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); };
const summary = (r: Row) => {
  const a = r.after_json || {};
  if (r.entity_type === "journal_entry") return `${a.voucher_no ? `#${a.voucher_no} ` : ""}${a.description || ""}${r.before_json?.status && r.before_json.status !== a.status ? ` (${ACTION_LABEL[r.before_json.status] || r.before_json.status} → ${ACTION_LABEL[a.status] || a.status})` : ""}`;
  if (r.entity_type === "payroll_item") return `${a.period_month || ""} 급여명세`;
  if (r.entity_type === "closing") return r.metadata?.entity_name || "";
  return a.name || a.title || a.file_name || r.metadata?.entity_name || r.metadata?.name || "";
};

export function AuditTrailPanel({ companyId }: { companyId: string | null }) {
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(todayKst);
  const [q, setQ] = useState("");
  const [cond, setCond] = useState<CondLive>({});
  const [open, setOpen] = useState<Row | null>(null);
  useModalKeys(!!open, () => setOpen(null));
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["audit-trail", companyId, from, to],
    enabled: !!companyId,
    queryFn: async () => (await fetchPaged<Row>("audit-trail", () => (supabase as any).from("audit_logs").select("id, user_id, entity_type, entity_id, action, before_json, after_json, metadata, created_at")
      .eq("company_id", companyId).gte("created_at", `${from}T00:00:00+09:00`).lte("created_at", `${to}T23:59:59+09:00`).order("created_at", { ascending: false }).order("id", { ascending: false }), 50000)) as Row[],
  });
  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["audit-users", companyId], enabled: !!companyId, staleTime: 300_000,
    queryFn: async () => (logRead("audit-users", await supabase.from("users").select("id, name").eq("company_id", companyId!)) || []) as any[],
  });
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name || "시스템" : "시스템");
  const shown = useMemo(() => rows.filter((r) => condHit(cond, "type", r.entity_type) && quickSearchHit(q, [nameOf(r.user_id), TYPE_LABEL[r.entity_type] || r.entity_type, ACTION_LABEL[r.action] || r.action, summary(r)])), [rows, cond, q, users]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pager = usePager(shown, 50, `${q}|${JSON.stringify(cond)}|${from}|${to}`);
  const pretty = (j: any) => (j == null ? "—" : typeof j === "object" ? JSON.stringify(j, null, 2) : String(j));

  return (
    <div className="notification-quiet-hours-card glass-card at-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">변경 이력</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">누가 언제 무엇을 바꿨나 — 전표·급여명세·서명·결재·파일·프로젝트·회계마감. 이 기록은 지우거나 고칠 수 없습니다. 급여는 금액 없이 발급 사실만 남습니다.</p>
        </div>
      </div>
      <div className="at-bar">
        <DateRangeField label={null} parts="segments" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <SimpleCond groups={COND_GROUPS} live={cond} onApply={setCond} />
        <QuickSearch value={q} onApply={setQ} placeholder="사람 · 종류 · 동작 · 내용 — 쉼표로 여러 개, Enter" />
        <span className="doc-sums-sp" />
        <span className="ev-dim">{shown.length.toLocaleString("ko")}건{rows.length >= 3000 ? " (3,000건까지만 — 기간을 줄이세요)" : ""}</span>
      </div>
      <SimpleApplied groups={COND_GROUPS} live={cond} onApply={setCond} />
      <div className="stg-table-wrap at-scroll">
        <table className="ev-table ev-lined table-inv-status-sm">
          <thead><tr><th>시각</th><th>사람</th><th>종류</th><th>동작</th><th>내용</th></tr></thead>
          <tbody>{isLoading ? <tr><td colSpan={5} className="tc ev-dim">읽는 중…</td></tr> : pager.view.map((r) => (
            <tr key={r.id} className="at-row" onClick={() => setOpen(r)}>
              <td className="tc mono-number">{when(r.created_at)}</td>
              <td className="tc">{nameOf(r.user_id)}</td>
              <td className="tc">{TYPE_LABEL[r.entity_type] || r.entity_type}</td>
              <td className="tc"><span className={`inv-pill ${/delete|reject|unlock/.test(r.action) ? "inv-pill-danger" : /confirm|approve|lock|sign|issue/.test(r.action) ? "inv-pill-ok" : "inv-pill-ghost"}`}>{ACTION_LABEL[r.action] || r.action}</span></td>
              <td className="text-left at-sum">{summary(r) || <span className="ev-dim">—</span>}</td>
            </tr>
          ))}{!isLoading && !shown.length && <tr><td colSpan={5} className="tc ev-dim">이 조건에 맞는 이력이 없습니다</td></tr>}</tbody>
        </table>
      </div>
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
      {open && (
        <div className="inv-modal" onClick={() => setOpen(null)}>
          <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>{TYPE_LABEL[open.entity_type] || open.entity_type} · {ACTION_LABEL[open.action] || open.action}</h3><button type="button" className="inv-modal-x" onClick={() => setOpen(null)}>✕</button></div>
            <p className="inv-modal-desc">{when(open.created_at)} · {nameOf(open.user_id)} · 대상 id <span className="mono-number">{open.entity_id || "—"}</span></p>
            <div className="at-diff">
              <div><b>전</b><pre>{pretty(open.before_json)}</pre></div>
              <div><b>후</b><pre>{pretty(open.after_json)}</pre></div>
            </div>
            {open.metadata && <details className="at-meta"><summary>부가 정보</summary><pre>{pretty(open.metadata)}</pre></details>}
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
