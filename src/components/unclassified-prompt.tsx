"use client";

// 미분류 거래 정리 프롬프트 — 계정과목 미지정 통장·카드 거래 건수를 대시보드에 노출하고,
//   '자동 정리' 원클릭으로 규칙·학습 기반 자동분류(runAllAutomation organize)를 실행(2026-07-15).
//   ⚠️ CODEF 호출 없음(비용 0) — '동기화' 버튼이 쓰는 organize 티어만 재사용. 미분류 0건이면 표시 안 함.

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { runAllAutomation } from "@/lib/automation";
import { useToast } from "@/components/toast";

export function UnclassifiedPrompt({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const { data: count = 0, refetch } = useQuery({
    queryKey: ["unclassified-count", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as any;
      const [b, c] = await Promise.all([
        db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("mapping_status", "unmapped"),
        db.from("card_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("mapping_status", "unmapped"),
      ]);
      return (b.count || 0) + (c.count || 0);
    },
  });

  if (count === 0) return null;

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await runAllAutomation(companyId, { includeDrafts: false, includeRisky: false });
      const done = (r.bankClassification?.matched || 0) + (r.cardMapping?.matched || 0);
      if (done > 0) {
        toast(`${done}건 자동 분류 완료`, "success");
        qc.invalidateQueries({ queryKey: ["founder-data"] });
      } else {
        toast("자동 분류할 규칙이 아직 없어요. 통장에서 직접 한 번 분류하면 다음부터 자동 적용됩니다.", "info");
      }
      await refetch();
    } catch (e: any) {
      toast(e?.message || "자동 분류에 실패했습니다", "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="unclassified-prompt mb-4 flex items-center gap-3 px-4 py-2.5 rounded-xl border" style={{ background: "color-mix(in srgb, var(--warning) 8%, transparent)", borderColor: "color-mix(in srgb, var(--warning) 22%, transparent)" }}>
      <span className="text-base shrink-0">🗂️</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold text-[var(--text)]">미분류 거래 {count.toLocaleString()}건</div>
        <div className="text-[11px] text-[var(--text-dim)] truncate">계정과목이 지정되지 않은 통장·카드 거래입니다. 자동 정리하거나 직접 분류하세요.</div>
      </div>
      <button onClick={run} disabled={running}
        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-[var(--primary)] hover:opacity-90 transition disabled:opacity-50">
        {running ? "정리 중..." : "자동 정리"}
      </button>
      <Link href="/transactions" className="shrink-0 text-[11px] font-semibold text-[var(--primary)] hover:underline">직접 →</Link>
    </div>
  );
}
