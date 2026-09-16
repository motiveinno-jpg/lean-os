// 새로 찍은 캡처를 catalog.ts 에 반영 (2026-09-16)
//   capture-menu-shots.mjs 의 SHOTS 표를 읽어, **라우트가 같은 메뉴**의 shot() 이름을 새 번호로 바꾼다.
//   이름을 손으로 고치면 52줄 중 한 줄을 빠뜨리기 쉬워 라우트 대조로 자동화한다.
//
//   쓰는 법:  node scripts/apply-menu-shots.mjs          # 무엇이 바뀌는지만 보여 준다
//            node scripts/apply-menu-shots.mjs --write   # 실제로 고친다
//   ⚠️ public/product 에 새 파일이 실제로 있는 것만 바꾼다(촬영 실패분은 옛 이름을 그대로 둔다).
import fs from "node:fs";
import path from "node:path";

const CATALOG = path.join(process.cwd(), "src", "components", "landing-v8", "catalog.ts");
const SHOTS_SRC = path.join(process.cwd(), "scripts", "capture-menu-shots.mjs");
const OUT = path.join(process.cwd(), "public", "product");

// SHOTS 표에서 { route, name } 만 뽑는다
const shots = [...fs.readFileSync(SHOTS_SRC, "utf8")
  .matchAll(/route:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g)]
  .map(([, route, name]) => ({ route, name }));

let src = fs.readFileSync(CATALOG, "utf8");
const changed = [], skipped = [];

for (const { route, name } of shots) {
  if (!fs.existsSync(path.join(OUT, `${name}.png`))) { skipped.push(`${route} — ${name}.png 없음(촬영 실패)`); continue; }
  //   같은 줄에 href 와 src: shot("...") 이 함께 있는 형태만 바꾼다
  const re = new RegExp(`(href:\\s*"${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^\\n]*?src:\\s*)(?:shot\\("([^"]+)"\\)|null)`);
  const m = src.match(re);
  if (!m) { skipped.push(`${route} — catalog 에서 못 찾음`); continue; }
  if (m[2] === name) { skipped.push(`${route} — 이미 ${name}`); continue; }
  src = src.replace(re, `$1shot("${name}")`);
  changed.push(`${route.padEnd(40)} ${(m[2] ?? "(없음)").padEnd(24)} → ${name}`);
}

console.log(`바꿀 것 ${changed.length}건`);
for (const c of changed) console.log("  " + c);
if (skipped.length) {
  console.log(`\n건너뜀 ${skipped.length}건`);
  for (const s of skipped) console.log("  " + s);
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(CATALOG, src, "utf8");
  console.log("\ncatalog.ts 를 고쳤습니다. tsc 로 확인하고 옛 png 는 따로 정리하세요.");
} else {
  console.log("\n(미리보기입니다 — 실제로 고치려면 --write)");
}
