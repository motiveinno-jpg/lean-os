#!/usr/bin/env node
// 네이버 블로그 발행 — 공식 글쓰기 API 가 2020년에 없어져, 이 Mac 에 로그인해 둔 브라우저 프로필로 스마트에디터 ONE 을 직접 조작한다.
//   사용:
//     node scripts/naver-publish.mjs login                 — 창이 열리면 네이버에 직접 로그인(한 번만). 블로그 ID 를 저장한다.
//     node scripts/naver-publish.mjs post <slug> [--dry]   — content/blog/<slug>.md 를 발행. --dry 면 채우기만 하고 발행하지 않는다.
//     node scripts/naver-publish.mjs pending [--dry]       — 아직 네이버에 안 올린 글을 전부 발행.
//   기록: content/blog/.naver-posted.json (slug → 네이버 글 주소). 프로필: ~/.ownerview/naver-profile (저장소 밖).
//   주의: 네이버 화면 구조가 바뀌면 selector 를 손봐야 한다. 실패하면 스크린샷을 scratch/naver-*.png 로 남긴다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { marked } from "marked";

const ROOT = process.cwd();
const HOME_DIR = path.join(os.homedir(), ".ownerview");
const PROFILE = path.join(HOME_DIR, "naver-profile");
const CONF = path.join(HOME_DIR, "naver.json");
const COOKIES = path.join(HOME_DIR, "naver-cookies.json");   // 세션 쿠키(NID_AUT·NID_SES)는 창을 닫으면 사라져 따로 보관한다
const POSTED = path.join(ROOT, "content", "blog", ".naver-posted.json");
const SITE = "https://www.owner-view.com";
const [cmd, arg, ...rest] = process.argv.slice(2);
const DRY = rest.includes("--dry") || arg === "--dry";
fs.mkdirSync(HOME_DIR, { recursive: true });

const loadJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const saveJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openBrowser() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const saved = loadJson(COOKIES, null);
  if (Array.isArray(saved) && saved.length) { try { await ctx.addCookies(saved); } catch { /* 만료·형식 오류면 로그인 안내로 이어진다 */ } }
  return ctx;
}
async function saveCookies(ctx) {
  const all = await ctx.cookies();
  const naver = all.filter((c) => c.domain.includes("naver")).map((c) => (c.expires === -1 ? { ...c, expires: Math.floor(Date.now() / 1000) + 30 * 86400 } : c));
  saveJson(COOKIES, naver);
}

async function isLoggedIn(ctx) {
  const cookies = await ctx.cookies("https://blog.naver.com");
  return cookies.some((c) => c.name === "NID_AUT");
}

// ── login ──
async function login() {
  const ctx = await openBrowser();
  const page = await ctx.newPage();
  await page.goto("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver", { waitUntil: "domcontentloaded" });
  console.log("브라우저 창에서 네이버에 로그인해 주세요. (최대 5분 기다립니다)");
  for (let i = 0; i < 150; i++) { if (await isLoggedIn(ctx)) break; await sleep(2000); }
  if (!(await isLoggedIn(ctx))) { console.error("로그인이 확인되지 않았습니다."); await ctx.close(); process.exit(1); }
  await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const m = page.url().match(/blog\.naver\.com\/([A-Za-z0-9_-]+)/);
  const blogId = m && m[1] !== "MyBlog.naver" ? m[1] : null;
  if (!blogId) { console.error("블로그 ID 를 URL 에서 읽지 못했습니다:", page.url()); await ctx.close(); process.exit(1); }
  saveJson(CONF, { blogId, savedAt: new Date().toISOString() });
  await saveCookies(ctx);
  console.log("로그인 확인. 블로그 ID:", blogId, "→", CONF, "(쿠키 보관:", COOKIES + ")");
  await ctx.close();
}

// ── 마크다운 → 에디터에 넣을 블록 ──
function stripInline(s) {
  return String(s || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => (/^https?:/.test(u) ? `${t}(${u})` : t))
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}
function parsePost(slug) {
  const raw = fs.readFileSync(path.join(ROOT, "content", "blog", `${slug}.md`), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const body = m ? m[2] : raw;
  //   블록 종류: heading(깊이) · text · lead(첫 문단) · list · table · quote · hr · image
  const blocks = [];
  const pushImage = (href, alt) => { const p = path.join(ROOT, "public", href); if (fs.existsSync(p)) blocks.push({ type: "image", file: p, alt: stripInline(alt) }); };
  for (const t of marked.lexer(body)) {
    if (t.type === "heading") blocks.push({ type: "heading", depth: t.depth, text: stripInline(t.text) });
    else if (t.type === "paragraph") {
      const imgs = [...t.raw.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
      const text = stripInline(t.text);
      if (text) blocks.push({ type: "text", text });
      for (const im of imgs) pushImage(im[2], im[1]);
    }
    else if (t.type === "list") blocks.push({ type: "list", items: t.items.map((it) => stripInline(it.text)) });
    else if (t.type === "table") blocks.push({ type: "table", head: t.header.map((h) => stripInline(h.text)), rows: t.rows.map((r) => r.map((c) => stripInline(c.text))) });
    else if (t.type === "blockquote") blocks.push({ type: "quote", text: stripInline(t.text) });
    else if (t.type === "hr") blocks.push({ type: "hr" });
    else if (t.type === "space") continue;
    else if (t.text) blocks.push({ type: "text", text: stripInline(t.text) });
  }
  //   첫 문단은 리드 — 조금 크게 넣어 글이 밋밋해 보이지 않게 한다
  const firstText = blocks.find((b) => b.type === "text");
  if (firstText) firstText.type = "lead";
  const tags = (meta.tags || "").split(",").map((s) => s.trim().replace(/\s+/g, "")).filter(Boolean).slice(0, 10);
  return { title: meta.title || slug, blocks, tags, slug, summary: (meta.description || "").trim() };
}

// ── 에디터 조작 ──
async function shot(page, name) { try { fs.mkdirSync(path.join(ROOT, "scratch"), { recursive: true }); await page.screenshot({ path: path.join(ROOT, "scratch", `naver-${name}.png`) }); } catch { /* noop */ } }

async function dismissPopups(frame) {
  //   "작성 중인 글이 있습니다" → 취소(새 글), 도움말 말풍선 → 닫기
  for (const txt of ["취소", "닫기"]) {
    const b = frame.getByRole("button", { name: txt });
    try { if (await b.count()) { const first = b.first(); if (await first.isVisible()) { await first.click({ timeout: 1500 }); await sleep(500); } } } catch { /* noop */ }
  }
}

async function publishPost(ctx, post) {
  const conf = loadJson(CONF, null);
  if (!conf?.blogId) throw new Error("먼저 `node scripts/naver-publish.mjs login` 으로 로그인해 주세요.");
  const page = await ctx.newPage();
  //   "작성 중인 글을 불러올까요?" 류는 취소, 나머지 확인창은 확인
  page.on("dialog", (d) => (/작성 중|불러오|임시|이어서/.test(d.message()) ? d.dismiss() : d.accept()).catch(() => {}));
  await page.goto(`https://blog.naver.com/${conf.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator("#mainFrame");
  await frame.locator(".se-title-text, .se-documentTitle").first().waitFor({ state: "visible", timeout: 60000 });
  await sleep(3500);   // 자동 저장 글이 되살아나는 시간을 지나 보낸 뒤 통째로 덮어쓴다
  await dismissPopups(frame);
  const fr = page.frames().find((x) => /PostWriteForm/i.test(x.url()));
  if (!fr) throw new Error("글쓰기 프레임을 찾지 못했습니다.");

  //   문서 JSON 을 직접 구성 — 타이핑보다 확실하고, 되살아난 임시 글도 이 순간 사라진다.
  //   네이버 부품을 그대로 쓴다: 소제목은 큰 글씨+브랜드색, 인용은 인용구, 표는 표, 마디마다 구분선.
  //   이미지 자리는 ⟦IMG n⟧ 문단으로 두고 뒤에서 사진 업로드로 바꾼다. 링크 줄은 자동 링크가 걸리게 타이핑으로 넣는다.
  const imageFiles = [];
  for (const b of post.blocks) if (b.type === "image") imageFiles.push(b.file);
  const doc = await fr.evaluate(({ title, blocks, brand }) => {
    const uid = () => "SE-" + crypto.randomUUID();
    const tn = (value, style) => ({ id: uid(), value, ...(style ? { style: { ...style, "@ctype": "nodeStyle" } } : {}), "@ctype": "textNode" });
    const para = (nodes, align) => ({ id: uid(), nodes: Array.isArray(nodes) ? nodes : [nodes], "@ctype": "paragraph", ...(align ? { style: { align, "@ctype": "paragraphStyle" } } : {}) });
    const textComp = (paras) => ({ id: uid(), layout: "default", value: paras, "@ctype": "text" });
    const line = () => ({ id: uid(), layout: "line3", "@ctype": "horizontalLine" });
    const quote = (t, layout) => ({ id: uid(), layout: layout || "quotation_line", value: [para(tn(t))], source: null, "@ctype": "quotation" });
    const cell = (t, head) => ({ id: uid(), colSpan: 1, rowSpan: 1, height: 43, "@ctype": "tableCell",
      value: [para(tn(t, head ? { bold: true, fontColor: brand } : null), "center")] });
    const comps = [{ id: uid(), layout: "default", title: [para(tn(title))], subTitle: null, align: "left", "@ctype": "documentTitle" }];
    const blank = () => textComp([para(tn(""))]);
    let n = 0;
    for (const b of blocks) {
      if (b.type === "image") { n += 1; comps.push(textComp([para(tn("\u27E6IMG " + n + "\u27E7"))])); if (b.alt) comps.push(textComp([para(tn(b.alt, { fontSizeCode: "fs13", fontColor: "#888888" }), "center")])); comps.push(blank()); continue; }
      if (b.type === "hr") { comps.push(line()); continue; }
      if (b.type === "heading") {
        if (b.depth <= 2) comps.push(line());   // 마디 앞 선이 여백 노릇도 한다 — 빈 줄을 겹쳐 넣지 않는다
        comps.push(textComp([para(tn(b.text, { bold: true, fontSizeCode: b.depth <= 2 ? "fs19" : "fs17", fontColor: brand }))]));
        comps.push(blank());
        continue;
      }
      if (b.type === "lead") { comps.push(textComp([para(tn(b.text, { fontSizeCode: "fs17" }))])); comps.push(blank()); continue; }
      if (b.type === "quote") { comps.push(quote(b.text)); comps.push(blank()); continue; }
      if (b.type === "list") { comps.push(textComp(b.items.map((it) => para(tn("\u00B7 " + it))))); comps.push(blank()); continue; }
      if (b.type === "table") {
        comps.push({ id: uid(), layout: "default", width: 100, "@ctype": "table", rows: [
          { "@ctype": "tableRow", cells: b.head.map((h) => cell(h, true)) },
          ...b.rows.map((r) => ({ "@ctype": "tableRow", cells: r.map((c) => cell(c, false)) })),
        ] });
        comps.push(blank());
        continue;
      }
      comps.push(textComp([para(tn(b.text))]));
      comps.push(blank());
    }
    //   맺음 — 구분선 뒤 말풍선 한 마디. 링크 줄은 이 뒤에 타이핑으로 붙는다.
    comps.push(line());
    comps.push(quote("통장·카드·홈택스를 연결하면 사장님 화면이 저절로 채워져요. 기본 기능은 계속 무료예요.", "quotation_bubble"));
    const ed = window.SmartEditor.getEditor("blogpc001");
    const cur = ed.getDocumentData();
    cur.document.components = comps;
    ed.setDocumentData(cur);
    return { comps: ed.getDocumentData().document.components.length };
  }, { title: post.title, blocks: post.blocks, brand: "#4F46E5" });
  await sleep(1200);

  // 이미지 — 자리 표시 문단을 찾아 눌러 초점을 두고, 표시 글자를 지운 뒤 사진 업로드
  let imageCount = 0;
  for (let i = 0; i < imageFiles.length; i++) {
    const mark = `⟦IMG ${i + 1}⟧`;
    const ph = frame.locator(".se-component.se-text .se-text-paragraph", { hasText: mark }).first();
    await ph.scrollIntoViewIfNeeded(); await ph.click(); await sleep(200);
    await page.keyboard.press("End"); await page.keyboard.press("Shift+Home"); await page.keyboard.press("Backspace"); await sleep(200);
    const before = await frame.locator(".se-component.se-image").count();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      frame.locator("button[data-name='image']").first().click(),
    ]);
    await chooser.setFiles(imageFiles[i]);
    for (let k = 0; k < 40; k++) { await sleep(500); if ((await frame.locator(".se-component.se-image").count()) > before) break; }
    imageCount++;
    await sleep(600);
  }
  // 랜딩 링크 — 맨 끝에 타이핑해서 자동 링크가 걸리게 한다
  const tail = [`오너뷰 알아보기 ${SITE}`];
  if (tail.length) {
    const lastP = frame.locator(".se-component.se-text .se-text-paragraph").last();
    await lastP.scrollIntoViewIfNeeded(); await lastP.click(); await page.keyboard.press("End");
    for (const line of tail) { await page.keyboard.press("Enter"); await page.keyboard.insertText(line); await page.keyboard.press("Enter"); await sleep(120); }
  }
  const leftover = await fr.$$eval(".se-text-paragraph", (es) => es.filter((e) => /⟦IMG/.test(e.textContent)).length);
  try { await frame.locator(".se-title-text, .se-documentTitle").first().scrollIntoViewIfNeeded(); } catch { /* noop */ }
  await sleep(500);
  await shot(page, `${post.slug}-filled`);
  console.log(`채움: 컴포넌트 ${doc.comps}, 이미지 ${imageCount}/${imageFiles.length}, 남은 자리표시 ${leftover}`);
  if (leftover) throw new Error("이미지 자리 표시가 남았습니다. 캡처 파일을 확인해 주세요.");
  if (DRY) {
    //   미리보기: 편집 화면을 위에서 아래로 훑어 여러 장 남긴다(간격·표·이미지를 눈으로 보려고)
    for (let i = 0; i < 8; i++) {
      try { await fr.evaluate((k) => { const els = document.querySelectorAll(".se-component"); const el = els[Math.min(els.length - 1, Math.round((els.length / 8) * k))]; el?.scrollIntoView({ block: "start" }); }, i); } catch { /* noop */ }
      await sleep(800);
      await shot(page, `${post.slug}-dry-${i}`);
    }
    console.log("[dry] 채우기만 했습니다. scratch/naver-<slug>-dry-*.png 확인.");
    await page.close(); return null;
  }

  // 발행 — 상단 '발행' → 발행 창(태그 입력) → 창 안의 '발행'
  await frame.getByRole("button", { name: /^발행$/ }).first().click();
  await sleep(1500);
  const tagInput = frame.locator("#tag-input, input[placeholder*='태그']").first();
  try {
    if (await tagInput.isVisible({ timeout: 3000 })) {
      for (const t of post.tags) { await tagInput.click(); await page.keyboard.insertText(t); await page.keyboard.press("Enter"); await sleep(150); }
    }
  } catch { /* 태그 칸이 없으면 그냥 발행 */ }
  await shot(page, `${post.slug}-publish-layer`);
  const finalBtn = frame.locator(".publish_btn_area button, [class*='confirm_btn'], button:has-text('발행')").last();
  await finalBtn.click();
  let url = null;
  for (let i = 0; i < 60; i++) { await sleep(1000); const u = page.url(); if (/blog\.naver\.com\/[^/?]+\/\d+/.test(u) || /logNo=\d+/.test(u)) { url = u; break; } }
  await shot(page, `${post.slug}-after-publish`);
  await page.close();
  //   목록으로 튕겨 주소를 못 읽는 경우가 있다 — 블로그 RSS 에서 같은 제목의 글을 찾아 확인한다
  if (!url) url = await findPostedUrl(post.title);
  if (!url) throw new Error("발행 뒤 글 주소를 확인하지 못했습니다. scratch/naver-*.png 를 확인해 주세요.");
  return url;
}

//   블로그 RSS 로 올라간 글을 확인한다(제목 → 주소). 발행 직후 색인이 늦으면 몇 초 기다렸다 다시 본다.
async function fetchRss() {
  const conf = loadJson(CONF, {});
  if (!conf.blogId) return [];
  try {
    const xml = await (await fetch(`https://rss.blog.naver.com/${conf.blogId}.xml`, { headers: { "user-agent": "Mozilla/5.0" } })).text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
      title: (m[1].match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || [])[1] || "",
      url: ((m[1].match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/) || [])[1] || "").split("?")[0],
    })).filter((i) => i.url);
  } catch { return []; }
}
async function findPostedUrl(title) {
  for (let i = 0; i < 6; i++) {
    const hit = (await fetchRss()).find((it) => it.title.trim() === title.trim());
    if (hit) return hit.url;
    await sleep(5000);
  }
  return null;
}

//   글 삭제 — 잘못 올라간 글을 지우고 다시 올릴 때 쓴다. 주소나 글번호(logNo)를 준다.
async function removePost(target) {
  const conf = loadJson(CONF, {});
  const logNo = String(target).match(/\d{6,}/)?.[0];
  if (!logNo) { console.error("글 주소나 글번호를 주세요."); process.exit(1); }
  const ctx = await openBrowser();
  if (!(await isLoggedIn(ctx))) { console.error("로그인이 없습니다. 먼저 `node scripts/naver-publish.mjs login`"); await ctx.close(); process.exit(1); }
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { await d.accept().catch(() => {}); });
  await page.goto(`https://blog.naver.com/${conf.blogId}/${logNo}`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const fr = page.frames().find((f) => /PostView/i.test(f.url())) || page.mainFrame();
  const frame = page.frameLocator("#mainFrame");
  //   삭제는 글 오른쪽 위 '⋮' 메뉴 안에 있다 — 메뉴를 먼저 연다
  for (const sel of ["button[class*='more']", "a[class*='more']", "[class*='btn_more']", "button[aria-label*='더보기']"]) {
    const m = frame.locator(sel).first();
    try { if (await m.isVisible({ timeout: 1500 })) { await m.click(); await sleep(800); break; } } catch { /* 다음 후보 */ }
  }
  let done = false;
  for (const sel of ["a:has-text('삭제')", "button:has-text('삭제')", "li:has-text('삭제')"]) {
    const l = frame.locator(sel).first();
    try { if (await l.isVisible({ timeout: 2000 })) { await l.click(); done = true; break; } } catch { /* 다음 후보 */ }
  }
  if (!done) { await shot(page, `delete-${logNo}`); console.error("삭제 버튼을 찾지 못했습니다. scratch/naver-delete-*.png 확인"); await ctx.close(); process.exit(1); }
  await sleep(1500);
  //   확인 레이어의 '삭제' 를 한 번 더 누른다
  for (const sel of [".btn_ok", "button:has-text('삭제')", "a:has-text('삭제')"]) {
    const l = frame.locator(sel).last();
    try { if (await l.isVisible({ timeout: 1500 })) { await l.click(); break; } } catch { /* 대화상자로 처리된 경우 */ }
  }
  await sleep(4000);
  const still = (await fetchRss()).some((it) => it.url.endsWith("/" + logNo));
  console.log(still ? `삭제되지 않았을 수 있습니다: ${logNo} (RSS 에 아직 있음)` : `삭제함: ${logNo}`);
  const posted = loadJson(POSTED, {});
  for (const [slug, v] of Object.entries(posted)) if (String(v.url).includes(logNo)) delete posted[slug];
  saveJson(POSTED, posted);
  try { await saveCookies(ctx); } catch { /* noop */ }
  await ctx.close();
  if (fr) { /* noop — 프레임 참조 유지용 */ }
}

async function post(slugs) {
  const posted = loadJson(POSTED, {});
  const ctx = await openBrowser();
  if (!(await isLoggedIn(ctx))) { console.error("로그인이 없습니다. 먼저 `node scripts/naver-publish.mjs login`"); await ctx.close(); process.exit(1); }
  try {
    for (const slug of slugs) {
      const p = parsePost(slug);
      console.log(`발행 시작: ${p.title} (블록 ${p.blocks.length}, 이미지 ${p.blocks.filter((b) => b.type === "image").length})`);
      const url = await publishPost(ctx, p);
      if (url) { posted[slug] = { url, at: new Date().toISOString() }; saveJson(POSTED, posted); console.log("발행 완료:", url); }
    }
  } finally { try { await saveCookies(ctx); } catch { /* noop */ } await ctx.close(); }
}

if (cmd === "login") await login();
else if (cmd === "list") { const items = await fetchRss(); if (!items.length) console.log("올라간 글이 없습니다."); else items.forEach((i) => console.log(`${i.url}  ${i.title}`)); }
else if (cmd === "delete" && arg) await removePost(arg);
else if (cmd === "post" && arg && arg !== "--dry") await post([arg]);
else if (cmd === "pending") {
  const posted = loadJson(POSTED, {});
  const all = fs.readdirSync(path.join(ROOT, "content", "blog")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
  const todo = all.filter((s) => !posted[s]);
  if (!todo.length) console.log("네이버에 올릴 새 글이 없습니다.");
  else await post(todo);
} else { console.log("사용: login | post <slug> [--dry] | pending [--dry] | list | delete <주소|글번호>"); process.exit(1); }
