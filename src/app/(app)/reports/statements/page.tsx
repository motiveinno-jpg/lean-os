"use client";

// 회계 자료 허브 — 정식 재무제표(손익계산서·재무상태표·비용분석)와 정밀 확인용 자료(인원별 지출·3-Way 매칭).
//   세무사 제출·정밀 확인용.
//   대표 친화 화면(경영요약·매출·비용)과 분리해 "필요할 때 보는 정식 자료" 위치로 보존.

import Link from "next/link";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

// ⚠️ 2026-08-20 — 인원별 지출·3-Way 매칭이 허브에도 하위 갈래에도 없어 주소를 직접 치지 않으면
//    도달할 수 없었다(랜딩 감사에서 발견). ReportsTabs 의 subs 와 같은 목록으로 맞춘다.
const DOCS = [
  { href: "/reports/pnl", title: "손익계산서 (P&L)", desc: "매출·매출원가·판관비·영업이익 등 기간 손익을 정식 회계 양식으로." },
  { href: "/reports/bs", title: "재무상태표 (B/S)", desc: "자산·부채·자본의 현재 잔액을 정식 회계 양식으로." },
  { href: "/reports/costs", title: "비용 분석 (고정비·변동비)", desc: "비용을 항목·성격(고정/변동)별로 상세 분해." },
  { href: "/reports/by-person", title: "인원별 지출", desc: "직원별 법인카드 사용액과 급여를 사람 기준으로 합산해 봅니다." },
  { href: "/reports/three-way-match", title: "3-Way 매칭", desc: "계약 ↔ 세금계산서 ↔ 입금을 대조합니다. 미매칭 계산서에 후보를 추천하고, 확정하면 전표·미수금이 갱신됩니다." },
];

export default function StatementsHub() {
  const { role } = useUser();
  if (role === "partner" /* (P3) 멤버는 권한 게이트가 판정 */) {
    return <AccessDenied detail="회계 자료는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return (
    <div>
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
