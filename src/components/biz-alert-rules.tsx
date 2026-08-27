"use client";

// ── 경영 알림 조건 — 회사설정 › 알림 (2026-08-27 ERP 3순위 ①, 결정 75~77) ──
//   조건을 켜 두면 매일 아침 08:00 에 평가해 대표·관리자에게 알림(웹푸시 포함)이 간다. 같은 조건은 하루 한 번.
//   '지금 검사'로 바로 돌려 볼 수 있다(오늘 이미 울린 조건은 다시 안 울린다).

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useUser } from "@/components/user-context";

type Kind = "cash_runway" | "ar_overdue" | "ap_overdue" | "big_outflow";
type Rule = { id?: string; kind: Kind; threshold: number; enabled: boolean; last_fired_on: string | null };
const KINDS: { kind: Kind; label: string; desc: string; unit: string; dflt: number; step: number }[] = [
  { kind: "cash_runway", label: "현금 잔액이 고정비 N개월치 아래", desc: "통장 잔액 < (정기 지출 + 고정비) × N. 자금 전망으로 연결", unit: "개월", dflt: 2, step: 0.5 },
  { kind: "ar_overdue", label: "미수금 N일 초과가 새로 발생", desc: "오늘로 발행 N일을 넘긴 매출 계산서(미정산). 연령표로 연결", unit: "일", dflt: 60, step: 1 },
  { kind: "ap_overdue", label: "미지급금 N일 초과가 새로 발생", desc: "오늘로 발행 N일을 넘긴 매입 계산서(미정산)", unit: "일", dflt: 45, step: 1 },
  { kind: "big_outflow", label: "하루 ₩N 이상 출금", desc: "어제 통장 출금 한 건이 N원 이상(장부 제외분 빼고). 거래내역으로 연결", unit: "원", dflt: 5_000_000, step: 100_000 },
];

const EMPTY_RULES: Rule[] = [];
export function BizAlertRules({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const userId = useUser().user?.id ?? null;
  const qc = useQueryClient();
  //   기본값 [] 는 모듈 상수로 — 렌더마다 새 배열이면 아래 effect 가 무한 반복한다(2026-08-27 교훈)
  const { data: saved = EMPTY_RULES } = useQuery<Rule[]>({
    queryKey: ["biz-alert-rules", companyId],
    enabled: !!companyId,
    queryFn: async () => (logRead("biz-alerts:list", await (supabase as any).from("biz_alert_rules").select("id, kind, threshold, enabled, last_fired_on").eq("company_id", companyId)) || []) as Rule[],
  });
  const [rows, setRows] = useState<Record<Kind, Rule>>(() => Object.fromEntries(KINDS.map((k) => [k.kind, { kind: k.kind, threshold: k.dflt, enabled: false, last_fired_on: null }])) as Record<Kind, Rule>);
  useEffect(() => { if (!saved.length) return; setRows((r) => { const n = { ...r }; for (const s of saved) n[s.kind] = { ...s, threshold: Number(s.threshold) }; return n; }); }, [saved]);
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (k: Kind, patch: Partial<Rule>) => {
    if (!companyId) return;
    const cur = { ...rows[k], ...patch };
    setRows((r) => ({ ...r, [k]: cur }));
    setBusy(k);
    try {
      const { error } = await (supabase as any).from("biz_alert_rules").upsert({ company_id: companyId, kind: k, threshold: cur.threshold, enabled: cur.enabled, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "company_id,kind" });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["biz-alert-rules", companyId] });
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(null); }
  };
  const runNow = async () => {
    setBusy("run");
    try {
      const { data, error } = await (supabase as any).rpc("run_my_biz_alerts");
      if (error) throw error;
      toast(Number(data) > 0 ? `조건 ${data}개가 맞아 알림을 보냈습니다 — 상단 알림 종에서 확인` : "지금 맞는 조건이 없습니다(오늘 이미 울린 조건은 다시 울리지 않습니다)", Number(data) > 0 ? "success" : "info");
      qc.invalidateQueries({ queryKey: ["biz-alert-rules", companyId] });
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    } catch (e) { toast(friendlyError(e, "검사 실패"), "error"); }
    finally { setBusy(null); }
  };
  const fmt = (k: Kind, v: number) => (k === "big_outflow" ? v.toLocaleString("ko-KR") : String(v));

  return (
    <div className="notification-quiet-hours-card glass-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">경영 알림 조건</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">켜 둔 조건을 매일 아침 08:00 에 검사해 대표·관리자에게 알립니다(직원에게는 안 갑니다). 같은 조건은 하루 한 번.</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" disabled={busy === "run"} onClick={runNow} title="오늘 기준으로 바로 검사">{busy === "run" ? "검사 중…" : "지금 검사"}</button>
      </div>
      <div className="bar-list">
        {KINDS.map((k) => { const r = rows[k.kind]; return (
          <div key={k.kind} className={r.enabled ? "bar-row bar-row-on" : "bar-row"}>
            <button type="button" role="switch" aria-checked={r.enabled} onClick={() => save(k.kind, { enabled: !r.enabled })} disabled={busy === k.kind}
              className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${r.enabled ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${r.enabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
            <div className="bar-text">
              <b>{k.label.replace("N", fmt(k.kind, r.threshold))}</b>
              <span className="ev-dim">{k.desc}{r.last_fired_on ? ` · 마지막 알림 ${r.last_fired_on}` : ""}</span>
            </div>
            <label className="bar-th">N =
              <input className="inv-input bar-th-in mono-number" value={fmt(k.kind, r.threshold)} onChange={(e) => setRows((x) => ({ ...x, [k.kind]: { ...x[k.kind], threshold: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } }))}
                onBlur={(e) => { const v = Number(e.target.value.replace(/[^0-9.]/g, "")) || k.dflt; save(k.kind, { threshold: v }); }} />
              <span className="ev-dim">{k.unit}</span>
            </label>
          </div>
        ); })}
      </div>
    </div>
  );
}
