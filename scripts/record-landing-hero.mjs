// 랜딩 히어로 시연 영상 촬영기 (2026-09-04 최초 · 2026-09-09 QA 시드·고화질로 개편)
//
//   쓰는 법:  node scripts/record-landing-hero.mjs --qa
//   결과   :  ./out/hero-raw.webm + offset.json (앞부분 예열 길이)
//   다듬기 :  node scripts/record-landing-hero.mjs --encode   (ffmpeg-static 을 임시로 받아 씀)
//             → public/video/ 에 webm · mp4 · poster.jpg 를 만든다.
//             ⚠️ 다시 찍으면 VER 를 올린다. 덮으면 캐시 때문에 옛 영상이 계속 나온다.
//
//   ⛔ **--qa 없이 돌리지 않는다** (결정 220).
//      2026-09-04 에 모티브 계정으로 찍은 영상의 첫 장면(대시보드)에 **실제 거래처명과 미수금**이
//      그대로 보였다. 랜딩에 나갈 화면은 **가상 인물·가상 거래처뿐인 QA 시드 회사**에서만 찍는다.
//      계정 값은 여기에 적지 않고 scripts/blog-capture.mjs 한 곳에서 읽는다.
//
//   ⚠️ 로컬(.env.local)은 다른 Supabase 프로젝트라 이 계정으로 로그인이 안 된다 →
//      BASE 는 프로덕션(www.owner-view.com)이 기본이다. 촬영은 읽기만 한다(데이터를 만들지 않는다).
//   ⚠️ 오너뷰는 계정당 세션 1개다. QA 시드 계정으로 열어 둔 창이 있으면 그 창이 튕긴다.
//   ⚠️ 통장 화면은 실제 계좌번호가 보이므로 장면에 넣지 않는다 (결정 200).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const REPO = process.env.REPO || "C:/Users/연준호/Desktop/motive/lean-os";
const req = createRequire(path.join(REPO, "package.json"));

const OUT = process.env.OUT_DIR || "./out";
const VER = process.env.VER || "v2";          // 다시 찍을 때마다 올린다
const RAW = path.join(OUT, "hero-raw.webm");

/* ══════════════════════════════════════════════════════════════
   --encode : 찍어 둔 원본을 웹용 두 형식 + 포스터로 뽑는다
   ══════════════════════════════════════════════════════════════ */
if (process.argv.includes("--encode")) {
  const ffmpeg = req("ffmpeg-static");
  const { offset, dur } = JSON.parse(fs.readFileSync(path.join(OUT, "offset.json"), "utf8"));
  const dest = path.join(REPO, "public", "video");
  fs.mkdirSync(dest, { recursive: true });
  const run = (args) => execFileSync(ffmpeg, args, { stdio: "inherit" });
  const ss = String(offset.toFixed(2)), t = String(dur.toFixed(2));
  //  히어로에 45초는 길다 → 살짝 조여 30초대로. 화면 폭은 1440 이면 충분하다(원본 1920).
  const SPEED = Number(process.env.SPEED || 1.4);
  const VF = `setpts=PTS/${SPEED},scale=1440:-2:flags=lanczos`;

  console.log(`자르기 ${ss}s 부터 ${t}s · ${SPEED}배속 · 1440 폭  → 약 ${(dur / SPEED).toFixed(1)}초`);
  // VP9 — 화질 우선(crf 낮을수록 좋음). 무음.
  run(["-y", "-ss", ss, "-i", RAW, "-t", t, "-vf", VF,
       "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0",
       "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an",
       path.join(dest, `ownerview-hero-${VER}.webm`)]);
  // H.264 — 사파리·구형 브라우저용
  run(["-y", "-ss", ss, "-i", RAW, "-t", t, "-vf", VF,
       "-c:v", "libx264", "-crf", "22", "-preset", "slow",
       "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-an",
       path.join(dest, `ownerview-hero-${VER}.mp4`)]);
  // 포스터 — 영상이 뜨기 전 보이는 정지 화면
  run(["-y", "-ss", String((offset + 1.2).toFixed(2)), "-i", RAW, "-frames:v", "1",
       "-vf", "scale=1440:-2:flags=lanczos", "-q:v", "3",
       path.join(dest, `ownerview-hero-${VER}-poster.jpg`)]);

  for (const f of fs.readdirSync(dest)) {
    console.log(" ", f, (fs.statSync(path.join(dest, f)).size / 1048576).toFixed(2), "MB");
  }
  process.exit(0);
}

/* ══════════════════════════════════════════════════════════════
   촬영
   ══════════════════════════════════════════════════════════════ */
if (!process.argv.includes("--qa")) {
  console.error("⛔ --qa 없이는 찍지 않습니다. 랜딩 영상은 QA 시드 회사에서만 찍습니다 (결정 220).");
  process.exit(1);
}
const src = fs.readFileSync(path.join(REPO, "scripts", "blog-capture.mjs"), "utf8");
const EMAIL = src.match(/BLOG_CAPTURE_EMAIL \|\| "([^"]+)"/)?.[1];
const PW = src.match(/BLOG_CAPTURE_PASSWORD \|\| "([^"]+)"/)?.[1];
if (!EMAIL || !PW) throw new Error("blog-capture.mjs 에서 QA 시드 계정을 못 읽었습니다");

const { chromium } = req("playwright");
const BASE = process.env.BASE || "https://www.owner-view.com";
const W = Number(process.env.W || 1920), H = Number(process.env.H || 1080);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const glide = (page, x, y, steps = 34) => page.mouse.move(x, y, { steps });

async function softScroll(page, to, ms = 1500) {
  await page.evaluate(
    ([to, ms]) =>
      new Promise((res) => {
        const el = document.scrollingElement || document.documentElement;
        const from = el.scrollTop, t0 = performance.now();
        (function step(t) {
          const p = Math.min(1, (t - t0) / ms);
          el.scrollTop = from + (to - from) * (1 - Math.pow(1 - p, 3));
          p < 1 ? requestAnimationFrame(step) : res();
        })(t0);
      }),
    [to, ms],
  );
}

// 영상에서 시선을 뺏는 것만 감춘다 (제품에는 그대로 있다)
//  ⚠️ 설정 안내 배너는 QA 시드 회사가 설정을 안 끝냈다는 표시일 뿐인데,
//     영상에 나오면 제품이 미완성으로 보인다.
const HIDE = `
  .messenger-fab, .toast-container { display: none !important }
  .master-perm-notice, .dashboard-onboarding-collapsed-banner { display: none !important }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important }
`;
const hide = (page) => page.addStyleTag({ content: HIDE }).catch(() => {});

//  장면 — 통장은 넣지 않는다(계좌번호, 결정 200).
//  ⚠️ 자료가 있는 화면만 고른다. QA 시드는 무료 플랜이라 /collect(수집·전표)는 잠겨 비어 보이고,
//     /tax 는 없는 경로다(404). 아래 다섯은 scripts/capture-landing-shots.mjs 가 쓰는,
//     QA 시드에 실제로 자료가 찬 화면이다.
//  차례 = 랜딩이 말하는 흐름 그대로: 현황 → 업무 → 증빙 → 신고 → 인사
const DEAL = process.env.DEAL || "dd000000-0000-4000-8000-000000000001";
const SCENES = [
  { href: "/dashboard",          label: "대시보드",     scroll: 320, hold: 1500 },
  { href: `/projecthub/${DEAL}`, label: "프로젝트",     scroll: 240, hold: 1600 },
  { href: "/tax-invoices",       label: "세금·증빙",    scroll: 260, hold: 1500 },
  { href: "/finance/tax-filing", label: "부가세 신고서", tab: "부가세", scroll: 240, hold: 1700 },
  { href: "/attendance",         label: "근태 관리",    scroll: 200, hold: 1500 },
];

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--hide-scrollbars"],
});

// ── 1차: 로그인 (녹화 없음) ─────────────────────────────────
console.log(`1) 로그인 (QA 시드) — ${BASE}`);
const warm = await browser.newContext({ viewport: { width: W, height: H }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
const wp = await warm.newPage();
await wp.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await wp.waitForTimeout(2500);                       // 하이드레이션 — 이르게 채우면 값이 날아간다
await wp.locator('input[type="email"]').first().fill(EMAIL);
await wp.locator('input[autocomplete="current-password"], input[type="password"]').first().fill(PW);
await wp.locator('button[type="submit"]').first().click();
await wp.waitForURL(/dashboard/, { timeout: 60000 });
await wp.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
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
  await page.goto(`${BASE}${s.href}/`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await hide(page);
  await wait(900);
}

// 본 촬영
console.log("3) 촬영");
await page.goto(`${BASE}${SCENES[0].href}/`, { waitUntil: "networkidle", timeout: 60000 });
await hide(page);
await wait(1400);                                     // 첫 장면이 완전히 자리 잡은 뒤 시작
const tStart = Date.now();

for (let i = 0; i < SCENES.length; i++) {
  const s = SCENES[i];
  console.log(`   ${i + 1}/${SCENES.length} ${s.label}`);
  if (i > 0) {
    await page.goto(`${BASE}${s.href}/`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await hide(page);
    await wait(900);
  }
  if (s.tab) {                                   // 갈래가 있는 화면은 그 갈래를 눌러 둔다
    await page.getByRole("button", { name: s.tab, exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    await wait(1100);
  }
  await glide(page, 820 + i * 110, 380 + i * 60);
  await wait(600);
  if (s.scroll) {
    await softScroll(page, s.scroll, 1500);
    await wait(s.hold);
    await softScroll(page, 0, 900);
    await wait(500);
  } else {
    await wait(s.hold + 1200);
  }
}
await wait(600);
const tEnd = Date.now();

const video = page.video();
await ctx.close();
const raw = await video.path();
fs.renameSync(raw, RAW);
await browser.close();

const offset = (tStart - t0) / 1000;
const dur = (tEnd - tStart) / 1000;
fs.writeFileSync(path.join(OUT, "offset.json"), JSON.stringify({ offset, dur }, null, 1));
console.log(`녹화 완료: ${RAW} ${(fs.statSync(RAW).size / 1048576).toFixed(2)} MB · ${W}×${H}`);
console.log(`잘라낼 앞부분 ${offset.toFixed(1)}s · 본 구간 ${dur.toFixed(1)}s`);
console.log(`다음: npm i ffmpeg-static 후  node scripts/record-landing-hero.mjs --encode`);
