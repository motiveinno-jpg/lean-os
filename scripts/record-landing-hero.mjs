// 랜딩 v7 히어로 시연 영상 촬영기 (2026-09-04 · 결정 192·199~201)
//
//   쓰는 법:  node scripts/record-landing-hero.mjs
//   결과   :  ./out/hero-raw.webm + offset.json (앞부분 예열 길이)
//   다듬기 :  ffmpeg 로 잘라내고 두 형식으로 뽑는다. 이 저장소의 ffmpeg 는 H.264 가 없으므로
//             mp4 는 ffmpeg-static 을 임시로 받아 쓴다(저장소에 넣지 않는다).
//               npm i ffmpeg-static  (임시 폴더에서)
//               ffmpeg -ss <offset> -i hero-raw.webm -t 29 -c:v libvpx-vp9 -crf 33 -b:v 0 -an  ownerview-hero.webm
//               ffmpeg -ss <offset> -i hero-raw.webm -t 29 -c:v libx264 -crf 23 -preset slow -movflags +faststart -pix_fmt yuv420p -an  ownerview-hero.mp4
//               ffmpeg -ss <offset+0.3> -i hero-raw.webm -frames:v 1 -q:v 4  ownerview-hero-poster.jpg
//             → public/video/ 에 넣고 content.ts 의 HERO_VIDEO 경로를 맞춘다.
//             ⚠️ 다시 찍으면 파일명 뒤에 -v2 를 붙인다. 덮으면 캐시 때문에 옛 영상이 계속 나온다.
//
//   ⚠️ 로컬(.env.local)은 다른 Supabase 프로젝트라 이 계정으로 로그인이 안 된다 →
//      BASE 는 프로덕션(www.owner-view.com)이 기본이다. 촬영은 읽기만 한다(데이터를 만들지 않는다).
//   ⚠️ 계정은 로컬 메모리 파일에서 읽는다. 저장소·명령줄에 절대 적지 않는다.
//   ⚠️ 통장 화면은 실제 계좌번호가 보이므로 장면에 넣지 않는다 (결정 200).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.join(process.env.REPO || "C:/Users/연준호/Desktop/motive/lean-os", "package.json"));
const { chromium } = req("playwright");

const BASE = process.env.BASE || "https://www.owner-view.com";
// 계정은 로컬 메모리 파일에서 읽는다 — 명령줄·저장소에 남기지 않는다.
const CRED = path.join(process.env.HOME || process.env.USERPROFILE,
  ".claude/projects/C--Users-----Desktop-motive-lean-os/memory/reference-ownerview-login.md");
const m = fs.readFileSync(CRED, "utf8").match(/`([^`]+@[^`]+)`\s*\/\s*`([^`]+)`/);
if (!m) throw new Error("로그인 정보를 메모리 파일에서 찾지 못했습니다");
const EMAIL = m[1], PW = m[2];
const OUT = process.env.OUT_DIR || "./out";
const W = 1440, H = 810;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const glide = (page, x, y, steps = 26) => page.mouse.move(x, y, { steps });

async function softScroll(page, to, ms = 1300) {
  await page.evaluate(
    ([to, ms]) =>
      new Promise((res) => {
        const from = window.scrollY, t0 = performance.now();
        (function step(t) {
          const p = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - p, 3)));
          p < 1 ? requestAnimationFrame(step) : res();
        })(t0);
      }),
    [to, ms],
  );
}

// 영상에서 시선을 뺏는 것만 감춘다 (제품에는 그대로 있다)
const HIDE = `.messenger-fab, .toast-container { display: none !important; }`;
const hide = (page) => page.addStyleTag({ content: HIDE }).catch(() => {});

const SCENES = [
  { href: "/dashboard", label: "대시보드", scroll: 300 },
  { href: "/collect", label: "수집·전표", scroll: 260 },
  { href: "/projecthub", label: "프로젝트", scroll: 240 },
  { href: "/attendance", label: "근태 관리", scroll: 0 },
];

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });

// ── 1차: 로그인 (녹화 없음) ─────────────────────────────────
console.log("1) 로그인");
const warm = await browser.newContext({ viewport: { width: W, height: H }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
const wp = await warm.newPage();
await wp.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await wp.locator('input[type="email"]').first().fill(EMAIL);
await wp.locator('input[autocomplete="current-password"], input[type="password"]').first().fill(PW);
await wp.locator('button[type="submit"]').first().click();
await wp.waitForURL(/dashboard/, { timeout: 45000 });
await wp.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
const state = await warm.storageState();
await warm.close();
console.log("   OK");

// ── 2차: 녹화 ───────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  locale: "ko-KR", timezoneId: "Asia/Seoul",
  storageState: state,
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const page = await ctx.newPage();
const t0 = Date.now();

// 예열 — 여기서 생기는 로딩 화면은 나중에 잘라낸다
console.log("2) 예열");
for (const s of SCENES) {
  await page.goto(`${BASE}${s.href}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await hide(page);
  await wait(700);
}

// 본 촬영
console.log("3) 촬영");
await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle", timeout: 45000 });
await hide(page);
await wait(900);
const tStart = Date.now();

for (let i = 0; i < SCENES.length; i++) {
  const s = SCENES[i];
  console.log(`   ${i + 1}/4 ${s.label}`);
  if (i > 0) {
    await page.goto(`${BASE}${s.href}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await hide(page);
    await wait(600);
  }
  await glide(page, 760 + i * 90, 320 + i * 45);
  await wait(700);
  if (s.scroll) {
    await softScroll(page, s.scroll, 1300);
    await wait(1500);
    await softScroll(page, 0, 800);
    await wait(400);
  } else {
    await glide(page, 1000, 520);
    await wait(2600);
  }
}
await wait(500);
const tEnd = Date.now();

const video = page.video();
await ctx.close();
const raw = await video.path();
const dest = path.join(OUT, "hero-raw.webm");
fs.renameSync(raw, dest);
await browser.close();

const offset = (tStart - t0) / 1000;
const dur = (tEnd - tStart) / 1000;
fs.writeFileSync(path.join(OUT, "offset.json"), JSON.stringify({ offset, dur }, null, 1));
console.log(`녹화 완료: ${dest} ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB`);
console.log(`잘라낼 앞부분 ${offset.toFixed(1)}s · 본 구간 ${dur.toFixed(1)}s`);
