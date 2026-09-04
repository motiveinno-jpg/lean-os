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
  const blocks = [];
  const pushImage = (href, alt) => { const p = path.join(ROOT, "public", href); if (fs.existsSync(p)) blocks.push({ type: "image", file: p, alt: stripInline(alt) }); };
  for (const t of marked.lexer(body)) {
    if (t.type === "heading") blocks.push({ type: "heading", text: stripInline(t.text) });
    else if (t.type === "paragraph") {
      const imgs = [...t.raw.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
      const text = stripInline(t.text);
      if (text) blocks.push({ type: "text", text });
      for (const im of imgs) pushImage(im[2], im[1]);
    }
    else if (t.type === "list") for (const it of t.items) blocks.push({ type: "text", text: "• " + stripInline(it.text) });
    else if (t.type === "table") {
      const head = t.header.map((h) => stripInline(h.text));
      for (const row of t.rows) blocks.push({ type: "text", text: row.map((c, i) => `${head[i]}: ${stripInline(c.text)}`).join("  |  ") });
    }
    else if (t.type === "blockquote") blocks.push({ type: "text", text: stripInline(t.text) });
    else if (t.type === "space") continue;
    else if (t.text) blocks.push({ type: "text", text: stripInline(t.text) });
  }
  //   글 끝 — 서비스 링크 한 줄. 글은 네이버에만 두므로 우리 도메인은 랜딩으로만 잇는다.
  blocks.push({ type: "text", text: `오너뷰 — 통장·카드·홈택스를 연결하면 사장님 화면이 저절로 채워져요. 기본 기능은 계속 무료: ${SITE}` });
  const tags = (meta.tags || "").split(",").map((s) => s.trim().replace(/\s+/g, "")).filter(Boolean).slice(0, 10);
  return { title: meta.title || slug, blocks, tags, slug };
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
  //   이미지 자리는 ⟦IMG n⟧ 문단으로 두고 뒤에서 사진 업로드로 바꾼다. 링크 두 줄은 자동 링크가 걸리게 타이핑으로 넣는다.
  const uid = () => "SE-" + crypto.randomUUID();
  const textNode = (value, style) => ({ id: uid(), value, ...(style ? { style: { ...style, "@ctype": "nodeStyle" } } : {}), "@ctype": "textNode" });
  const paragraph = (value, style) => ({ id: uid(), nodes: [textNode(value, style)], "@ctype": "paragraph" });
  const paras = [];
  const imageFiles = [];
  for (const b of post.blocks) {
    if (b.type === "image") { imageFiles.push(b.file); paras.push(paragraph(`⟦IMG ${imageFiles.length}⟧`)); paras.push(paragraph("")); continue; }
    if (b.type === "text" && (b.text.startsWith(SITE) || /^오너뷰 — /.test(b.text))) continue;   // 링크 줄은 나중에 타이핑
    paras.push(paragraph(b.text, b.type === "heading" ? { bold: true } : undefined));
    paras.push(paragraph(""));
  }
  const doc = await fr.evaluate(({ title, paras, uid1, uid2, uid3 }) => {
    const ed = window.SmartEditor.getEditor("blogpc001");
    const cur = ed.getDocumentData();
    const d = cur.document;
    d.components = [
      { id: uid1, layout: "default", title: [{ id: uid2, nodes: [{ id: uid3, value: title, "@ctype": "textNode" }], "@ctype": "paragraph" }], subTitle: null, align: "left", "@ctype": "documentTitle" },
      { id: "SE-" + crypto.randomUUID(), layout: "default", value: paras, "@ctype": "text" },
    ];
    ed.setDocumentData(cur);
    return { ok: true, comps: ed.getDocumentData().document.components.length };
  }, { title: post.title, paras, uid1: uid(), uid2: uid(), uid3: uid() });
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
  // 링크 두 줄 — 마지막 문단 끝에 타이핑(자동 링크)
  const tail = post.blocks.filter((b) => b.type === "text" && /^오너뷰 — /.test(b.text)).map((b) => b.text);
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
  if (DRY) { console.log("[dry] 채우기만 했습니다. 창을 20초 뒤 닫습니다."); await sleep(20000); await page.close(); return null; }

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
