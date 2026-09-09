"use client";
// ══════════════════════════════════════════════════════════════
//  오너뷰 랜딩 v8 — 오두 홈(odoo.com/ko_KR) 뼈대를 실측해 옮긴 판
//  2026-09-09 목업(landing-v11)을 그대로 운영으로. 결정 221~.
//
//  ▸ 문구·데이터는 content.ts 하나. 제품 화면 모형은 mocks.ts 하나.
//  ▸ 스타일은 app/landing-v8.css — **규칙이 전부 `.lp8` 안에 갇혀 있다**.
//    globals.css 에 .ui · .row · .frame · .step 같은 흔한 이름이 이미 있어서다.
//  ▸ 움직임: 구간이 화면에 들어오면 떠오른다(.rise → .in). 자바스크립트가 죽으면
//    `html.js` 가 안 붙어 **글이 그냥 보인다** — 빈 화면이 되지 않는다.
//  ▸ 화면 모형은 전부 가상 자료다. 실제 거래처·직원·계좌는 넣지 않는다(결정 220).
// ══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "@/app/landing-v8.css";
import { CONSULT_HREF, COMPARE, FEATS, FIGURES, FOOTER, HERO, MEGA, MENUS, TOPICS } from "./content";
import { BOARD, CHANNELS, COLLECT, CUTS, SORTDEMO, VAT, ic } from "./mocks";

/* 화면 모형은 값이 고정이라 한 번만 만든다 */
const CUT_HTML = CUTS.map((c) => c.build());
const CUT_MS = 3800;

const ICON_PAUSE = '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>';
const ICON_PLAY = '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5l7 4.5-7 4.5z"/></svg>';

/* 떠오르는 차례를 어긋나게 준다 — 목록이 한꺼번에 튀어나오지 않게 */
const stagger = (i: number, step: number) => ({ transitionDelay: `${Math.min(i * step, 420)}ms` });

export default function LandingV8() {
  const root = useRef<HTMLDivElement>(null);
  const [mega, setMega] = useState(false);
  const [cut, setCut] = useState(0);
  const [playing, setPlaying] = useState(true);
  const cutAt = useRef(0);
  const prog = useRef<HTMLElement>(null);

  const show = useCallback((i: number) => {
    setCut(i);
    cutAt.current = performance.now();
  }, []);

  /* ── 업종별 메뉴 — 바깥을 누르거나 Esc 로 닫는다 ── */
  useEffect(() => {
    if (!mega) return;
    const off = () => setMega(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMega(false); };
    document.addEventListener("click", off);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", off); window.removeEventListener("keydown", key); };
  }, [mega]);

  /* ── 화면 모형 축소기 — 상자 너비에 맞춰 통째로 줄인다 ──
       칸을 좁히면 표가 넘치므로, 원래 너비(--dw)로 그린 뒤 배율만 준다. */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      el.querySelectorAll<HTMLElement>(".scaler").forEach((box) => {
        const inner = box.querySelector<HTMLElement>(".scaler-in");
        if (!inner || !box.clientWidth) return;
        const dw = parseFloat(getComputedStyle(box).getPropertyValue("--dw")) || 620;
        const s = box.clientWidth / dw;
        inner.style.transform = `scale(${s})`;
        box.style.height = `${Math.round(inner.offsetHeight * s)}px`;
      });
    };
    fit();
    window.addEventListener("load", fit);
    document.fonts?.ready.then(fit).catch(() => {});
    const ro = new ResizeObserver(fit);
    el.querySelectorAll(".scaler").forEach((b) => ro.observe(b));
    return () => { window.removeEventListener("load", fit); ro.disconnect(); };
  }, []);

  /* ── 장면 넘기기 ── */
  useEffect(() => {
    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    let raf = 0;
    cutAt.current = performance.now();
    const tick = (now: number) => {
      if (playing) {
        const p = (now - cutAt.current) / CUT_MS;
        if (prog.current) prog.current.style.width = `${Math.min(p, 1) * 100}%`;
        if (p >= 1) { cutAt.current = now; setCut((v) => (v + 1) % CUTS.length); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* ── 떠오르기 + 숫자 세기 ── */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rise = [...el.querySelectorAll<HTMLElement>(".rise")];
    const motion = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (!motion || !("IntersectionObserver" in window)) {
      rise.forEach((n) => n.classList.add("in"));
      return;
    }

    const counted = new WeakSet<Element>();
    const countUp = (n: HTMLElement | null) => {
      if (!n) return;
      const raw = n.textContent || "";
      const m = raw.match(/[\d,]+/);
      if (!m || m.index === undefined) return;
      const target = parseInt(m[0].replace(/,/g, ""), 10);
      if (!target) return;
      const pre = raw.slice(0, m.index), post = raw.slice(m.index + m[0].length);
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min((now - t0) / 900, 1);
        n.textContent = pre + Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString("ko-KR") + post;
        if (k < 1) requestAnimationFrame(step);
      };
      n.textContent = `${pre}0${post}`;
      requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const t = e.target as HTMLElement;
        t.classList.add("in");
        io.unobserve(t);
        if (t.classList.contains("figure") && !counted.has(t)) { counted.add(t); countUp(t.querySelector("b")); }
        if (t.classList.contains("human")) t.querySelector(".no")?.classList.add("stamp-in");
      }),
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    rise.forEach((n) => io.observe(n));

    /* 안전망 — 빨리 훑고 내려가면 관찰이 못 따라온다. 지나간 것은 무조건 띄운다 */
    const sweep = () => {
      const vh = window.innerHeight;
      for (const n of rise) {
        if (n.classList.contains("in")) continue;
        if (n.getBoundingClientRect().top < vh * 0.94) { n.classList.add("in"); io.unobserve(n); }
      }
    };
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep);
    sweep();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", sweep);
      window.removeEventListener("resize", sweep);
    };
  }, []);

  /* ── AI 분류 장면 — 화면에 들어와 있는 동안만 돌린다 ── */
  useEffect(() => {
    const wrap = root.current?.querySelector<HTMLElement>("[data-sortdemo]");
    if (!wrap) return;
    const rows = [...wrap.querySelectorAll<HTMLElement>(".sd-row")];
    const bar = wrap.querySelector<HTMLElement>("[data-sd-bar]");
    const live = root.current?.querySelector<HTMLElement>("[data-sd-live] em");
    if (!rows.length || !bar) return;

    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      rows.forEach((r) => r.classList.add("done"));
      bar.classList.add("ready");
      if (live) live.textContent = "계정과목 자동 분류";
      return;
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    let running = false;
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const wait = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    const run = () => {
      clear();
      rows.forEach((r) => r.classList.remove("done", "scan"));
      bar.classList.remove("ready");
      if (live) live.textContent = "AI가 분류하는 중";
      let i = 0;
      const step = () => {
        if (i > 0) rows[i - 1].classList.remove("scan");
        if (i >= rows.length) {
          bar.classList.add("ready");
          if (live) live.textContent = "확인만 하시면 됩니다";
          wait(run, 3400);
          return;
        }
        rows[i].classList.add("scan");
        const n = i;
        wait(() => rows[n].classList.add("done"), 170);
        i += 1;
        wait(step, 300);
      };
      step();
    };

    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (e.isIntersecting && !running) { running = true; run(); }
        else if (!e.isIntersecting && running) { running = false; clear(); }
      }),
      { threshold: 0.25 },
    );
    io.observe(wrap);
    return () => { io.disconnect(); clear(); };
  }, []);

  const html = (s: string) => ({ __html: s });

  return (
    <div className="lp8" ref={root}>
      {/* 자바스크립트가 살아 있을 때만 글을 숨겼다가 띄운다 */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={html('document.documentElement.classList.add("js")')} />

      {/* ══ 머리 + 업종별 메가메뉴 ══ */}
      <header className="nav">
        <div className="container nav-in">
          <Link className="brand" href="/">
            <i>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />
              </svg>
            </i>
            오너뷰
          </Link>
          <nav className="nav-links">
            <button
              type="button"
              className={mega ? "open" : undefined}
              aria-expanded={mega}
              onClick={(e) => { e.stopPropagation(); setMega((v) => !v); }}
            >
              업종별 ▾
            </button>
            <a href="#menus">메뉴</a>
            <a href="#flow">일하는 방식</a>
            <a href="#ai">AI 자동입력</a>
            <a href="#figures">요금</a>
          </nav>
          <div className="nav-cta">
            <Link className="btn btn-sm btn-line" href="/auth">로그인</Link>
            <Link className="btn btn-sm btn-fill" href="/auth">무료 체험하기</Link>
          </div>
        </div>
        <div className={`mega${mega ? " is-open" : ""}`} onClick={(e) => e.stopPropagation()}>
          <div className="container">
            <div className="mega-in">
              {MEGA.map(([group, items]) => (
                <div key={group}>
                  <h6>{group}</h6>
                  {items.map((t) => <Link key={t} href="/features">{t}</Link>)}
                </div>
              ))}
            </div>
            <div className="mega-foot">업종이 달라도 일하는 순서는 비슷합니다. 필요 없는 메뉴는 감출 수 있습니다.</div>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ══ §0 히어로 ══ */}
        <section className="hero">
          <div className="container">
            <h1>{HERO.h1a}<br />{HERO.h1b}</h1>
            <p className="lead24">{HERO.lead}</p>
            <div className="hero-cta">
              <Link className="btn btn-fill" href="/auth">{HERO.ctaPrimary}</Link>
              <a className="btn btn-soft" href={CONSULT_HREF}>{HERO.ctaSecondary}</a>
            </div>
          </div>
        </section>

        {/* ══ §1 메뉴 벽 — 32개(8×4) ══ */}
        <section id="menus" className="sec-200 pt64 pb64">
          <div className="container">
            <div className="wall">
              {MENUS.map(([name, icon], i) => (
                <button key={name + i} type="button" title={name} className="rise" style={stagger(i, 22)}>
                  {/* eslint-disable-next-line react/no-danger */}
                  <span className="ic" dangerouslySetInnerHTML={html(ic(icon))} />
                  <span className="nm">{name}</span>
                </button>
              ))}
            </div>
            <div className="wall-note rise">
              <span>이 메뉴들이 모두 같은 자료를 씁니다!</span>
              <a className="btn btn-sm btn-line" href="#feats">전체 메뉴 보기</a>
            </div>
          </div>
        </section>

        {/* ══ §2 문제 제기 ══ */}
        <section className="sec-200 pt0 pb64">
          <div className="container problem">
            <p className="big rise" style={stagger(0, 70)}>
              프로그램이 달라질 때마다 업무가 끊기고 있지 않으십니까?<br />
              오너뷰는 회계부터 인사까지 한 체계로 관리합니다!
            </p>
            <p className="p20 sub rise lp8-strong" style={stagger(1, 70)}>업무 전 과정을 하나로 다루는 AI ERP</p>
            <p className="p20 sub rise" style={stagger(2, 70)}>
              회계 프로그램, 근태관리, 재고관리, 전자결재, 그룹웨어.<br className="brk" />
              따로 쓰시던 기능을 한 순서로 정리합니다.
            </p>
          </div>
        </section>

        {/* ══ §4 한 번 입력하면 끝까지 따라갑니다 — 장면 넘기기 ══ */}
        <section id="flow" className="sec-200 pt64 pb96">
          <div className="container">
            <h2 className="rise lp8-center">한 번 입력하면 <em className="hl">끝까지 따라갑니다</em></h2>
            <p className="lead24 rise lp8-lead-mid">
              입금 내역이 전표로, 전표가 신고서로.<br className="brk" />
              앞 단계를 끝내면 다음 칸이 저절로 채워집니다.
            </p>
            <div className="vwrap rise">
              <div className="thumb">
                <div
                  className="videobox"
                  onMouseEnter={() => setPlaying(false)}
                  onMouseLeave={() => setPlaying(true)}
                >
                  {CUT_HTML.map((markup, i) => (
                    <div key={i} className={`cut${i === cut ? " on" : ""}`}>
                      <div className="scaler lp8-cut-scaler">
                        {/* eslint-disable-next-line react/no-danger */}
                        <div className="scaler-in" dangerouslySetInnerHTML={html(markup)} />
                      </div>
                    </div>
                  ))}
                  <div className="vbar">
                    <button
                      type="button"
                      aria-label={playing ? "멈춤" : "재생"}
                      onClick={() => { cutAt.current = performance.now(); setPlaying((v) => !v); }}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={html(playing ? ICON_PAUSE : ICON_PLAY)}
                    />
                    <span className="track"><i ref={prog} /></span>
                    <span className="cap">{CUTS[cut].cap}</span>
                  </div>
                </div>
              </div>
              <div className="vcuts">
                {CUTS.map((c, i) => (
                  <button
                    key={c.cap}
                    type="button"
                    aria-current={i === cut}
                    className="rise"
                    style={stagger(i, 60)}
                    onClick={() => show(i)}
                  >
                    <b>{String(i + 1).padStart(2, "0")}</b>{c.cap}
                  </button>
                ))}
              </div>
              <p className="vcaption">가상 회사 자료로 만든 시연 화면입니다</p>
            </div>
          </div>
        </section>

        {/* ══ §5 체계화된 흐름으로 업무능력 향상 — 겹친 화면 조각 ══ */}
        <section className="sec-200 pt96 pb96">
          <div className="container">
            <h2 className="rise lp8-center">체계화된 흐름으로 <em className="hl">업무능력 향상</em></h2>
            <p className="lead24 rise lp8-lead-mid lp8-lead-tight">
              수집·전표, 매출 현황판, 부가세 신고서, 이커머스.<br className="brk" />
              열어 보면 필요한 숫자가 이미 들어와 있습니다.
            </p>
            <div className="collage">
              {([
                ["cg1", "app.owner-view.com/collect", "수집·전표", 820, COLLECT()],
                ["cg2", "/reports/revenue", "", 740, BOARD()],
                ["cg3", "/tax/vat", "", 420, VAT()],
                ["cg5", "/inventory/channels", "", 640, CHANNELS()],
              ] as [string, string, string, number, string][]).map(([cls, url, live, dw, markup], i) => (
                <div key={cls} className={`cg ${cls} rise`} style={stagger(i, 90)}>
                  <div className="thumb"><div className="frame">
                    <div className="frame-bar">
                      <b /><b /><b /><span className="url">{url}</span>
                      {live && <span className="live"><i />{live}</span>}
                    </div>
                    <div className="scaler" style={{ "--dw": String(dw) } as React.CSSProperties}>
                      {/* eslint-disable-next-line react/no-danger */}
                      <div className="scaler-in" dangerouslySetInnerHTML={html(markup)} />
                    </div>
                  </div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ §6 매일 쌓이는 자료, AI가 먼저 정리합니다 ══ */}
        <section id="ai" className="pt96 pb48">
          <div className="container">
            <div className="mid-narrow">
              <h2 className="rise lp8-h2-gap">매일 쌓이는 자료,<br />AI가 <em className="hl">먼저 정리</em>합니다</h2>
              <p className="p20 rise">
                통장 수집부터 계정과목 분류, 증빙 대조까지.<br className="brk" />
                한 번만 연결하면 거래 내역이 매일 들어옵니다.<br className="brk" />
                다음 단계에 쓸 자료까지 갖춰집니다. 확정 버튼만 누르시면 됩니다.
              </p>
            </div>

            <div className="sortwrap thumb rise">
              <div className="frame">
                <div className="frame-bar">
                  <b /><b /><b /><span className="url">app.owner-view.com/collect</span>
                  <span className="live" data-sd-live><i /><em className="lp8-plain">AI가 분류하는 중</em></span>
                </div>
                <div className="scaler lp8-sort-scaler" data-sortdemo>
                  {/* eslint-disable-next-line react/no-danger */}
                  <div className="scaler-in" dangerouslySetInnerHTML={html(SORTDEMO())} />
                </div>
              </div>
            </div>

            <div className="flowbar rise">
              <div className="side">
                <b>받아오는 자료</b>
                <div className="chips">
                  {["통장 · 카드 승인", "홈택스 세금계산서", "현금영수증", "스마트스토어 · 쿠팡 주문", "근태 기록", "전자계약"]
                    .map((t) => <span key={t}>{t}</span>)}
                </div>
              </div>
              <div className="mid" aria-hidden="true">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 20h26M24 12l8 8-8 8" />
                </svg>
                <span>AI 자동 분류</span>
              </div>
              <div className="side out">
                <b>만들어지는 자료</b>
                <div className="chips">
                  {["전표 · 장부", "매출 KPI · 손익", "부가세 · 원천세 신고서", "급여 · 명세서"]
                    .map((t) => <span key={t}>{t}</span>)}
                </div>
              </div>
            </div>

            <div className="steps">
              {([
                ["1", "불러오기", <>통장, 카드, 홈택스, 판매채널을 한 번만 연결하세요.<br className="brk" />매일 새 거래가 들어옵니다. 엑셀 업로드도 지원합니다.</>, false],
                ["2", "채우기", <>AI가 계정과목을 분류하고 증빙과 대조합니다.<br className="brk" />분류 근거를 항목마다 표시해 확인이 빠릅니다.</>, false],
                ["3", "확인", <>확인 버튼을 누르면 전표가 생성됩니다.<br className="brk" />발송이나 이체는 저절로 실행되지 않으니 안심하세요.</>, true],
              ] as [string, string, React.ReactNode, boolean][]).map(([no, h, body, human], i) => (
                <div key={no} className={`step rise${human ? " human" : ""}`} style={stagger(i, 90)}>
                  <span className="no">{no}</span>
                  <h4>{h}</h4>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ §7 대표 기능 아홉 가지 ══ */}
        <section id="feats" className="sec-200 pt96 pb96">
          <div className="container">
            <h2 className="rise">오너뷰 ERP<br /><em className="hl">대표 기능 아홉 가지</em></h2>
            <p className="p20 rise lp8-sub-narrow">
              도입 문의로 가장 많이 받는 기능입니다.<br className="brk" />
              어느 메뉴에서 쓰는지 함께 적어 두었으니 바로 찾아보세요.
            </p>
            <div className="feat-grid">
              {FEATS.map(([icon, title, desc, where], i) => (
                <div key={title} className="feat rise" style={stagger(i, 45)}>
                  {/* eslint-disable-next-line react/no-danger */}
                  <h5><span dangerouslySetInnerHTML={html(ic(icon, 19))} />{title}</h5>
                  <p>{desc}</p>
                  <span className="where">{where}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ §8 기존 ERP와 다른 점 ══ */}
        <section id="why" className="pt96 pb96">
          <div className="container">
            <h2 className="rise">기존 ERP와 <em className="hl">다른 점</em></h2>
            <p className="p20 rise lp8-sub-wide">
              기능이 많은 것과 업무가 실제로 처리되는 것은 다릅니다.<br className="brk" />
              도입 전에 꼭 확인해 보세요.
            </p>
            <div className="cmp">
              <div className="cmp-head"><span>항목</span><span>흔한 ERP</span><span className="us">오너뷰</span></div>
              {COMPARE.map(([k, a, b], i) => (
                <div key={k} className="cmp-row rise" style={stagger(i, 55)}>
                  <span className="k">{k}</span>
                  <span className="a">{a}</span>
                  {/* eslint-disable-next-line react/no-danger */}
                  <span className="b" dangerouslySetInnerHTML={html(b)} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ §9 숫자 ══ */}
        <section id="figures" className="sec-100 pt96 pb96">
          <div className="container figures">
            {FIGURES.map(([v, label], i) => (
              <div key={label} className="figure rise" style={stagger(i, 80)}>
                <b>{v}</b><span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ══ §11 마지막 ══ */}
        <section id="finale" className="finale">
          <div className="container">
            <h3 className="cta-h rise" style={stagger(0, 80)}>흩어진 업무,<br />오늘부터 한 체계로 관리하세요!</h3>
            <div className="lp8-finale-cta rise" style={stagger(1, 80)}>
              <Link className="btn btn-fill" href="/auth">지금 무료로 시작하세요</Link>
              <a className="btn btn-soft" href={CONSULT_HREF}>전문 상담 예약</a>
            </div>
          </div>
        </section>

        {/* ══ 관련 검색어 ══ */}
        <section className="sec-100 pt96 pb96" id="topics">
          <div className="container">
            <h4 className="lp8-topics-h">오너뷰로 대신할 수 있는 것</h4>
            <p className="lp8-topics-p">오너뷰 한 곳에서 처리하는 일들입니다.</p>
            <div className="topics">
              {TOPICS.map((t, i) => <span key={t + i} className="rise" style={stagger(i, 12)}>{t}</span>)}
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="container foot-row">
            <div>
              {FOOTER.company}<br />
              {FOOTER.addr} · {FOOTER.email}
            </div>
            <div className="lp8-foot-links">
              {FOOTER.links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
