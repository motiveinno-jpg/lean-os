"use client";
import { logRead } from "@/lib/log-read";

// 계정과목 관리 — 회사 설정 (2026-07-01)
//   회사 회계 계정과목 마스터를 한 곳에서 조회·관리. 기본(시스템) 계정은 읽기전용,
//   회사 자체 계정(is_system=false)만 추가/삭제. 거래매칭 직접입력·전표에서 이 계정을 사용.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { STANDARD_ACCOUNTS } from "@/lib/standard-accounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

type Acct = { id: string; code: string; name: string; account_type: string; is_system: boolean };
type NewAcct = { code: string; name: string; type: string };

const TYPES: { v: string; l: string }[] = [
  { v: "asset", l: "자산" }, { v: "liability", l: "부채" }, { v: "equity", l: "자본" },
  { v: "revenue", l: "수익" }, { v: "expense", l: "비용" },
];

export function ChartOfAccountsManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newAcct, setNewAcct] = useState<NewAcct | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: accounts = [] } = useQuery<Acct[]>({
    queryKey: ["coa-manage", companyId],
    queryFn: async () => {
      const data = logRead('components/chart-of-accounts-manager:data', await db.from("chart_of_accounts").select("id, code, name, account_type, is_system").eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["coa-manage", companyId] });

  const add = async () => {
    if (!newAcct || !newAcct.code.trim() || !newAcct.name.trim()) { toast("코드와 계정명을 입력하세요", "error"); return; }
    setBusy(true);
    try {
      const { error } = await db.from("chart_of_accounts").insert({ company_id: companyId, code: newAcct.code.trim(), name: newAcct.name.trim(), account_type: newAcct.type, is_system: false });
      if (error) throw error;
      toast("계정과목을 추가했습니다", "success"); setNewAcct(null); refresh();
    } catch (e: any) { toast("추가 실패: " + (e?.message || (e?.code === "23505" ? "이미 있는 코드입니다" : "")), "error"); }
    finally { setBusy(false); }
  };
  // 표준 계정과목 일괄 채우기 — 이미 있는 코드는 건너뛰고 없는 것만 추가 (unique(company_id, code))
  const fillStandard = async () => {
    setBusy(true);
    try {
      const existing = new Set((accounts as Acct[]).map((a) => a.code));
      const missing = STANDARD_ACCOUNTS.filter((s) => !existing.has(s.code));
      if (missing.length === 0) { toast("이미 모든 표준 계정이 등록되어 있습니다", "info"); return; }
      const { error } = await db.from("chart_of_accounts").upsert(
        missing.map((s) => ({ company_id: companyId, code: s.code, name: s.name, account_type: s.type, is_system: false })),
        { onConflict: "company_id,code", ignoreDuplicates: true },
      );
      if (error) throw error;
      toast(`표준 계정 ${missing.length}개를 추가했습니다`, "success"); refresh();
    } catch (e: any) { toast("채우기 실패: " + (e?.message || ""), "error"); }
    finally { setBusy(false); }
  };

  const remove = async (a: Acct) => {
    if (a.is_system) return;
    if (!confirm(`'${a.code} ${a.name}' 계정과목을 삭제할까요?`)) return;
    try { const { error } = await db.from("chart_of_accounts").delete().eq("id", a.id); if (error) throw error; toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  const grouped = TYPES.map((t) => ({ ...t, items: (accounts as Acct[]).filter((a) => a.account_type === t.v) }));

  return (
    <div className="coa-manager glass-card">
      <div className="coa-header">
        <h2 className="text-base font-bold text-[var(--text)]">계정과목 관리</h2>
        <div className="flex items-center gap-2">
          <button onClick={fillStandard} disabled={busy} className="btn-secondary">{busy ? "추가 중…" : "표준 계정과목 채우기"}</button>
          <button onClick={() => setNewAcct({ code: "", name: "", type: "asset" })} className="btn-primary">+ 계정과목 추가</button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-4">회사 회계의 계정과목 마스터입니다. 기본 계정은 읽기전용, 회사 자체 계정만 추가·삭제할 수 있습니다. “표준 계정과목 채우기”로 일반기업회계 기준 ~90개 계정을 한 번에 등록할 수 있습니다. (거래매칭 직접입력·전표 처리에서 사용)</p>

      {newAcct && (
        <div className="coa-new-row">
          <input value={newAcct.code} onChange={(e) => setNewAcct({ ...newAcct, code: e.target.value })} placeholder="코드 (예: 176)" className="w-28 h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]" />
          <input value={newAcct.name} onChange={(e) => setNewAcct({ ...newAcct, name: e.target.value })} placeholder="계정명 (예: 임차보증금)" className="flex-1 min-w-[140px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]" />
          <select value={newAcct.type} onChange={(e) => setNewAcct({ ...newAcct, type: e.target.value })} className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]">
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <button onClick={add} disabled={busy} className="px-3 h-8 text-xs font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-50">추가</button>
          <button onClick={() => setNewAcct(null)} className="px-2 h-8 text-xs text-[var(--text-muted)]">취소</button>
        </div>
      )}

      <div className="coa-groups">
        {grouped.filter((g) => g.items.length > 0).map((g) => (
          <div key={g.v} className="coa-group">
            <div className="text-[11px] font-bold text-[var(--text-dim)] mb-1.5">{g.l} <span className="font-normal">({g.items.length})</span></div>
            <div className="space-y-1">
              {g.items.map((a) => (
                <div key={a.id} className="coa-account-row">
                  <span className="text-xs mono-number text-[var(--text-muted)] w-12 shrink-0">{a.code}</span>
                  <span className="flex-1 text-sm text-[var(--text)] truncate">{a.name}</span>
                  {a.is_system ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-dim)] shrink-0">기본</span>
                  ) : (
                    <>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">자체</span>
                      <button onClick={() => remove(a)} className="text-xs px-2 py-0.5 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10 shrink-0">삭제</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {(accounts as Acct[]).length === 0 && <div className="text-xs text-[var(--text-dim)] py-6 text-center">계정과목이 없습니다. <b>“표준 계정과목 채우기”</b>로 기본 계정을 불러오거나 직접 추가해 보세요.</div>}
      </div>
    </div>
  );
}
