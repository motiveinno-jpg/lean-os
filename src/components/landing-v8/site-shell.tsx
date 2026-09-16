"use client";
// ══════════════════════════════════════════════════════════════
//  공개 페이지 공용 머리·바닥 — 랜딩 v8 모양 (2026-09-14, 결정 227)
//
//  ▸ 전에는 머리가 두 벌이었다: `/` 는 v8 머리(업종별·메뉴·일하는 방식…), 계산기·요금·기능 페이지는
//    옛 LandingNav(OwnerView 로고·FAQ→/#faq 빈 링크). v8 머리에서는 요금·계산기·블로그로 가는 길이 없었다.
//  ▸ 쓰는 곳: `/` · /features · /pricing · /tools 허브·계산기 6 · /tax-partners · /blog (2026-09-14 이관 1~5단계 끝).
//    /contact 는 일부러 덜어낸 머리를 따로 쓰고 바닥만 쓴다(결정 221). /demo 는 앱 모양이라 쓰지 않는다.
//  ▸ 스타일은 landing-v8.css — 부모에 `.lp8` 이 있어야 한다.
//  ▸ 랜딩 계열은 늘 밝게 — 옛 LandingNav 가 하던 useLandingLightTheme 를 여기서 이어받는다
//    (다크 앱 사용자가 계산기에 오면 body 로 나간 달력이 검게 뜨던 문제, 2026-08-14).
// ══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLandingLightTheme } from "@/components/theme-context";
import { TOOLS } from "@/app/tools/_seo";
import { CONSULT_HREF, FOOTER, MEGA, SIGNUP_HREF } from "./content";

type Open = null | "mega" | "tools" | "drawer";

const LINKS = [
  { href: "/features", label: "기능" },
  { href: "/pricing", label: "요금" },
  { href: "/blog", label: "블로그" },
  { href: "/tax-partners", label: "세무사 제휴" },
];

function Brand() {
  return (
    <Link className="brand" href="/">
      <i>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />
        </svg>
      </i>
      오너뷰
    </Link>
  );
}

export function SiteHeader() {
  useLandingLightTheme();
  const [open, setOpen] = useState<Open>(null);
  const path = usePathname();

  /* 주소가 바뀌면 닫는다 */
  useEffect(() => { setOpen(null); }, [path]);

  /* 바깥을 누르거나 Esc 로 닫는다 */
  useEffect(() => {
    if (!open) return;
    const off = () => setOpen(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("click", off);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", off); window.removeEventListener("keydown", key); };
  }, [open]);

  const toggle = (k: Exclude<Open, null>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => (v === k ? null : k));
  };
  const on = (href: string) => (path === href || path?.startsWith(`${href}/`) ? "page" : undefined);

  return (
    <header className="nav">
      <div className="container nav-in">
        <Brand />
        <nav className="nav-links" aria-label="주요 메뉴">
          <button type="button" className={open === "mega" ? "open" : undefined} aria-expanded={open === "mega"} onClick={toggle("mega")}>
            업종별 ▾
          </button>
          <Link href="/features" aria-current={on("/features")}>기능</Link>
          <Link href="/pricing" aria-current={on("/pricing")}>요금</Link>
          <span className="lp8-sh-dropwrap">
            <button type="button" className={open === "tools" ? "open" : undefined} aria-expanded={open === "tools"} onClick={toggle("tools")}>
              무료 계산기 ▾
            </button>
            {open === "tools" && (
              <div className="lp8-sh-drop" onClick={(e) => e.stopPropagation()}>
                {TOOLS.map((t) => (
                  <Link key={t.slug} href={`/tools/${t.slug}`}>
                    <b>{t.name}</b>
                    <span>{t.desc}</span>
                  </Link>
                ))}
                <Link className="lp8-sh-drop-all" href="/tools">계산기 전체 보기</Link>
              </div>
            )}
          </span>
          <Link href="/blog" aria-current={on("/blog")}>블로그</Link>
          <Link href="/tax-partners" aria-current={on("/tax-partners")}>세무사 제휴</Link>
        </nav>
        <div className="nav-cta">
          <Link className="btn btn-sm btn-line lp8-sh-login" href="/auth">로그인</Link>
          <Link className="btn btn-sm btn-fill" href={SIGNUP_HREF} data-cta="signup:nav">무료 체험하기</Link>
          <button
            type="button"
            className="lp8-sh-burger"
            aria-label={open === "drawer" ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={open === "drawer"}
            onClick={toggle("drawer")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              {open === "drawer" ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* 업종별 메가메뉴 — 세부 업종마다 업종 활용 페이지로(content.ts MEGA, 2026-09-16) */}
      <div className={`mega${open === "mega" ? " is-open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="container">
          <div className="mega-in">
            {MEGA.map(([group, items]) => (
              <div key={group}>
                <h6>{group}</h6>
                {items.map(([t, href]) => <Link key={t} href={href}>{t}</Link>)}
              </div>
            ))}
          </div>
          <div className="mega-foot">업종이 달라도 일하는 순서는 비슷합니다. 필요 없는 메뉴는 감출 수 있습니다. <Link href="/industries">업종별 활용법 전체 보기 →</Link></div>
        </div>
      </div>

      {/* 좁은 화면 — 옛 머리에는 햄버거가 있었고 v8 머리에는 없어 폰에서 요금·계산기로 갈 길이 없었다 */}
      {open === "drawer" && (
        <div className="lp8-sh-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="container">
            {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
            <Link href="/tools">무료 계산기</Link>
            <Link href={CONSULT_HREF} data-cta="consult:nav_drawer">도입 상담</Link>
            <Link href="/auth">로그인</Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="container">
        <div className="lp8-sh-footnav">
          <div>
            <h6>제품</h6>
            <Link href="/features">기능</Link>
            <Link href="/pricing">요금</Link>
            <Link href={CONSULT_HREF} data-cta="consult:footer">도입 상담</Link>
            <Link href="/tax-partners">세무사 제휴</Link>
          </div>
          <div>
            <h6>무료 계산기</h6>
            {TOOLS.map((t) => <Link key={t.slug} href={`/tools/${t.slug}`}>{t.name}</Link>)}
          </div>
          <div>
            <h6>자료</h6>
            <Link href="/blog">블로그</Link>
            <Link href="/guide">사용 가이드</Link>
            <Link href="/status">서비스 상태</Link>
            <Link href="/security">보안</Link>
          </div>
        </div>
        <div className="foot-row">
          <div>
            {FOOTER.company}<br />
            {FOOTER.addr} · {FOOTER.email}
          </div>
          <div className="lp8-foot-links">
            {FOOTER.links.filter((l) => l.href !== "/security" && l.href !== "/status").map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </div>
        </div>
      </div>
    </footer>
  );
}
