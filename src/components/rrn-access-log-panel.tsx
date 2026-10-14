"use client";

// ── 주민등록번호 조회 기록 (2026-10-14, 결정 108 숙제 '접근 로그 열람 UI') — 회사설정 › 보안·시스템 › 접속 보안 ──
//   employee_rrn_access_log 는 2026-08-31 부터 쌓였지만 보는 화면이 없었다. 지급명세서·4대보험 엑셀이 늘어(세무 2차 5·6단계)
//   '누가 언제 누구 번호를 꺼냈나'를 확인할 곳이 필요하다. 읽기는 RLS 가 같은 회사 마스터로 좁힌다(마스터만 그린다).
//   기록은 지우거나 고칠 수 없다(정책 없음, definer 함수만 쓴다). 번호 자체는 여기서 보이지 않는다.
//   변경 이력(audit-trail-panel)과 같은 모양 — 기간·빠른검색 → 표(50줄) → 줄 클릭 = 대상자 팝업.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst } from "@/lib/kst";
import { DateRangeField } from "@/components/date-range-field";
import { QuickSearch, quickSearchHit, Pager, usePager } from "@/components/query-kit";
import { useModalKeys } from "@/hooks/use-modal-keys";

type Row = { id: string; user_id: string | null; action: string; employee_ids: string[]; created_at: string };
const ACTION_LABEL: Record<string, string> = { set: "등록·변경", delete: "삭제", get_statement: "지급명세서 엑셀", get_insurance: "4대보험 신고 엑셀" };
const when = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };

export function RrnAccessLogPanel({ companyId }: { companyId: string | null }) {
  //   조회는 드물게 일어나는 일이라 기본 기간을 3개월로 (변경 이력은 1개월)
  const [from, setFrom] = useState(() => monthsAgo(3));
  const [to, setTo] = useState(todayKst);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  useModalKeys(!!open, () => setOpen(null));
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["rrn-access-log", companyId, from, to], enabled: !!companyId,
    queryFn: async () => (await fetchPaged<Row>("rrn-access-log", () => (supabase as any).from("employee_rrn_access_log").select("id, user_id, action, employee_ids, created_at")
      .eq("company_id", companyId).gte("created_at", `${from}T00:00:00+09:00`).lte("created_at", `${to}T23:59:59+09:00`).order("created_at", { ascending: false }).order("id", { ascending: false }), 20000)) as Row[],
  });
  const { data: users = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["audit-users", companyId], enabled: !!companyId, staleTime: 300_000,
    queryFn: async () => (logRead("audit-users", await supabase.from("users").select("id, name").eq("company_id", companyId!)) || []) as any[],
  });
  const { data: emps = [] } = useQuery<{ id: string; name: string; employee_number: string | null }[]>({
    queryKey: ["rrn-log-emps", companyId], enabled: !!companyId, staleTime: 300_000,
    queryFn: async () => (logRead("rrn-log-emps", await (supabase as any).from("employees").select("id, name, employee_number").eq("company_id", companyId!).limit(5000)) || []) as any[],
  });
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name || "(지운 계정)" : "시스템");
  const empName = (id: string) => emps.find((e) => e.id === id)?.name || "(지운 구성원)";
  const targets = (r: Row) => (r.employee_ids || []).map(empName);
  const shown = useMemo(() => rows.filter((r) => quickSearchHit(q, [nameOf(r.user_id), ACTION_LABEL[r.action] || r.action, ...targets(r)])), [rows, q, users, emps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pager = usePager(shown, 50, `${q}|${from}|${to}`);

  return (
    <div className="notification-quiet-hours-card glass-card at-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">주민등록번호 조회 기록</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5" title="이 기록은 지우거나 고칠 수 없습니다. 화면의 가린 번호(앞 6자리)는 기록하지 않습니다.">누가 언제 누구의 주민등록번호를 등록하거나 엑셀로 꺼냈는지 기록합니다. 마스터만 볼 수 있습니다.</p>
        </div>
      </div>
      <div className="at-bar">
        <DateRangeField label={null} parts="segments" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <QuickSearch value={q} onApply={setQ} placeholder="사람 · 동작 · 대상자 · 쉼표로 여러 개, Enter" />
        <span className="doc-sums-sp" />
        <span className="ev-dim">{shown.length.toLocaleString("ko")}건</span>
      </div>
      <div className="stg-table-wrap at-scroll">
        <table className="ev-table ev-lined table-inv-status-sm">
          <thead><tr><th>시각</th><th>사람</th><th>동작</th><th>대상자</th></tr></thead>
          <tbody>{isLoading ? <tr><td colSpan={4} className="tc ev-dim">읽는 중…</td></tr> : pager.view.map((r) => {
            const t = targets(r);
            return (
              <tr key={r.id} className="at-row" onClick={() => setOpen(r)}>
                <td className="tc mono-number">{when(r.created_at)}</td>
                <td className="tc">{nameOf(r.user_id)}</td>
                <td className="tc"><span className={`inv-pill ${r.action === "delete" ? "inv-pill-danger" : r.action.startsWith("get_") ? "inv-pill-ok" : "inv-pill-ghost"}`}>{ACTION_LABEL[r.action] || r.action}</span></td>
                <td className="text-left at-sum">{t.length > 3 ? `${t.slice(0, 3).join(", ")} 외 ${t.length - 3}명` : t.join(", ") || <span className="ev-dim">—</span>}</td>
              </tr>
            );
          })}{!isLoading && !shown.length && <tr><td colSpan={4} className="tc ev-dim">이 기간에 조회 기록이 없습니다</td></tr>}</tbody>
        </table>
      </div>
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
      {open && (
        <div className="inv-modal" onClick={() => setOpen(null)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>{ACTION_LABEL[open.action] || open.action} · 대상자 {open.employee_ids?.length || 0}명</h3><button type="button" className="inv-modal-x" onClick={() => setOpen(null)}>✕</button></div>
            <p className="inv-modal-desc">{when(open.created_at)} · {nameOf(open.user_id)}</p>
            <div className="stg-table-wrap at-scroll">
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr><th>이름</th><th>사번</th></tr></thead>
                <tbody>{(open.employee_ids || []).map((id) => {
                  const e = emps.find((x) => x.id === id);
                  return <tr key={id}><td className="tc">{e?.name || "(지운 구성원)"}</td><td className="tc mono-number">{e?.employee_number || "—"}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
