"use client";
// 떠서 열리는 칸(검색조건 패널·달력·고르기 목록·열 거르기·메뉴…)이 화면 밖으로 잘리지 않게 — 앱 전체에 한 번만 둔다.
//   각 부품은 버튼 아래 '고정 자리'에 열린다(예: .qk-panel 은 버튼 왼쪽 끝부터 600px). 작은 창(사이드바·탭 옆
//   '작은 화면으로 열기', 노트북)에서는 오른쪽·아래가 화면 밖으로 나가 잘렸다(세금·증빙 검색조건, 2026-10-13).
//   부품마다 고치면 새 부품이 생길 때마다 같은 일이 되풀이되므로, 새로 나타나는 '떠 있는 칸'을 모두 재서 화면 안으로 민다.
//
//   대상: position absolute/fixed + z-index 10 이상 + 화면을 거의 다 덮는 오버레이가 아닌 것.
//   방법: translate(개별 속성 — 부품이 쓰는 transform 과 겹치지 않는다)로 밀고, 그래도 높이가 넘치면 max-height + 안쪽 스크롤.
//         잘라 먹는 조상(overflow 가 visible 이 아닌 상자)이 있으면 그 상자 안을 기준으로, 너무 좁으면 화면 기준.
//   앱 전체가 CSS zoom(.app-zoom) 안에 있어 화면 px 와 CSS px 가 다르다 — 요소마다 실제 배율(화면 폭 ÷ CSS 폭)로 나눠 적는다.
//   빼고 싶은 칸은 data-no-fit 을 단다.
import { useEffect } from "react";

const MARGIN = 8;
const FITTED = "data-fit-applied";
//   맞춘 뒤의 크기 — ResizeObserver 가 우리가 바꾼 크기에 다시 반응해 맞추기를 되풀이하지 않게
const lastSize = new WeakMap<HTMLElement, { w: number; h: number }>();

function clipBounds(el: HTMLElement) {
  let left = MARGIN, top = MARGIN, right = window.innerWidth - MARGIN, bottom = window.innerHeight - MARGIN;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    const clips = /(hidden|auto|scroll|clip)/.test(cs.overflowX + " " + cs.overflowY);
    if (!clips) continue;
    const r = a.getBoundingClientRect();
    left = Math.max(left, r.left + MARGIN); top = Math.max(top, r.top + MARGIN);
    right = Math.min(right, r.right - MARGIN); bottom = Math.min(bottom, r.bottom - MARGIN);
  }
  //   잘라 먹는 상자가 너무 작으면(표 안의 작은 칸 등) 그 안에 욱여넣지 않고 화면 기준으로 — 최소한 화면 안에는 보인다
  if (right - left < 240 || bottom - top < 160) {
    return { left: MARGIN, top: MARGIN, right: window.innerWidth - MARGIN, bottom: window.innerHeight - MARGIN };
  }
  return { left, top, right, bottom };
}

function isFloating(el: HTMLElement): boolean {
  if (el.hasAttribute("data-no-fit")) return false;
  const cs = getComputedStyle(el);
  if (cs.position !== "absolute" && cs.position !== "fixed") return false;
  const z = parseInt(cs.zIndex, 10);
  if (!Number.isFinite(z) || z < 10) return false;
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 24) return false;   // 배지·점·숨김 글자
  //   화면을 거의 덮는 오버레이(모달 배경·서랍)는 이미 화면에 맞춰져 있다
  if (r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.9) return false;
  return true;
}

function fit(el: HTMLElement) {
  if (!el.isConnected) return;
  //   전에 민 값을 지우고 원래 자리에서 다시 잰다
  el.style.translate = "";
  if (el.getAttribute(FITTED) === "h") { el.style.maxHeight = ""; el.style.overflowY = ""; }
  if (el.getAttribute(FITTED) === "w" || el.getAttribute(FITTED) === "wh") { el.style.maxWidth = ""; el.style.maxHeight = ""; el.style.overflowY = ""; }
  el.removeAttribute(FITTED);
  const r = el.getBoundingClientRect();
  const b = clipBounds(el);
  const scale = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;   // CSS zoom 배율
  let dx = 0, dy = 0; const marks: string[] = [];
  // 가로 — 넓으면 줄이고, 넘치면 민다
  const maxW = b.right - b.left;
  if (r.width > maxW) { el.style.maxWidth = `${Math.floor(maxW / scale)}px`; marks.push("w"); }
  const w = Math.min(r.width, maxW);
  if (r.left + w > b.right) dx = b.right - (r.left + w);
  if (r.left + dx < b.left) dx = b.left - r.left;
  // 세로 — 아래로 넘치면 먼저 위로 밀어 보고(시작점이 위 경계를 넘지 않게), 그래도 길면 높이를 줄이고 안쪽 스크롤
  const maxH = b.bottom - b.top;
  if (r.bottom > b.bottom) dy = Math.max(b.bottom - r.bottom, b.top - r.top);
  if (r.height > maxH) { el.style.maxHeight = `${Math.floor(maxH / scale)}px`; el.style.overflowY = "auto"; marks.push("h"); }
  if (dx || dy) el.style.translate = `${Math.round(dx / scale)}px ${Math.round(dy / scale)}px`;
  if (dx || dy || marks.length) el.setAttribute(FITTED, marks.join("") || "t");
  const after = el.getBoundingClientRect();
  lastSize.set(el, { w: after.width, h: after.height });
}

export function PopoverFit() {
  useEffect(() => {
    const watched = new Set<HTMLElement>();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const r = el.getBoundingClientRect(), prev = lastSize.get(el);
        if (prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1) continue;   // 우리가 바꾼 크기
        fit(el);
      }
    });
    const consider = (el: HTMLElement) => {
      if (watched.has(el) || !isFloating(el)) return;
      watched.add(el);
      ro.observe(el);
      fit(el);
    };
    //   열릴 때 붙는 칸은 대개 그 덩어리의 맨 위다({open && <div className="…panel">}) — 맨 위와 바로 아래만 본다
    //   (표 한 쪽을 다시 그릴 때마다 수백 칸의 스타일을 재지 않게)
    const scan = (root: Element, deep: boolean) => {
      if (root instanceof HTMLElement) consider(root);
      if (deep) root.querySelectorAll<HTMLElement>(":scope > *").forEach(consider);
    };
    //   그리고 나서 같은 프레임에 레이아웃이 끝나도록 한 박자 뒤에 잰다
    const added = new Set<Element>(), toggled = new Set<Element>();
    let raf = 0;
    const flush = () => {
      raf = 0;
      for (const n of added) if (n.isConnected) scan(n, true);
      for (const n of toggled) if (n.isConnected) scan(n, false);
      added.clear(); toggled.clear();
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) added.add(n as Element); });
        //   이미 붙어 있던 칸이 class·hidden 으로 열리는 부품도 있다 — 그 칸만 본다
        if (m.type === "attributes" && m.target.nodeType === 1) toggled.add(m.target as Element);
      }
      if ((added.size || toggled.size) && !raf) raf = requestAnimationFrame(flush);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "open", "hidden"] });
    const onResize = () => { for (const el of watched) { if (!el.isConnected) { watched.delete(el); ro.unobserve(el); } else fit(el); } };
    window.addEventListener("resize", onResize);
    //   떨어진 요소 정리 — 감시 목록이 쌓이지 않게
    const gc = window.setInterval(() => { for (const el of watched) if (!el.isConnected) { watched.delete(el); ro.unobserve(el); } }, 10_000);
    return () => { mo.disconnect(); ro.disconnect(); window.removeEventListener("resize", onResize); window.clearInterval(gc); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
