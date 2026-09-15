// 서비스 소개서 v3 — slides.html 을 PNG(쪽마다)·PDF 로 뽑는다 (2026-09-14)
//   사용: node deck/service-v3/render.mjs
//   결과: deliverables/service-deck-v3/ (git 제외 폴더) — 오너뷰_서비스소개서_v3.pdf · slide-01.png …
//   글꼴(Pretendard·Inter)을 CDN 에서 받으므로 인터넷이 필요하다. 받기 전에 찍히지 않게 fonts.ready 를 기다린다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const req = createRequire(import.meta.url);
const { chromium } = req("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(root, "deliverables", "service-deck-v3");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// 2배 해상도로 찍는다 — PDF 는 이 이미지로 만든다(아래 설명)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, "slides.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// 디자인 2판(2026-09-14): 애니메이션을 끄고(still) 모든 쪽을 등장 끝 상태(on)로 — PDF 에는 움직임이 담기지 않는다
await page.evaluate(async () => {
  document.documentElement.classList.add("still");
  document.querySelectorAll(".slide").forEach((s) => s.classList.add("on"));
  await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
});
await page.waitForTimeout(800);

// 바탕화면 폴더는 동기화·백신이 파일을 잠깐 잡아 open 이 UNKNOWN(-4094)으로 실패할 때가 있다(2026-09-14) — 버퍼로 받아 몇 번 다시 쓴다.
async function save(file, buf) {
  for (let t = 0; ; t++) {
    try { fs.writeFileSync(file, buf); return; }
    catch (e) { if (t >= 5) throw e; await new Promise((r) => setTimeout(r, 400)); }
  }
}

const slides = await page.locator("section.slide").all();
const pages = [];
for (let i = 0; i < slides.length; i++) {
  const file = path.join(out, `slide-${String(i + 1).padStart(2, "0")}.png`);
  // 미리보기 PNG 는 1배(1920×1080) — 2배 캡처를 줄이지 않고 그대로 두면 폴더가 커져 1배로 다시 찍는다
  const jpg = await slides[i].screenshot({ type: "jpeg", quality: 90 });
  // 쪽 안 링크(QR 옆 주소·요금 상세 등) 자리 — 이미지 PDF 위에 같은 자리로 링크를 다시 얹는다
  const links = await slides[i].evaluate((el) => {
    const o = el.getBoundingClientRect();
    return [...el.querySelectorAll("a[href^='http']")].map((a) => { const r = a.getBoundingClientRect(); return { href: a.href, x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; });
  });
  pages.push({ jpg: jpg.toString("base64"), links });
}
// PNG 미리보기(1배)
const p1 = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (let i = 0; i < pages.length; i++) {
  await p1.setContent(`<body style="margin:0"><img src="data:image/jpeg;base64,${pages[i].jpg}" style="display:block;width:1920px;height:1080px"></body>`);
  await save(path.join(out, `slide-${String(i + 1).padStart(2, "0")}.png`), await p1.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } }));
}

// ⚠️ PDF = 벡터 + 그림자만 이미지 (2026-09-14, 두 번의 사장님 피드백)
//   ① 처음(page.pdf 벡터 그대로): 맥 미리보기에서 큰 흐림 box-shadow(소프트 마스크)가 회색 네모 판으로 찍혔다.
//   ② 다음(쪽 전체를 2배 JPEG 로): 윈도우 뷰어에서 글자·색이 빛바랜 듯 흐려 보였다 — 픽셀 값은 같지만(ICC sRGB 확인)
//      큰 이미지를 화면 크기로 줄여 그리면서 가는 글자가 옅어진다. 글자 선택도 안 된다.
//   → 쪽 캡처 이미지를 각 쪽 "바탕"으로 깔고, 그 위의 실제 요소(글자·카드·선)는 벡터로 다시 그린다.
//     단 벡터 쪽에서는 그림자·filter 를 끈다 — 그림자는 바탕 이미지에만 남아 맥에서도 판으로 안 찍히고, 글자·색은 벡터라 선명하다.
const shots = pages.map((p) => p.jpg);
await page.evaluate((imgs) => {
  const st = document.createElement("style");
  // 1쪽 노트북 화면: 쪽 아래로 넘쳐 잘리는 요소라 크롬 PDF 가 그 안 SVG 차트를 빠뜨린다(2026-09-15 발견) → 벡터 층에서 숨기고 바탕 이미지로 보이게
  st.textContent = "*,*::before,*::after{ box-shadow:none !important; text-shadow:none !important; filter:none !important } .s1 .device{ visibility:hidden !important }";
  document.head.appendChild(st);
  // 그라데이션 글자(background-clip:text)는 PDF 벡터로 옮기면 글자 상자 테두리를 따라 가는 선(ㄱ자·세로 작대기)이 남는다
  //   (2026-09-14 사장님: 1쪽 「오너뷰」 위 ㄱ자 선, 2쪽 51 옆 작대기) → 벡터 쪽에서는 숨기고 바탕 이미지(2배)의 글자를 그대로 쓴다
  document.querySelectorAll("section.slide *").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") {
      // 쪽 바탕 위 글자는 투명(바탕 이미지의 그라데이션 글자가 보임). 흰 카드 안 글자는 카드가 바탕 이미지를 가리므로 인디고 단색으로(16쪽 유료 요금이 사라졌던 문제)
      let onCard = false;
      for (let a = el.parentElement; a && !a.classList.contains("slide"); a = a.parentElement) { const bg = getComputedStyle(a).backgroundColor; if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { onCard = true; break; } }
      const fill = onCard ? "#4f46e5" : "transparent";
      [el, ...el.querySelectorAll("*")].forEach((n) => { n.style.setProperty("background", "none", "important"); n.style.setProperty("-webkit-text-fill-color", fill, "important"); n.style.setProperty("color", fill, "important"); });
    }
  });
  // 슬라이드 CSS 에 !important 가 붙은 그림자(.s4 .pillbox 등)는 위 * 규칙보다 우선이라 살아남아
  //   맥·iOS PDF 뷰어에서 보라색 네모 판으로 찍혔다(2026-09-15 사장님 iOS 캡처). → 요소마다 인라인 !important 로 확실히 끈다.
  document.querySelectorAll("section.slide, section.slide *").forEach((n) => {
    const cs = getComputedStyle(n);
    if (cs.boxShadow !== "none") n.style.setProperty("box-shadow", "none", "important");
    if (cs.textShadow !== "none") n.style.setProperty("text-shadow", "none", "important");
    if (cs.filter !== "none") n.style.setProperty("filter", "none", "important");
    if (cs.backdropFilter && cs.backdropFilter !== "none") n.style.setProperty("backdrop-filter", "none", "important");
  });
  // 투명도 그라데이션도 소프트 마스크가 된다 — 쪽 바탕 위에 바로 놓인 장식은 벡터 층에서 숨기고(바탕 이미지로 보임),
  //   흰 카드 안 차트의 반투명 채움은 흰색과 섞은 불투명 색으로 바꾼다(모양·색은 같고 투명도만 없앰)
  document.querySelectorAll(".s6 .shadow, .s13 .gfx14").forEach((n) => n.style.setProperty("visibility", "hidden", "important"));
  document.querySelectorAll("section.slide stop").forEach((st) => {
    const cs = getComputedStyle(st); const a = parseFloat(cs.stopOpacity);
    if (!(a < 1)) return;
    const m = cs.stopColor.match(/\d+(\.\d+)?/g).map(Number); const al = a * (m.length > 3 ? m[3] : 1);
    const mix = (c) => Math.round(c * al + 255 * (1 - al));
    st.style.setProperty("stop-color", `rgb(${mix(m[0])},${mix(m[1])},${mix(m[2])})`, "important");
    st.style.setProperty("stop-opacity", "1", "important");
  });
  document.querySelectorAll("section.slide").forEach((el, i) => {
    el.style.setProperty("background", `url(data:image/jpeg;base64,${imgs[i]}) 0 0 / 1920px 1080px no-repeat`, "important");
  });
}, shots);
await page.waitForTimeout(500);
const pdfBuf = await page.pdf({ width: "1920px", height: "1080px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
// 검문: 소프트 마스크(/SMask)가 남으면 맥·iOS 에서 회색·보라 네모가 생긴다 — 개수를 찍어 0 이 아니면 알린다
const smask = (pdfBuf.toString("latin1").match(/\/SMask/g) || []).length;
console.log(`PDF 소프트 마스크 ${smask}개${smask ? " ⚠️ 맥·iOS 에서 네모가 보일 수 있음" : " (정상)"}`);
await save(path.join(out, "오너뷰_서비스소개서_v3.pdf"), pdfBuf);
await browser.close();

// 움직이는 버전 — 브라우저로 여는 HTML 을 결과 폴더에 같이 둔다. 크롬으로 열고 F = 발표 모드 (3판부터 이미지 파일 없음 — HTML 한 장)
const web = path.join(out, "웹_애니메이션판");
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
fs.copyFileSync(path.join(here, "slides.html"), path.join(web, "오너뷰_서비스소개서_v3.html"));
console.log(`✓ ${slides.length}쪽 → ${out}`);
