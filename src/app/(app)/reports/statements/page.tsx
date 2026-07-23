"use client";

// 회계 자료 허브 — 정식 재무제표 모음(손익계산서·재무상태표·비용분석). 세무사 제출·정밀 확인용.
//   대표 친화 화면(경영요약·매출·비용)과 분리해 "필요할 때 보는 정식 자료" 위치로 보존.

import Link from "next/link";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";

const DOCS = [
  { href: "/reports/pnl", title: "손익계산서 (P&L)", desc: "매출·매출원가·판관비·영업이익 등 기간 손익을 정식 회계 양식으로." },
  { href: "/reports/bs", title: "재무상태표 (B/S)", desc: "자산·부채·자본의 현재 잔액을 정식 회계 양식으로." },
  { href: "/reports/costs", title: "비용 분석 (고정비·변동비)", desc: "비용을 항목·성격(고정/변동)별로 상세 분해." },
];

export default function StatementsHub() {
  const { role } = useUser();
  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="회계 자료는 대표·관리자 전용입니다." />;
  }
  return (
    <div>
      <ReportsTabs />
      <div className="statements-hub-grid">
        {DOCS.map((d) => (
          <Link key={d.href} href={d.href}
            className="statements-hub-card glass-card group">
            <div className="text-[15px] font-bold text-[var(--text)]">{d.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">{d.desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] transition-transform group-hover:translate-x-0.5">
              열기
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
