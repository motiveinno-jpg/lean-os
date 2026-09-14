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
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
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
for (let i = 0; i < slides.length; i++) {
  const file = path.join(out, `slide-${String(i + 1).padStart(2, "0")}.png`);
  await save(file, await slides[i].screenshot());
}
await save(path.join(out, "오너뷰_서비스소개서_v3.pdf"), await page.pdf({ width: "1920px", height: "1080px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
await browser.close();

// 움직이는 버전 — 브라우저로 여는 HTML 을 결과 폴더에 같이 둔다. 크롬으로 열고 F = 발표 모드 (3판부터 이미지 파일 없음 — HTML 한 장)
const web = path.join(out, "웹_애니메이션판");
fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
fs.copyFileSync(path.join(here, "slides.html"), path.join(web, "오너뷰_서비스소개서_v3.html"));
console.log(`✓ ${slides.length}쪽 → ${out}`);
