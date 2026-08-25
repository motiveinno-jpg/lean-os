// 소개서 HTML → PDF (19장, 1280×720). 이미지는 ../../public/product 를 그대로 참조한다.
//   실행: node deliverables/deck/render.mjs   (결과: deliverables/deck/오너뷰_소개서.pdf)
//   ⚠️ 이미지를 새로 찍으면 public/product 에 넣고 index.html 의 파일명만 고치면 된다.
import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage();
await p.goto(`file://${resolve(DIR, "index.html")}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

const n = await p.locator(".slide").count();
const broken = await p.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")));
const over = await p.evaluate(() => Array.from(document.querySelectorAll(".slide"))
  .map((s, i) => ({ i: i + 1, over: s.scrollHeight - s.clientHeight })).filter((x) => x.over > 4));
console.log(`슬라이드 ${n}장 · 깨진 이미지 ${broken.length ? broken.join(", ") : "없음"} · 넘침 ${over.length ? over.map((o) => `${o.i}장`).join(",") : "없음"}`);
if (broken.length || over.length) { console.error("‼ 먼저 고치고 다시 돌리세요"); }

await p.pdf({ path: resolve(DIR, "오너뷰_소개서.pdf"), width: "1280px", height: "720px", printBackground: true });
await b.close();
console.log("PDF 저장 완료");
