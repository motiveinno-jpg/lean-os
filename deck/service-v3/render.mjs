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

// ⚠️ PDF 는 쪽 이미지로 만든다 (2026-09-14 사장님 맥 미리보기에서 발견):
//   HTML 을 그대로 page.pdf() 로 뽑으면 큰 흐림 그림자(box-shadow)·반투명 그라데이션·글자 그라데이션이 PDF 벡터로 옮겨지는데,
//   macOS 미리보기는 이 그림자를 부드럽게 못 그리고 회색 네모 판으로 찍는다(윈도우·크롬에서는 안 보임).
//   → 2배 해상도 JPEG 를 쪽마다 한 장씩 깔아 어느 PDF 뷰어에서나 화면과 똑같이 보이게 한다. 링크는 같은 자리에 투명 <a> 로 다시 얹는다.
//   버린 안: 그림자만 print 에서 끄기 — 다른 효과(background-clip:text, filter)도 뷰어마다 다르게 그려질 수 있어 근본 해결이 아님.
const html = `<!doctype html><html><head><style>@page{ size:1920px 1080px; margin:0 } *{ margin:0; padding:0 } .pg{ position:relative; width:1920px; height:1080px; page-break-after:always; overflow:hidden } .pg img{ display:block; width:1920px; height:1080px } .pg a{ position:absolute; display:block }</style></head><body>${
  pages.map((p) => `<div class="pg"><img src="data:image/jpeg;base64,${p.jpg}">${p.links.map((l) => `<a href="${l.href}" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px"></a>`).join("")}</div>`).join("")
}</body></html>`;
const pp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await pp.setContent(html, { waitUntil: "load" });
await save(path.join(out, "오너뷰_서비스소개서_v3.pdf"), await pp.pdf({ width: "1920px", height: "1080px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
await browser.close();

// 움직이는 버전 — 브라우저로 여는 HTML 을 결과 폴더에 같이 둔다. 크롬으로 열고 F = 발표 모드 (3판부터 이미지 파일 없음 — HTML 한 장)
const web = path.join(out, "웹_애니메이션판");
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
fs.copyFileSync(path.join(here, "slides.html"), path.join(web, "오너뷰_서비스소개서_v3.html"));
console.log(`✓ ${slides.length}쪽 → ${out}`);
