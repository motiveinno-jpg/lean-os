"use client";

// 거래처 원장 (채권·채무 대사) — v_partner_ar_ap 기반 거래처별 미수금/미지급금.
//   상단 "홈택스 거래처 연결" 버튼 → link_invoice_partners RPC (미등록 거래처 자동등록 + 송장 연결).
//   미수금 차감(정산)은 별도 매칭/확인 단계에서 처리(Phase 2). 이 화면은 현황 조회 + 연결 트리거.

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

type ArApRow = {
  company_id: string;
  partner_id: string | null;
  type: string; // 'sales' | 'purchase'
  invoice_count: number;
  total_billed: number;
  total_settled: number;
  outstanding: number;
};

const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;

export default function PartnerLedgerPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase as any;

  const { data: rows = [], isLoading } = useQuery<ArApRow[]>({
    queryKey: ["partner-ledger", companyId],
    queryFn: async () => {
      const { data } = await db.from("v_partner_ar_ap").select("*").eq("company_id", companyId);
      return (data || []) as ArApRow[];
    },
    enabled: !!companyId,
  });

  const { data: partnerMap = {} } = useQuery<Record<string, { name: string; business_number: string | null }>>({
    queryKey: ["partner-ledger-names", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number").eq("company_id", companyId);
      const m: Record<string, { name: string; business_number: string | null }> = {};
      for (const p of (data || []) as any[]) m[p.id] = { name: p.name, business_number: p.business_number };
      return m;
    },
    enabled: !!companyId,
  });

  const linkMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("link_invoice_partners");
      if (error) throw new Error(error.message);
      return data as { created: number; linked: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["partner-ledger"] });
      qc.invalidateQueries({ queryKey: ["partner-ledger-names"] });
      qc.invalidateQueries({ queryKey: ["partners"] });
      toast(`거래처 ${r?.created ?? 0}곳 등록 · 송장 ${r?.linked ?? 0}건 연결 완료`, "success");
    },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const recv = rows.filter((r) => r.type === "sales").sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    const pay = rows.filter((r) => r.type === "purchase").sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return {
      receivables: recv,
      payables: pay,
      totalAr: recv.reduce((s, r) => s + Number(r.outstanding || 0), 0),
      totalAp: pay.reduce((s, r) => s + Number(r.outstanding || 0), 0),
    };
  }, [rows]);

  const nameOf = (pid: string | null) => (pid && partnerMap[pid]?.name) || "미지정 거래처";

  const Section = ({ title, data, accent }: { title: string; data: ArApRow[]; accent: string }) => (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--text)]">{title}</h2>
        <span className="text-xs text-[var(--text-dim)]">{data.length}곳</span>
      </div>
      {data.length === 0 ? (
        <div className="p-10 text-center text-sm text-[var(--text-muted)]">
          연결된 거래처 송장이 없습니다. 상단 “홈택스 거래처 연결”을 먼저 실행하세요.
        </div>
      ) : (
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-[var(--bg-surface)]">
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-2.5 font-medium">거래처</th>
                <th className="text-right px-5 py-2.5 font-medium">송장</th>
                <th className="text-right px-5 py-2.5 font-medium">청구액</th>
                <th className="text-right px-5 py-2.5 font-medium">정산액</th>
                <th className="text-right px-5 py-2.5 font-medium">잔액</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.partner_id}-${r.type}`} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-2.5 text-[var(--text)]">{nameOf(r.partner_id)}</td>
                  <td className="px-5 py-2.5 text-right text-[var(--text-muted)]">{r.invoice_count}</td>
                  <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.total_billed)}</td>
                  <td className="px-5 py-2.5 text-right text-[var(--text-muted)] mono-number">{won(r.total_settled)}</td>
                  <td className={`px-5 py-2.5 text-right font-semibold mono-number ${Number(r.outstanding) > 0 ? accent : "text-[var(--text-dim)]"}`}>{won(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="page-sticky-header flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">거래처 원장 (채권·채무)</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">세금계산서 기준 거래처별 미수금/미지급금</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/partners" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래처</Link>
          <button
            onClick={() => { if (!linkMut.isPending) linkMut.mutate(); }}
            disabled={linkMut.isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
            title="홈택스 송장의 거래처를 사업자번호로 자동 등록하고 송장에 연결합니다"
          >
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-card px-5 py-4">
          <div className="text-xs text-[var(--text-muted)]">총 미수금 (받을 돈)</div>
          <div className="text-2xl font-bold text-emerald-500 mono-number mt-1">{won(totalAr)}</div>
        </div>
        <div className="glass-card px-5 py-4">
          <div className="text-xs text-[var(--text-muted)]">총 미지급금 (줄 돈)</div>
          <div className="text-2xl font-bold text-red-400 mono-number mt-1">{won(totalAp)}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : (
        <>
          <Section title="미수금 (매출 채권)" data={receivables} accent="text-emerald-500" />
          <Section title="미지급금 (매입 채무)" data={payables} accent="text-red-400" />
        </>
      )}

      <p className="text-[11px] text-[var(--text-dim)]">
        ※ 잔액은 확정(confirmed)된 정산만 차감됩니다. 입금↔송장 자동 매칭/확인은 다음 단계에서 제공됩니다.
      </p>
    </div>
  );
}
