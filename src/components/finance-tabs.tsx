"use client";

// 파이낸스 허브 하위 탭 — 사이드바 4그룹(거래처 / 세금·증빙 / 거래 장부 / 분석) 재편(2026-07-23).
//   각 허브의 상세 화면들을 페이지 상단 탭으로 전환. 라우트·페이지는 그대로 두고 app-shell에서 한 번만 주입.
//   현재 경로가 어느 허브에 속하는지 '가장 구체적으로 매치되는 하위'로 판정(예: /partners/reconciliation → 거래 장부).

import Link from "next/link";
import { usePathname } from "next/navigation";

type Sub = { href: string; label: string; desc: string };
type Hub = { key: string; subs: Sub[] };

const HUBS: Hub[] = [
  {
    key: "partners",
    subs: [
      { href: "/partners", label: "거래처 관리", desc: "매출처·매입처 마스터 정보와 담당자를 관리합니다." },
      { href: "/partners/ledger", label: "거래처 원장", desc: "거래처별 매출·매입 잔액과 미수·미지급을 조회합니다." },
    ],
  },
  {
    key: "tax",
    subs: [
      { href: "/tax-invoices", label: "세금계산서", desc: "매출·매입 세금계산서 내역과 부가세를 관리합니다." },
      { href: "/cash-receipts", label: "현금영수증", desc: "현금영수증 발행 내역을 관리합니다." },
    ],
  },
  {
    key: "ledger",
    subs: [
      { href: "/transactions", label: "자동 분류", desc: "은행 거래를 계정과목으로 자동 분류합니다." },
      { href: "/partners/reconciliation", label: "입금 매칭", desc: "입금과 세금계산서를 매칭해 수금을 확정합니다." },
    ],
  },
];

// 전표입력은 별도 메뉴로 유지(2026-07-23 Q2) — 허브 탭에 넣지 않고 독립 화면. FinanceTabs를 그리지 않는다.
//   (경로가 /partners/reconciliation 하위라 입금 매칭에 잘못 매치되지 않도록 명시적으로 제외)
const STANDALONE = ["/partners/reconciliation/voucher-entry"];

const matchLen = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/") ? href.length : -1;

export function FinanceTabs() {
  const pathname = usePathname() || "";

  if (STANDALONE.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  // 전 허브의 모든 하위 중 가장 구체적으로(긴 href) 매치되는 하나를 찾는다.
  let best: { hub: Hub; sub: Sub; len: number } | null = null;
  for (const hub of HUBS) {
    for (const sub of hub.subs) {
      const len = matchLen(pathname, sub.href);
      if (len > (best?.len ?? -1)) best = { hub, sub, len };
    }
  }
  if (!best) return null; // 파이낸스 허브 라우트가 아니면 아무것도 그리지 않음

  const { hub, sub: active } = best;
  return (
    <div className="reports-tabs reports-header">
      <div className="reports-tabs-list no-print">
        {hub.subs.map((s) => {
          const on = s.href === active.href;
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`reports-tab-link ${
                on
                  ? "bg-[var(--primary)] text-white shadow-sm"
                  : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
      <p className="reports-tab-desc">{active.desc}</p>
    </div>
  );
}
