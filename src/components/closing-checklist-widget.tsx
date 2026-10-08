"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { todayKst } from "@/lib/kst";
import { getChecklist } from "@/lib/closing";

// 월 마감 — 마스터 화면의 한 줄 진행바 (2026-10-08 결산 진입로 점검)
//   History: 체크리스트·자동 마감·잠금을 여기서 다 했지만 늘 '이번 달'만 열려 지난달을 마감할 수 없었다(운영 12건 전부 open).
//   이제 마감은 재무 › 전표 현황 › 처리할 것(components/closing-month-panel.tsx)에서 한다.
//   여기는 마감 대상인 지난달의 진행만 보여 주고 그 자리로 보낸다. 읽기만 — 보기만 해도 행을 만들던 것도 고쳤다.

const lastMonth = () => {
  const t = todayKst(); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export function ClosingChecklistWidget({ companyId }: { companyId: string | null; userId?: string | null }) {
  const month = lastMonth();
  const { data: checklist, isLoading } = useQuery({
    queryKey: ["closing-checklist", companyId, month],
    queryFn: () => getChecklist(companyId!, month),
    enabled: !!companyId,
  });
  if (isLoading) return null;

  const items = (checklist?.items || []) as { is_completed: boolean }[];
  const total = items.length;
  const done = items.filter((i) => i.is_completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barColor = pct === 100 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--danger)";
  const status = !checklist ? "시작 전" : checklist.status === "locked" ? "잠금" : checklist.status === "completed" ? "마감 완료" : "진행 중";

  return (
    <div className="master-closing-card glass-card">
      <Link href={`/finance/status?tab=todo&month=${month}`} className="master-closing-summary master-closing-toggle" title="재무 › 전표 현황 › 처리할 것에서 마감합니다">
        <h3 className="master-card-title">월 마감</h3>
        <span className="master-closing-meta">{Number(month.slice(5, 7))}월 · {status}</span>
        <div className="master-closing-bar">
          <div className="master-closing-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
        </div>
        <span className="master-closing-count">{done}/{total}</span>
        <span className="master-closing-go">마감하러 가기 →</span>
      </Link>
    </div>
  );
}
