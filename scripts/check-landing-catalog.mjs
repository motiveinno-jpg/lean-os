// 공개 페이지 메뉴 목록(landing-v8/catalog.ts) ↔ 앱 사이드바 대조 (2026-09-14, 결정 228)
//   사용: node scripts/check-landing-catalog.mjs   → 어긋나면 줄을 찍고 exit 1
//   원본: components/sidebar.tsx NAV_GROUPS(마스터 전용 제외) + lib/settings-nav.ts SETTINGS_GROUPS(설정 그룹 자리)
//   파일을 실행하지 않고 글자로 읽는다 — 사이드바는 클라이언트 부품이라 node 로 불러올 수 없다.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const live = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l));

// ── 사이드바 ──
const side = live(read("src/components/sidebar.tsx"));
const start = side.findIndex((l) => l.includes("const NAV_GROUPS"));
const want = [];
let group = null;
for (let i = start + 1; i < side.length && !/^\];/.test(side[i]); i++) {
  const l = side[i];
  const g = l.match(/^\s*label: "([^"]+)", short:/);
  if (g) { group = { name: g[1], menus: [] }; want.push(group); continue; }
  if (l.includes("SETTINGS_GROUPS.map")) { group.menus.push("__SETTINGS__"); continue; }
  const m = l.match(/\{ href: "([^"]+)",.*label: "([^"]+)"/);
  if (m && !l.includes("masterOnly: true")) group.menus.push(`${m[2]} ${m[1]}`);
}
const settings = live(read("src/lib/settings-nav.ts"))
  .map((l) => l.match(/key: "[a-z-]+", label: "([^"]+)", route: "([^"]+)"/))
  .filter(Boolean)
  .map((m) => `${m[1]} ${m[2]}`);
for (const g of want) {
  const i = g.menus.indexOf("__SETTINGS__");
  if (i >= 0) g.menus.splice(i, 1, ...settings);
}

// ── 공개 목록 ──
const cat = live(read("src/components/landing-v8/catalog.ts"));
const have = [];
for (const l of cat) {
  const g = l.match(/^\s*key: "[a-z-]+", name: "([^"]+)", short:/);
  if (g) { have.push({ name: g[1], menus: [] }); continue; }
  const m = l.match(/\{ key: "[a-z-]+", name: "([^"]+)", href: "([^"]+)"/);
  if (m) have.at(-1).menus.push(`${m[1]} ${m[2]}`);
}

// ── 대조 ──
const lines = [];
const gw = want.map((g) => g.name).join(" · ");
const gh = have.map((g) => g.name).join(" · ");
if (gw !== gh) lines.push(`그룹 차례\n  사이드바: ${gw}\n  공개목록: ${gh}`);
for (const w of want) {
  const h = have.find((x) => x.name === w.name);
  if (!h) { lines.push(`공개목록에 그룹 없음: ${w.name}`); continue; }
  const a = w.menus.join(" | ");
  const b = h.menus.join(" | ");
  if (a !== b) lines.push(`[${w.name}]\n  사이드바: ${a}\n  공개목록: ${b}`);
}
const total = have.reduce((n, g) => n + g.menus.length, 0);
if (lines.length) {
  console.error(`✗ 공개 메뉴 목록이 사이드바와 다르다 (${lines.length}곳)\n\n${lines.join("\n\n")}`);
  process.exit(1);
}
console.log(`✓ 사이드바와 같다 — 그룹 ${have.length} · 메뉴 ${total}`);
