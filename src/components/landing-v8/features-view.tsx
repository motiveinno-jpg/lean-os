"use client";
// ══════════════════════════════════════════════════════════════
//  /features — 기능 둘러보기 (랜딩 v8 이관 3단계, 2026-09-14)
//
//  ▸ 메뉴 목록 = catalog.ts(앱 사이드바 그대로, 결정 228). 옛 화면은 08-20 사이드바 이름이라 없는 메뉴를 광고했다.
//  ▸ 한 번에 한 그룹. 주소 ?g=그룹&m=메뉴key(옛 숫자 m 도 받는다). 서버가 searchParams 로 그리므로
//    첫 렌더부터 주소의 그룹·메뉴를 쓴다(16ef9cec — 전에는 서버 HTML 에 메뉴가 0개였다).
//  ▸ 넓은 화면 = 왼쪽 메뉴 목록 + 오른쪽 화면. 좁은 화면 = 메뉴마다 카드(설명 + 화면). 둘 다 HTML 에 있다.
//    옛 폰 스와이프 덱은 버렸다 — 화면 폭을 JS 로 재야 해서 서버 HTML 과 첫 화면이 달라진다.
//  ▸ 캡처가 없는 메뉴(src null)는 화면 자리를 비워 두지 않고 "화면 준비 중" 판 + 설명만.
//  ▸ 스타일은 landing-v8.css `.lp8 .fv8-*`.
// ══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "@/app/landing-v8.css";
import { SiteFooter, SiteHeader } from "./site-shell";
import { CATALOG, menuHref, pickMenu, type Menu } from "./catalog";
import { CONSULT_HREF } from "./content";
import { MenuGlyph } from "./menu-glyph";

const Check = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function Shot({ m, sizes }: { m: Menu; sizes: string }) {
  if (!m.src) {
    return (
      <div className="fv8-noshot">
        <MenuGlyph n={m.icon} />
        <b>{m.name}</b>
        <span>화면 준비 중입니다</span>
      </div>
    );
  }
  return <Image src={m.src} alt={`오너뷰 ${m.name} 화면`} width={1968} height={1320} sizes={sizes} />;
}

export default function FeaturesView() {
  const sp = useSearchParams();
  const [cat, setCat] = useState(() => pickMenu(sp.get("g"), sp.get("m"))[0]);
  const [menu, setMenu] = useState(() => pickMenu(sp.get("g"), sp.get("m"))[1]);

  /* 주소가 바뀌면(그룹 탭·머리 메뉴) 따라간다. /ai 는 4단계에서 정리한다 */
  useEffect(() => {
    if (sp.get("g") === "ai") { window.location.replace("/ai"); return; }
    const [g, m] = pickMenu(sp.get("g"), sp.get("m"));
    setCat(g);
    setMenu(m);
  }, [sp]);

  const group = CATALOG[cat];
  const shown = group.menus[menu];

  /* 같은 그룹 안에서 메뉴만 바꿀 때는 주소만 고친다(다시 그리지 않는다) */
  const go = (i: number) => {
    if (i === menu) return;
    setMenu(i);
    window.history.replaceState(null, "", menuHref(group.key, group.menus[i].key));
  };

  return (
    <div className="lp8">
      <SiteHeader />

      <main>
        <section className="fv8-hero">
          <div className="container">
            <div className="pr8-head">
              <div className="tl8-eyebrow">기능 둘러보기</div>
              <h1>{group.name}에서 할 수 있는 일</h1>
              <p className="lead24">{group.lead}</p>
            </div>

            {/* 그룹 — 링크라 검색엔진도 따라간다 */}
            <nav className="fv8-tabs" aria-label="기능 영역">
              {CATALOG.map((g, i) => (
                <Link key={g.key} href={menuHref(g.key)} scroll={false} aria-current={i === cat ? "page" : undefined}>
                  <MenuGlyph n={g.icon} />
                  <span>{g.name}</span>
                  <small>{g.menus.length}</small>
                </Link>
              ))}
            </nav>
          </div>
        </section>

        <section className="fv8-stage sec-100">
          <div className="container">
            {/* 넓은 화면 */}
            <div className="fv8-body">
              <div className="fv8-list" role="tablist" aria-label={`${group.name} 메뉴`}>
                {group.menus.map((m, i) => (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={i === menu}
                    className={i === menu ? "is-on" : undefined}
                    onClick={() => go(i)}
                    onMouseEnter={() => go(i)}
                  >
                    <span className="fv8-ico"><MenuGlyph n={m.icon} /></span>
                    <span className="fv8-txt">
                      <b>{m.name}</b>
                      <span>{m.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="fv8-view" role="tabpanel" key={`${group.key}-${shown.key}`}>
                <div className="thumb fv8-shot"><Shot m={shown} sizes="(max-width: 1320px) 60vw, 820px" /></div>
                <div className="fv8-where">{group.name} › {shown.name}</div>
                <div className="fv8-items">
                  {shown.items.map((it) => <span key={it}><Check />{it}</span>)}
                </div>
              </div>
            </div>

            {/* 좁은 화면 — 메뉴마다 카드 */}
            <div className="fv8-cards">
              {group.menus.map((m) => (
                <article key={m.key} className="fv8-card">
                  <div className="fv8-card-head">
                    <span className="fv8-ico"><MenuGlyph n={m.icon} /></span>
                    <b>{m.name}</b>
                  </div>
                  <p>{m.desc}</p>
                  <div className="fv8-items">
                    {m.items.map((it) => <span key={it}><Check />{it}</span>)}
                  </div>
                  <div className="thumb fv8-shot"><Shot m={m} sizes="96vw" /></div>
                </article>
              ))}
            </div>
            <p className="fv8-caption">화면은 가상 회사 자료로 찍었습니다.</p>
          </div>
        </section>

        <section className="finale">
          <div className="container">
            <h3 className="cta-h">메뉴 {CATALOG.reduce((n, g) => n + g.menus.length, 0)}개가<br />같은 자료를 씁니다</h3>
            <p className="pr8-finale-sub">한 번 입력한 자료가 재고·재무·업무·인사·분석 메뉴로 이어집니다. 카드 등록 없이 무료로 시작하세요.</p>
            <div className="lp8-finale-cta">
              <Link className="btn btn-fill" href="/auth">무료로 시작하기</Link>
              <Link className="btn btn-soft" href={CONSULT_HREF}>도입 상담 신청</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
