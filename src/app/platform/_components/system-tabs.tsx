"use client";
// 시스템 상태 상단 탭 (2026-07-28 사장님 요청) — 하단 작은 링크가 안 보이고,
//   하위 화면(사고기록 등)에 들어가면 돌아올 길이 없던 문제. 5개 화면이 같은
//   탭바를 공유해 어디서든 한 번에 이동/복귀할 수 있다.
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
    <div className="seg-bar w-fit overflow-x-auto max-w-full">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`seg-item whitespace-nowrap ${pathname === t.href ? "seg-item-active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
