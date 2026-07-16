"use client";

// 미수금 회수 미리보기 — 대시보드 카드(2026-07-14). 발행한 매출 세금계산서 중 아직 입금(settled)이
//   안 된 잔액을 거래처별로 모아 "누가 얼마 밀렸는지 + 연체일"을 보여주고, 클릭 시 거래처 원장으로 이동.
//   입금 매칭 트리거(Phase 1)로 프로젝트/입금이 자동 연결된 데이터를 그대로 활용. 미수 없으면 카드 숨김.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const db = supabase as any;

function won(n: number): string {
  if (!n) return "0";
  const a = Math.abs(n);
  if (a >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${Math.round(n / 10000).toLocaleString("ko")}만`;
  return n.toLocaleString("ko");
}

type CpGroup = { name: string; outstanding: number; oldestDays: number; count: number };

export function ReceivablesPreview({ companyId, companyName }: { companyId: string; companyName?: string }) {
  const { toast } = useToast();
  // 독촉 문구 생성·복사 — 자동 발송이 아니라 사람이 검토 후 직접(카톡/문자/메일) 발송(확정은 사람 원칙).
  const copyDunning = async (g: CpGroup) => {
    const amt = Math.round(g.outstanding).toLocaleString("ko");
    const co = companyName ? `${companyName} ` : "";
    const aging = g.oldestDays >= 30 ? `${g.oldestDays}일 경과` : `발행 후 ${g.oldestDays}일 경과`;
    const msg =
      `안녕하세요, ${g.name} 담당자님.\n` +
      `${co}미수금 안내드립니다.\n` +
      `현재 미결제 금액 ${amt}원이 ${aging}되어 확인 요청드립니다.\n` +
      `확인 후 입금 부탁드리며, 이미 처리하셨다면 양해 부탁드립니다. 감사합니다.`;
    try {
      await navigator.clipboard.writeText(msg);
      toast("독촉 문구를 복사했습니다 — 카톡/문자/메일에 붙여넣어 보내세요", "success");
    } catch {
      window.prompt("아래 문구를 복사하세요", msg);
    }
  };

  const { data } = useQuery({
    queryKey: ["dash-receivables", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 400);
      const { data: rows } = await db.from("tax_invoices")
        .select("counterparty_name, total_amount, supply_amount, settled_amount, issue_date, status")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void")
        .gte("issue_date", since.toISOString().slice(0, 10))
        .limit(1000);
      const now = new Date();
      const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const byCp: Record<string, CpGroup> = {};
      for (const r of (rows || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
        if (bal <= 1) continue;
        const name = r.counterparty_name || "미상";
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const g = byCp[name] || (byCp[name] = { name, outstanding: 0, oldestDays: 0, count: 0 });
        g.outstanding += bal;
        g.count += 1;
        g.oldestDays = Math.max(g.oldestDays, days);
      }
      const list = Object.values(byCp).sort((a, b) => b.oldestDays - a.oldestDays || b.outstanding - a.outstanding);
      const total = list.reduce((s, g) => s + g.outstanding, 0);
      return { list, total };
    },
  });

  if (!data || data.list.length === 0) return null;
  const top = data.list.slice(0, 5);

  return (
    <div className="receivables-preview glass-card">
      <div className="receivables-preview-header">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider shrink-0 text-[var(--danger)]">미수금</span>
          <span className="text-[17px] leading-none font-extrabold mono-number text-[var(--danger)]">{won(data.total)}</span>
          <span className="text-[10px] text-[var(--text-dim)] truncate">거래처 {data.list.length}곳</span>
        </div>
        <Link href="/partners/ledger?type=sales" className="text-[11px] font-semibold text-[var(--primary)] hover:underline shrink-0 no-underline">이동 →</Link>
      </div>
      <div className="receivables-preview-list">
        {top.map((g) => (
          <div key={g.name} className="receivables-preview-row">
            <Link href="/partners/ledger?type=sales" className="flex items-center gap-2 min-w-0 flex-1 no-underline">
              <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{g.name}<span className="text-[var(--text-dim)]">{g.count > 1 ? ` · ${g.count}건` : ""}</span></span>
              {g.oldestDays > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${g.oldestDays >= 30 ? "bg-[var(--danger)]/12 text-[var(--danger)]" : "bg-[var(--warning)]/12 text-[var(--warning)]"}`}>
                  {g.oldestDays >= 30 ? `${g.oldestDays}일 지연` : `발행 D+${g.oldestDays}`}
                </span>
              )}
            </Link>
            <span className="text-[11px] mono-number font-bold shrink-0 text-[var(--danger)]">{won(g.outstanding)}</span>
            <button onClick={() => copyDunning(g)} title="독촉 문구 복사 (직접 발송)"
              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--primary)] hover:border-[var(--primary)] transition">
              독촉
            </button>
          </div>
        ))}
        {data.list.length > 5 && (
          <Link href="/partners/ledger?type=sales" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] px-2 pt-1 no-underline transition">외 {data.list.length - 5}곳 더 보기 →</Link>
        )}
      </div>
    </div>
  );
}
