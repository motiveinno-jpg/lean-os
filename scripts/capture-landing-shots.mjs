// 랜딩 v7 "겹친 캡처 모자이크" 구간용 실제 화면 캡처 (2026-09-07)
//   오두(odoo.com) '최적화된 프로세스로 생산성 향상' 의 겹친 캡처 모자이크를 벤치마킹한 구간들에 쓴다.
//
//   쓰는 법
//     node scripts/capture-landing-shots.mjs                 # 모든 묶음 다시 찍기
//     node scripts/capture-landing-shots.mjs project hr      # 고른 묶음만
//     node scripts/capture-landing-shots.mjs --survey /inventory/stock /attendance
//         → 자를 자리를 정하기 전에 화면 전체를 훑어본다. .playwright-mcp/survey/ 에 저장(커밋 안 됨)
//
//   결과: public/product/{pv|iv|hv}-*-v1.png (2배 해상도)
//
//   ⚠️ 프로덕션(www.owner-view.com)을 **읽기만** 한다. 데이터를 만들지 않는다.
//   ⚠️ 계정은 로컬 메모리 파일에서 읽는다 — 저장소·명령줄에 적지 않는다.
//   ⚠️ 다시 찍어 그림이 달라지면 파일명 번호를 올린다(-v2). 덮으면 캐시 때문에 옛 그림이 계속 나온다.
//   ⚠️ 통장·급여액처럼 계좌번호·개인 금액이 그대로 보이는 화면은 담지 않는다 (결정 200·210).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.join(process.env.REPO || process.cwd(), "package.json"));
const { chromium } = req("playwright");

const BASE = process.env.BASE || "https://www.owner-view.com";
// 촬영 대상 프로젝트 — **QA 시드 회사(가상)** 의 '하늘건설 사옥 리뉴얼 웹 구축' (결정 220).
//   2026-09-07 이전에는 모티브 [시연] 프로젝트를 썼는데, 담당자 칸에 실제 직원 실명이 들어갔다.
const DEAL = process.env.DEAL || "dd000000-0000-4000-8000-000000000001";
const CHAT = process.env.CHAT || "88000000-0000-4000-8000-000000000001";
//   계정 — 기본은 모티브 계정(로컬 메모리 파일). SHOT_EMAIL/SHOT_PW 로 갈아 끼울 수 있다.
//   ⚠️ 오너뷰는 **계정당 세션 1개**다(single-session-guard). 사장님이 쓰는 중에 이 스크립트가
//      같은 계정으로 로그인하면 사장님 화면이 "중복 로그인"으로 튕긴다. 낮에는 QA 시드 계정을 쓰거나
//      사장님이 안 쓰는 시간에 돌린다.
//   --qa 를 주면 QA 시드 계정으로 든다. 그 회사는 **가상 인물·샘플 자료**뿐이라 개인정보가 없고,
//   사장님 세션도 쫓아내지 않는다. 계정 값은 여기에 또 적지 않고 blog-capture.mjs 한 곳에서 읽는다.
let EMAIL = process.env.SHOT_EMAIL, PW = process.env.SHOT_PW;
if (process.argv.includes("--qa")) {
  const src = fs.readFileSync(path.join(process.cwd(), "scripts", "blog-capture.mjs"), "utf8");
  EMAIL = src.match(/BLOG_CAPTURE_EMAIL \|\| "([^"]+)"/)?.[1];
  PW = src.match(/BLOG_CAPTURE_PASSWORD \|\| "([^"]+)"/)?.[1];
  if (!EMAIL || !PW) throw new Error("blog-capture.mjs 에서 QA 시드 계정을 못 읽었습니다");
}
if (!EMAIL || !PW) {
  const CRED = path.join(process.env.HOME || process.env.USERPROFILE,
    ".claude/projects/C--Users-----Desktop-motive-lean-os/memory/reference-ownerview-login.md");
  const m = fs.readFileSync(CRED, "utf8").match(/`([^`]+@[^`]+)`\s*\/\s*`([^`]+)`/);
  if (!m) throw new Error("로그인 정보를 메모리 파일에서 찾지 못했습니다");
  [, EMAIL, PW] = m;
}
const OUT = path.join(process.cwd(), "public", "product");
/** 조각의 아래를 끊을 때 기준으로 삼는 경계 — 카드·표 줄. 카드 한가운데가 잘리지 않게 */
const CARDS = ".glass-card, [class*='-card'], .fw-row, table tbody tr";

/* ── 브라우저 안에서 도는 자·자르개 ──────────────────────────────
   페이지 배경이 비치거나 줄 한가운데가 잘리면 조각이 지저분해 보인다.
   그래서 오른쪽·아래를 **내용의 끝**(또는 줄 경계)에서 끊는다. */
const MEASURE = `(spec) => {
  const vw = innerWidth, vh = innerHeight;
  const el = document.querySelector(spec.sel);
  if (!el) throw new Error("자를 대상을 못 찾았습니다: " + spec.sel);
  const r = el.getBoundingClientRect();
  const pad = spec.pad ?? 0;
  let x = r.x - pad, y = r.y - pad;
  let right = r.right + pad, bottom = r.bottom + pad;

  // 가로로 넘치는 표는 감싼 상자의 오른쪽에서 끊는다 (배경 그라데이션이 끼지 않게)
  if (spec.clipToParent && el.parentElement) right = Math.min(right, el.parentElement.getBoundingClientRect().right);
  // 폭을 줄여야 하면 **열 경계**에서 끊는다 (열 한가운데가 잘리면 잘못 만든 그림처럼 보인다)
  if (spec.maxW && right - x > spec.maxW) {
    let cut = x + spec.maxW;
    if (spec.colSel) {
      const cols = [...document.querySelectorAll(spec.colSel)].map((e) => e.getBoundingClientRect())
        .filter((b) => b.right > x && b.right <= cut);
      if (cols.length) cut = Math.max(...cols.map((b) => b.right));
    }
    right = cut;
  }
  // 여러 칸을 품는 조각(칸반 등)은 칸들의 실제 범위로 좁힌다 — 빈 오른쪽이 남지 않게
  if (spec.innerSel) {
    const bs = [...document.querySelectorAll(spec.innerSel)].map((e) => e.getBoundingClientRect());
    if (bs.length) {
      x = Math.min(...bs.map((b) => b.x)) - pad; right = Math.max(...bs.map((b) => b.right)) + pad;
      y = Math.min(...bs.map((b) => b.y)) - pad; bottom = Math.max(...bs.map((b) => b.bottom)) + pad;
    }
  }
  // 높이를 줄여야 하면 **줄 경계**에서 끊는다 (줄 한가운데가 잘리면 잘못 만든 그림처럼 보인다)
  if (spec.maxH && bottom - y > spec.maxH) {
    let cut = y + spec.maxH;
    if (spec.rowSel) {
      const rows = [...document.querySelectorAll(spec.rowSel)].map((e) => e.getBoundingClientRect())
        .filter((b) => b.bottom > y && b.bottom <= cut);
      if (rows.length) cut = Math.max(...rows.map((b) => b.bottom));
    }
    bottom = cut;
  }
  // 넉 주까지만 같은 식으로 (달력은 빈 주가 붙으면 아래가 허옇게 남는다)
  if (spec.cutAfterSel && spec.cutAfterIdx != null) {
    const cells = document.querySelectorAll(spec.cutAfterSel);
    const c = cells[spec.cutAfterIdx];
    if (c) bottom = c.getBoundingClientRect().bottom;
  }
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  return { x, y,
    width: Math.round(Math.min(right - x, vw - x)),
    height: Math.round(Math.min(bottom - y, vh - y)) };
}`;

/* ── 무엇을 찍는가 ───────────────────────────────────────────────
   묶음 하나 = 랜딩의 모자이크 구간 하나. 조각은 넷이고, 넷 다 **같은 화면 계열**이어야
   "하나에서 갈라진 보기"로 읽힌다. 서로 다른 회사·다른 자료를 섞으면 '각각 다른 화면'이 된다. */
const SETS = {
  // ① 프로젝트 — 같은 프로젝트를 보기만 바꿔 찍는다 (결정 204).
  //    ⚠️ **QA 시드 회사(가상)** 에서 찍는다 (`--qa`, 결정 220).
  project: {
    qaOnly: true,
    route: `/projecthub/${DEAL}/`,
    ready: "table.pjv3-sheet",
    tabSel: '.pjv3-views button:has-text("%s")',
    shots: [
      { name: "pv-table-v4",    sel: "table.pjv3-sheet", clipToParent: true, maxH: 620, rowSel: "table.pjv3-sheet tbody tr" },
      { name: "pv-calendar-v4", tab: "캘린더", sel: ".pjv3-calwrap",   cutAfterSel: ".pjv3-calcell", cutAfterIdx: 27, pad: 6 },
      { name: "pv-gantt-v4",    tab: "간트",   sel: ".pjv3-ganttwrap", maxH: 430, rowSel: ".pjv3-gr, .pjv3-ggroup", pad: 6 },
    ],
  },

  //    칸반은 세 열이 1180 에 다 안 들어가 따로 넓게 찍는다.
  kanban: {
    qaOnly: true, vw: 1300,
    route: `/projecthub/${DEAL}/`,
    ready: "table.pjv3-sheet",
    tabSel: '.pjv3-views button:has-text("%s")',
    shots: [
      { name: "pv-kanban-v4",   tab: "칸반",   sel: ".pjv3-kb",        innerSel: ".pjv3-kcol", pad: 10 },
    ],
  },

  // ② 재고 — 물건이 들어오고 나가는 길. 화면마다 라우트가 달라 조각마다 route 를 준다.
  //    ⚠️ **QA 시드 회사(가상)** 에서 찍는다 (`--qa`, 결정 220).
  //    ⚠️ 판매 문서의 거래처는 비워 뒀다 — 거래처 칸에 실제 상호가 나가면 안 된다.
  //       그래서 이익관리는 '거래처·채널별' 이 아니라 '종합' 탭을 쓴다.
  inventory: {
    qaOnly: true,
    tabSel: '.collect-tabs button:has-text("%s")',
    shots: [
      { name: "iv-stock-v3",    route: "/inventory/stock",    sel: ".app-content-scale", maxH: 540, rowSel: "table tbody tr" },
      { name: "iv-channels-v3", route: "/inventory/channels", sel: ".app-content-scale", maxH: 520, rowSel: "table tbody tr" },
      //   '상태' 열은 뺀다 — 시연 판매라 전부 '전표 없음' 이고, 그 말이 랜딩에서 오해를 부른다
      { name: "iv-sales-v3",    route: "/inventory/sales",    tab: "이력", sel: ".app-content-scale",
        maxH: 500, rowSel: "table tbody tr", maxW: 1010, colSel: "table thead th" },
      { name: "iv-profit-v3",   route: "/inventory/profit",   sel: ".app-content-scale", maxH: 520, rowSel: "table tbody tr" },
    ],
  },

  // ④ 회계·세무 — 자료가 들어와 신고서까지 가는 길.
  //    ⚠️ **가상 거래처뿐인 QA 시드 회사**에서 찍는다 (`--qa`). 실제 거래처명·금액을 공개 페이지에 올리지 않는다.
  //    ⚠️ 통장 화면은 담지 않는다 — 계좌번호가 그대로 보인다 (결정 200).
  accounting: {
    qaOnly: true,
    tabSel: '.collect-tabs button:has-text("%s")',
    shots: [
      { name: "av-invoices-v2", route: "/tax-invoices",       sel: ".app-content-scale", maxH: 520, rowSel: "table tbody tr" },
      { name: "av-tax-v2",      route: "/finance/tax-filing", tab: "부가세",       sel: ".app-content-scale", maxH: 560, rowSel: "table tbody tr" },
      { name: "av-voucher-v2",  route: "/finance/status",     tab: "매입매출전표", sel: ".app-content-scale", maxH: 500, rowSel: "table tbody tr" },
      //   수집 현황은 담지 않는다 — QA 시드는 무료 요금제라 '자료 없음 · 유료 요금제 기능' 만 늘어선다
      { name: "av-profit-v2",   route: "/reports/profit",     sel: ".app-content-scale", maxH: 520, rowSel: "table tbody tr" },
    ],
  },

  // ③ 인사 — 사람이 일하고 정산되는 길.
  //    ⚠️ **가상 인물뿐인 QA 시드 회사**에서 찍는다 (`--qa`). 실제 직원 이름·급여를 공개 페이지에 올리지 않는다.
  //       (2026-09-07 사장님 "인사 부분 가상 데이터로")
  // ④ 기능 소개 큰 조각 — 랜딩 각 절의 대표 화면. 상자가 676px 이라 **좁은 뷰포트(1180)** 로 찍어
  //    글자가 실제 크기에 가깝게 보이게 한다(1560 으로 찍으면 59% 로 줄어 뭉개져 보였다).
  //    머리(빵부스러기·검색)는 빼고 본문만 담는다.
  feature: {
    qaOnly: true, vw: 1180,
    tabSel: '.collect-tabs button:has-text("%s")',
    shots: [
      { name: "f-profit-v2",       route: "/reports/profit",     sel: ".app-content-scale", maxH: 430, rowSel: CARDS },
      { name: "f-inv-channels-v2", route: "/inventory/channels", sel: ".app-content-scale", maxH: 560, rowSel: CARDS },
      { name: "f-projects-v6",     route: "/projecthub",         sel: ".app-content-scale", maxH: 520, rowSel: CARDS },
      { name: "f-schedule-v5",     route: "/schedule",           sel: ".app-content-scale", maxH: 520 },
      { name: "f-documents-v5",    route: "/documents",          sel: ".app-content-scale", maxH: 520, rowSel: CARDS },
      { name: "f-hr-v6",           route: "/attendance",         sel: ".app-content-scale", maxH: 520, rowSel: CARDS },
      { name: "f-bank-v5",         route: "/collect",            sel: ".app-content-scale", maxH: 520, rowSel: CARDS },
      { name: "f-board-v5",        route: "/board",              sel: ".app-content-scale", maxH: 520, rowSel: CARDS },
      { name: "f-chat-v5",         route: `/chat?channel=${CHAT}`, sel: ".app-content-scale", maxH: 520 },
    ],
  },
  // ⑤ 히어로 대체 판 — 1160px 상자에 16:9 로 들어가므로 넓게(1560) 찍어도 거의 1:1 이다.
  hero: {
    qaOnly: true, vw: 1560, vh: 975,
    shots: [
      { name: "hero-dashboard-v7", route: "/dashboard",  full: true },
      { name: "hero-bank-v5",      route: "/collect",    full: true },
      { name: "hero-projects-v6",  route: "/projecthub", full: true },
      { name: "hero-hr-v6",        route: "/attendance", full: true },
    ],
  },

  hr: {
    qaOnly: true,
    tabSel: '.collect-tabs button:has-text("%s")',
    shots: [
      { name: "hv-workboard-v2",  route: "/attendance", sel: ".app-content-scale", maxH: 600 },
      { name: "hv-attstatus-v2",  route: "/attendance", tab: "근태 현황", sel: ".app-content-scale", maxH: 520, rowSel: ".ev-table tbody tr" },
      { name: "hv-members-v2",    route: "/employees",  sel: ".app-content-scale", maxH: 520, rowSel: "table tbody tr" },
      { name: "hv-leave-v2",      route: "/employees",  tab: "휴가", sel: ".app-content-scale", maxH: 500, rowSel: "table tbody tr" },
    ],
  },
};

/* ── 실행 ───────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const surveyAt = args.indexOf("--survey");
const survey = surveyAt >= 0 ? args.slice(surveyAt + 1) : null;
const picked = args.filter((a) => !a.startsWith("--"));
const wanted = survey ? [] : (picked.length ? picked : Object.keys(SETS));

const browser = await chromium.launch();
const DEFAULT_VW = Number(process.env.VW || 1180);
//   캡처에 끼어드는 안내(투어·시작 체크리스트·권한 배너·햄버거 힌트)는 미리 끈다
const INIT = () => {
  localStorage.setItem("ov-app-tour-dismissed-at", String(Date.now()));
  localStorage.setItem("leanos-getting-started-dismissed", "1");
  localStorage.setItem("ov:master-perm-notice", "1");
  localStorage.setItem("hint:hamburger", "1");
};
let ctx = await browser.newContext({
  viewport: { width: DEFAULT_VW, height: 1000 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul",
});
await ctx.addInitScript(INIT);
let page = await ctx.newPage();
let curVw = DEFAULT_VW, curVh = 1000;
/** 묶음이 다른 폭을 원하면 로그인 상태를 들고 새 창을 연다 */
async function useViewport(vw, vh = 1000) {
  if (vw === curVw && vh === curVh) return;
  const state = await ctx.storageState();
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul", storageState: state });
  await ctx.addInitScript(INIT);
  page = await ctx.newPage();
  curVw = vw; curVh = vh;
}

console.log("로그인");
await page.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);   // 하이드레이션 전에 채우면 리액트 상태가 비어 로그인이 안 된다
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PW);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard/, { timeout: 60000 });

// 캡처에 끼어드는 것만 감춘다 (제품에는 그대로 있다)
const HIDE = `.messenger-fab, .toast-container, [data-tour] { display: none !important; }`;

if (survey) {
  const dir = path.join(process.cwd(), ".playwright-mcp", "survey");
  fs.mkdirSync(dir, { recursive: true });
  for (const route of survey) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    const file = path.join(dir, route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") + ".png");
    await page.screenshot({ path: file });
    console.log("   " + file);
  }
} else {
  fs.mkdirSync(OUT, { recursive: true });
  for (const key of wanted) {
    const set = SETS[key];
    if (!set) { console.log(`   (모르는 묶음: ${key})`); continue; }
    console.log(`묶음 ${key}`);
    await useViewport(set.vw || DEFAULT_VW, set.vh || 1000);
    let at = null;
    for (const s of set.shots) {
      const route = s.route ?? set.route;
      if (route !== at) {
        await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
        if (set.ready) await page.waitForSelector(set.ready, { timeout: 45000 });
        await page.waitForTimeout(3500);   // 표·차트가 다 그려진 뒤에 잰다
        await page.addStyleTag({ content: HIDE }).catch(() => {});
        at = route;
      }
      if (s.tab) {
        await page.locator(set.tabSel.replace("%s", s.tab)).first().click();
        await page.waitForTimeout(1300);
      }
      if (s.full) {
        await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
        console.log(`   ${s.name}.png  창 전체 ${curVw}x${curVh} (css)`);
        continue;
      }
      await page.waitForSelector(s.sel, { timeout: 20000 });
      const box = await page.evaluate(`(${MEASURE})(${JSON.stringify(s)})`);
      await page.screenshot({ path: path.join(OUT, `${s.name}.png`), clip: box });
      console.log(`   ${s.name}.png  ${box.width}x${box.height} (css)`);
    }
  }
}

await browser.close();
console.log("끝");
