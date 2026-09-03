"use client";
// 시스템 상태 상단 탭 (2026-07-28 사장님 요청) — 하단 작은 링크가 안 보이고,
//   하위 화면(사고기록 등)에 들어가면 돌아올 길이 없던 문제. 5개 화면이 같은
//   탭바를 공유해 어디서든 한 번에 이동/복귀할 수 있다.
//   2026-09-03 v2: pf-seg 세그먼트 스타일로 통일(운영자 페이지 디자인 개편).
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/platform/health", label: "개요" },
  { href: "/platform/errors", label: "에러 해석" },
  { href: "/platform/dependencies", label: "외부 서비스" },
  { href: "/platform/incidents", label: "사고 기록" },
  { href: "/platform/audit", label: "운영자 로그" },
];

export function SystemTabs() {
  const pathname = usePathname();
  return (
    <div className="pf-seg pf-in" role="tablist" style={{ ["--pf-i" as string]: 1 }}>
      {TABS.map((t) => {
        const on = pathname === t.href;
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={`pf-seg-item inline-flex items-center ${on ? "pf-seg-item-on" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
