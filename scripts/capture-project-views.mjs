// 랜딩 v7 "프로젝트 보기 4종" 섹션용 실제 화면 캡처 (2026-09-07)
//   오두(odoo.com) '최적화된 프로세스로 생산성 향상' 의 겹친 캡처 모자이크를 벤치마킹한 섹션에 쓴다.
//
//   쓰는 법: node scripts/capture-project-views.mjs
//   결과   : public/product/pv-{table,kanban,calendar,gantt}-v1.png (2배 해상도)
//
//   ⚠️ 프로덕션(www.owner-view.com) 의 [시연] 프로젝트를 읽기만 한다. 데이터를 만들지 않는다.
//   ⚠️ 계정은 로컬 메모리 파일에서 읽는다 — 저장소·명령줄에 적지 않는다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.join(process.env.REPO || process.cwd(), "package.json"));
const { chromium } = req("playwright");

const BASE = process.env.BASE || "https://www.owner-view.com";
const DEAL = process.env.DEAL || "f5cce6e8-bb2b-4585-b1ca-0a9bf69e2fdd"; // [시연] 고객 용역·납품
const CRED = path.join(process.env.HOME || process.env.USERPROFILE,
  ".claude/projects/C--Users-----Desktop-motive-lean-os/memory/reference-ownerview-login.md");
const m = fs.readFileSync(CRED, "utf8").match(/`([^`]+@[^`]+)`\s*\/\s*`([^`]+)`/);
if (!m) throw new Error("로그인 정보를 메모리 파일에서 찾지 못했습니다");
const [, EMAIL, PW] = m;
const OUT = path.join(process.cwd(), "public", "product");

// 보기마다 어디를 자를지 — 겹쳐 놓는 모자이크라 조각마다 크기가 달라야 한다.
//   자르는 자리는 브라우저 안에서 실측한다(빈 여백·배경이 끼면 조각이 지저분해 보인다).
const SHOTS = [
  { name: "pv-table-v1",    view: "표" },
  { name: "pv-kanban-v1",   view: "칸반" },
  { name: "pv-calendar-v1", view: "캘린더" },
  { name: "pv-gantt-v1",    view: "간트" },
];

//   각 보기의 자를 사각형. 페이지 배경이 비치지 않게 오른쪽·아래를 내용 끝에서 끊는다.
const measure = (name) => {
  const vw = innerWidth, vh = innerHeight;
  const fit = (x, y, w, h) => ({ x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
    width: Math.round(Math.min(w, vw - Math.max(0, x))), height: Math.round(Math.min(h, vh - Math.max(0, y))) });
  if (name === "pv-table-v1") {
    const t = document.querySelector("table.pjv3-sheet").getBoundingClientRect();
    //   표는 가로로 넘치므로 감싼 상자의 오른쪽에서 끊는다 (배경 그라데이션이 끼지 않게)
    const box = document.querySelector("table.pjv3-sheet").parentElement.getBoundingClientRect();
    return fit(t.x, t.y, Math.min(t.width, box.right - t.x), 620);
  }
  if (name === "pv-kanban-v1") {
    const cols = [...document.querySelectorAll(".pjv3-kcol")].map((e) => e.getBoundingClientRect());
    const x = Math.min(...cols.map((r) => r.x)) - 10, right = Math.max(...cols.map((r) => r.right)) + 10;
    const y = Math.min(...cols.map((r) => r.y)) - 10, bottom = Math.max(...cols.map((r) => r.bottom)) + 10;
    return fit(x, y, right - x, bottom - y);
  }
  if (name === "pv-calendar-v1") {
    const w = document.querySelector(".pjv3-calwrap").getBoundingClientRect();
    //   달력은 넉 주에서 끊는다 — 빈 주가 붙으면 조각 아래가 허옇게 남는다
    const cells = document.querySelectorAll(".pjv3-calcell");
    const bottom = cells[27].getBoundingClientRect().bottom;
    return fit(w.x, w.y - 8, w.width, bottom - w.y + 8);
  }
  const g = document.querySelector(".pjv3-ganttwrap").getBoundingClientRect();
  return fit(g.x, g.y - 8, g.width, Math.min(g.height + 16, 420));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul",
});
const page = await ctx.newPage();

console.log("1) 로그인");
await page.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);   // 하이드레이션 전에 채우면 리액트 상태가 비어 로그인이 안 된다
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PW);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard/, { timeout: 60000 });

console.log("2) 프로젝트 열기");
await page.goto(`${BASE}/projecthub/${DEAL}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("table.pjv3-sheet", { timeout: 45000 });
await page.waitForTimeout(2500);
// 캡처에 끼어드는 것만 감춘다 (제품에는 그대로 있다)
await page.addStyleTag({ content: `.messenger-fab, .toast-container, [data-tour], .pjv3-hint { display: none !important; }` });

fs.mkdirSync(OUT, { recursive: true });
for (const s of SHOTS) {
  if (s.view !== "표") {
    await page.locator(`.pjv3-views button:has-text("${s.view}")`).first().click();
    await page.waitForTimeout(1200);
  }
  const box = await page.evaluate(`(${measure.toString()})(${JSON.stringify(s.name)})`);
  const file = path.join(OUT, `${s.name}.png`);
  await page.screenshot({ path: file, clip: box });
  console.log(`   ${s.name}.png  ${box.width}x${box.height} (css)`);
}

await browser.close();
console.log("끝 — public/product/ 확인");
