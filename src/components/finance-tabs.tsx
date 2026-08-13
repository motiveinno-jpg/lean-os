"use client";

// 파이낸스 허브 하위 탭 — 사이드바 4그룹(거래처 / 세금·증빙 / 거래 장부 / 분석) 재편(2026-07-23).
//   각 허브의 상세 화면들을 페이지 상단 탭으로 전환. 라우트·페이지는 그대로 두고 app-shell에서 한 번만 주입.
//   현재 경로가 어느 허브에 속하는지 '가장 구체적으로 매치되는 하위'로 판정(예: /partners/reconciliation → 거래 장부).

import Link from "next/link";
import { usePathname } from "next/navigation";

type Sub = { href: string; label: string; desc: string };
type Hub = { key: string; subs: Sub[] };

const HUBS: Hub[] = [
  //   ⚠️ 'partners' 허브는 없앴다 (2026-08-12 사장님 지시) —
  //     거래처 원장이 사이드바 **분석** 그룹으로 옮겨가서, 여기 탭에 또 두면 같은 곳이 두 군데가 된다.
  //     남는 하위가 '거래처 관리' 하나뿐이라 탭 바 자체가 뜻이 없어져 허브째 뺐다.
  //     (/partners/ledger 는 그대로 살아 있다 — 사이드바로 간다)
  //   'tax' 허브(세금계산서·전자계산서·현금영수증)는 없앴다 (2026-08-13 사장님 지시).
  //   세금·증빙이 '발행하는 곳'으로 재편되면서 종류별 화면 나눔이 사라졌다 —
  //   수집은 수집·전표의 탭이, 발행은 세금·증빙의 발행 대기가 맡는다.
  //   (/e-invoices · /cash-receipts 라우트는 살아 있다 — 주소로 들어가면 그대로 열린다)
  {
    key: "ledger",
    subs: [
      { href: "/transactions", label: "자동 분류", desc: "은행 거래를 계정과목으로 자동 분류합니다." },
      { href: "/collect?tab=bank", label: "통장 처리", desc: "통장 거래를 수금 매칭·전표·계좌이동으로 처리합니다." },
    ],
  },
];

// 전표는 별도 메뉴로 유지(2026-07-23 Q2, 2026-08-11 둘로 분리) — 허브 탭에 넣지 않고 독립 화면.
//   FinanceTabs를 그리지 않는다. (경로가 /partners/reconciliation 하위라 '입금 매칭'에 잘못 매치되지
//   않도록 명시적으로 제외 — 빠뜨리면 매입매출전표 위에 거래 매칭 탭이 얹힌다)
const STANDALONE = [
  "/partners/reconciliation/voucher-entry",
  "/partners/reconciliation/sale-purchase",
];

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
      {/*   설명 줄은 뺐다 (2026-08-13 사장님) — 메뉴 사용법은 우측 상단 ? 로 간다.
            조회 상자(qk-shell) 화면에서는 상자 위에 낱장 문구가 떠 있어 구조가 흐트러졌다. */}
    </div>
  );
}
