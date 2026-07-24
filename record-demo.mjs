// OwnerView 홍보 영상용 실제 화면 녹화 — 시나리오대로 클릭·전환하며 mp4 소스 생성.
//   실행: OV_EMAIL=... OV_PASSWORD=... node record-demo.mjs
//   결과: ./out/ownerview-demo.webm  (+ ffmpeg 있으면 .mp4)
//   커서/클릭 리플/자막 오버레이를 페이지에 주입해 "버튼 누르는" 모습이 보이도록 함. 읽기 전용 동작만(제출·삭제·발송 없음).

import { chromium } from "playwright";
import { existsSync, writeFileSync } from "fs";

const BASE = process.env.OV_BASE || "https://www.owner-view.com";
const EMAIL = process.env.OV_EMAIL;
const PASSWORD = process.env.OV_PASSWORD;
const SCRATCH = "C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/19f91921-78b1-40e1-92a6-4d4ecab8a875/scratchpad";
const OUT_DIR = SCRATCH + "/out";
const STATE_FILE = SCRATCH + "/auth-state.json"; // 로그인 세션 저장 → 재실행 시 로그인 생략

// 자격정보는 선택 — 있으면 자동 로그인 시도, 없으면 열린 창에서 직접 로그인.

const OVERLAY = `
  (function(){
    if (window.__ovOverlay) return; window.__ovOverlay = true;
    function add(){
      var c=document.createElement('div'); c.id='__ovcur';
      c.style.cssText='position:fixed;z-index:2147483647;left:960px;top:540px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(79,70,229,.30);border:2px solid #4F46E5;pointer-events:none;box-shadow:0 0 0 4px rgba(79,70,229,.12)';
      document.documentElement.appendChild(c);
      window.addEventListener('mousemove',function(e){c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';},true);
      window.__ripple=function(x,y){var r=document.createElement('div');r.style.cssText='position:fixed;z-index:2147483646;left:'+x+'px;top:'+y+'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:rgba(79,70,229,.55);pointer-events:none';document.documentElement.appendChild(r);r.animate([{transform:'scale(1)',opacity:.6},{transform:'scale(6)',opacity:0}],{duration:520,easing:'ease-out'}).onfinish=function(){r.remove()};};
      var cap=document.createElement('div');cap.id='__ovcap';
      cap.style.cssText='position:fixed;z-index:2147483645;left:50%;bottom:7%;transform:translateX(-50%);background:#4F46E5;color:#fff;font:600 24px Pretendard,"Malgun Gothic",system-ui,sans-serif;padding:11px 24px;border-radius:12px;opacity:0;transition:opacity .35s;box-shadow:0 8px 28px rgba(0,0,0,.22);pointer-events:none;max-width:80vw;text-align:center;letter-spacing:-.01em';
      document.documentElement.appendChild(cap);
      window.__caption=function(t){cap.textContent=t||'';cap.style.opacity=t?'1':'0';};
    }
    if(document.documentElement) add(); else document.addEventListener('DOMContentLoaded',add);
  })();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── Phase A: 로그인 — 저장된 세션이 있으면 생략, 없으면 헤디드 창에서 직접 로그인 후 저장 ──
  if (!existsSync(STATE_FILE)) {
    const loginBrowser = await chromium.launch({ headless: false, channel: "chrome" });
    const loginCtx = await loginBrowser.newContext({ viewport: { width: 1280, height: 900 } });
    const lp = await loginCtx.newPage();
    console.log("로그인 페이지 여는 중... (브라우저 창에서 직접 로그인해도 됩니다)");
    await lp.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
    await sleep(1200);
    if (EMAIL && PASSWORD) {
      await lp.locator('input[type="email"]').fill(EMAIL).catch(() => {});
      await lp.locator('input[type="password"]').fill(PASSWORD).catch(() => {});
      await lp.locator('form.auth-form button[type="submit"]').click({ timeout: 4000 }).catch(() => {});
    }
    console.log("로그인 대기 중... 브라우저 창에서 로그인해 주세요(구글/이메일 무관). 최대 5분.");
    // 로그인 완료 = 다시 owner-view.com 로 돌아왔고 /auth 가 아닌 화면. (구글 로그인 중 accounts.google.com 은 계속 대기)
    let loggedIn = false;
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      let host = "", pathn = "/";
      try { const u = new URL(lp.url()); host = u.host; pathn = u.pathname; } catch {}
      if (host.includes("owner-view.com") && !pathn.startsWith("/auth")) { loggedIn = true; break; }
    }
    if (!loggedIn) { console.error("로그인 대기 시간 초과. 종료."); await loginBrowser.close(); process.exit(2); }
    await sleep(2500);
    const st = await loginCtx.storageState();
    writeFileSync(STATE_FILE, JSON.stringify(st));
    await loginBrowser.close();
    console.log("로그인 완료 → 세션 저장 → 녹화 시작");
  } else {
    console.log("저장된 세션 재사용 → 녹화 시작");
  }

  // ── Phase B: 녹화(헤드리스, 영상, 로그인 세션 재사용) ──
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    storageState: STATE_FILE,
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  let last = { x: 960, y: 540 };

  async function settle(ms = 550) {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(ms);
  }
  async function caption(t) { await page.evaluate((x) => window.__caption && window.__caption(x), t || "").catch(() => {}); }
  async function glide(x, y) {
    const steps = 26;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(last.x + (x - last.x) * i / steps, last.y + (y - last.y) * i / steps);
      await sleep(11);
    }
    last = { x, y };
  }
  async function click(locator, cap) {
    const el = locator.first();
    await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    const box = await el.boundingBox().catch(() => null);
    if (box) {
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await glide(x, y);
      await page.evaluate(([x, y]) => window.__ripple && window.__ripple(x, y), [x, y]).catch(() => {});
      await sleep(180);
    }
    await el.click({ timeout: 8000 });
    if (cap !== undefined) await caption(cap);
  }
  async function safe(fn) { try { await fn(); } catch (e) { console.log("  skip:", (e.message || "").split("\n")[0]); } }
  async function navTo(href, cap) {
    const link = page.locator(`aside a[href="${href}"]`);
    if (await link.count().catch(() => 0)) await safe(() => click(link, cap));
    else { await page.goto(BASE + href).catch(() => {}); if (cap !== undefined) await caption(cap); }
    await settle();
  }
  async function clickText(name, cap) {
    const btn = page.getByRole("button", { name, exact: false });
    if (await btn.count().catch(() => 0)) return safe(() => click(btn, cap));
    const lnk = page.getByRole("link", { name, exact: false });
    if (await lnk.count().catch(() => 0)) return safe(() => click(lnk, cap));
    return safe(() => click(page.getByText(name, { exact: false }), cap));
  }
  // 프로젝트허브 전용 헬퍼
  async function scopeAll() {
    const b = page.getByRole("button", { name: "전체", exact: true });
    if (await b.count().catch(() => 0)) await safe(() => click(b));
    else await safe(() => click(page.getByText("전체", { exact: true }).first()));
    await sleep(800);
  }
  async function openCard(title) {
    await safe(() => click(page.locator(".project-card").filter({ hasText: title }).first()));
    await settle(700);
  }
  async function clickToggle(t) {
    const b = page.getByRole("button", { name: t, exact: true });
    if (await b.count().catch(() => 0)) return safe(() => click(b));
    return safe(() => click(page.getByText(t, { exact: true }).first()));
  }
  async function backToHub() {
    await safe(() => page.goBack());
    await settle(600);
    await scopeAll();
  }

  try {
    // ── 씬0 오프닝 — 대시보드 ──
    console.log("씬0 대시보드");
    await navTo("/dashboard", "회사의 하루가, 한 화면에");
    await sleep(900);

    // ── 씬1 AI 참모 ──
    console.log("씬1 AI 참모");
    await navTo("/copilot", "대표의 질문에, 데이터로 답하는 AI 참모");
    await safe(async () => {
      const input = page.locator("textarea, input[type=text]").first();
      await click(input);
      await input.type("이번 달 회사 상태 브리핑해줘", { delay: 30 });
    });
    await sleep(900);

    // ── 씬2 자금 자동화 ──
    console.log("씬2 자금 자동화");
    await navTo("/bank", "은행·카드 거래, 매일 자동 수집");
    await sleep(750);
    await navTo("/cards");
    await sleep(650);
    await navTo("/transactions", "계정과목·부가세까지 자동 분류");
    await sleep(650);
    await clickText("입금 매칭");
    await sleep(750);

    // ── 씬3 프로젝트 콕핏 (전체 탭 → 수익형·목표형·실행형) ──
    console.log("씬3 프로젝트");
    await navTo("/projecthub", "지금 챙길 것만, 콕핏이 짚어준다");
    await scopeAll(); // '전체' 탭으로 카드 노출
    await sleep(500);
    await openCard("A커머스 브랜드몰 구축"); // 수익형
    await caption("수익형 — 돈이 되나 (마진·돈 흐름)");
    await sleep(1100);
    await backToHub();
    await openCard("2026 상반기 디자인 매출 목표"); // 목표형
    await caption("목표 대비 어디쯤 — 클릭 한 번에 다시 그린다");
    await sleep(600);
    for (const t of ["주별", "월별", "일별"]) { await clickToggle(t); await sleep(400); }
    await sleep(500);
    await backToHub();
    await openCard("오너뷰 개발 프로젝트"); // 실행형
    await caption("기한 안에 끝내나 — 완료 번업");
    await sleep(1100);
    await safe(() => page.goBack());
    await settle(500);

    // ── 씬4 결재 허브 ──
    console.log("씬4 결재 허브");
    await navTo("/approvals", "결재도 한 곳에서 끝");
    await sleep(650);
    await clickText("새 요청");
    await sleep(800);
    await clickText("전체 현황");
    await sleep(800);

    // ── 씬5 협업 ──
    console.log("씬5 협업");
    await navTo("/schedule", "공지·일정·메신저까지 한 시스템에");
    await sleep(700);
    await navTo("/board");
    await sleep(600);
    await navTo("/chat");
    await sleep(700);

    // ── 씬6 인사·급여 ──
    console.log("씬6 인사·급여");
    await navTo("/employees", "대표도, 직원도 — 각자 자기 화면");
    await sleep(700);
    await navTo("/attendance");
    await sleep(650);
    await navTo("/mypage");
    await safe(() => click(page.getByText("인사기록", { exact: false }).first()));
    await sleep(900);

    // ── 씬7 계약 ──
    console.log("씬7 계약");
    await navTo("/hr-templates", "서식 → 발송 → 전자서명 → 보관");
    await sleep(700);
    await navTo("/signatures");
    await sleep(700);

    // ── 클로징 ──
    console.log("클로징");
    await navTo("/dashboard", "돈 · 일 · 사람 · 문서 — 하나의 시스템");
    await sleep(1200);
    await caption("");
    await sleep(400);
  } catch (e) {
    console.error("오류:", e.message);
  } finally {
    await page.close();
    const video = await page.video();
    const vpath = video ? await video.path().catch(() => null) : null;
    await context.close();
    await browser.close();
    console.log("완료. 영상:", vpath || OUT_DIR);
  }
})();
