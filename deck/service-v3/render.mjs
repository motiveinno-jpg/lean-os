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
  st.textContent = "*,*::before,*::after{ box-shadow:none !important; text-shadow:none !important; filter:none !important }";
  document.head.appendChild(st);
  document.querySelectorAll("section.slide").forEach((el, i) => {
    el.style.setProperty("background", `url(data:image/jpeg;base64,${imgs[i]}) 0 0 / 1920px 1080px no-repeat`, "important");
  });
}, shots);
await page.waitForTimeout(500);
await save(path.join(out, "오너뷰_서비스소개서_v3.pdf"), await page.pdf({ width: "1920px", height: "1080px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
await browser.close();

// 움직이는 버전 — 브라우저로 여는 HTML 을 결과 폴더에 같이 둔다. 크롬으로 열고 F = 발표 모드 (3판부터 이미지 파일 없음 — HTML 한 장)
const web = path.join(out, "웹_애니메이션판");
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
fs.copyFileSync(path.join(here, "slides.html"), path.join(web, "오너뷰_서비스소개서_v3.html"));
console.log(`✓ ${slides.length}쪽 → ${out}`);
