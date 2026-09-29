#!/usr/bin/env node
// 실행 중에 생기는 클래스의 스타일이 지워지지 않았는지 본다.
//
// 왜: 2026-08-25 미사용 규칙 정리(eb92da90)가 "src 에 문자열로 안 나오는 클래스 = 안 쓰임"으로 판정해
//   ① 라이브러리가 붙이는 클래스(prosemirror-tables 의 selectedCell 등)와
//   ② 상태값을 이어 붙여 만드는 클래스(`is-${state}`, `apik-pill-${status}` …)의 규칙까지 지웠다.
//   결과: 표 칸을 끌어 골라도 선택이 안 보여 "드래그 선택이 안 된다", 상태 색 여러 곳이 사라짐(2026-09-29 발견).
//
// 무엇을 본다:
//   ① LIB_CLASSES 가 src 의 CSS 어딘가에 규칙으로 있어야 한다.
//   ② 코드의 className 템플릿에서 `접두-${…}` 꼴(접두 4자 이상, '-'로 끝남)을 모아,
//      그 접두로 시작하는 규칙이 CSS 에 하나도 없으면 실패. 이미 없던 것은 기준선(scripts/css-runtime-baseline.json)에 둔다.
//   새로 없어진 접두만 실패시킨다. 기준선 갱신: node scripts/check-css-runtime-classes.mjs --update
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "css-runtime-baseline.json");
const LIB_CLASSES = ["selectedCell", "column-resize-handle", "resize-cursor"];   // prosemirror-tables

const code = [], css = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f); const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|jsx)$/.test(f)) code.push([p, readFileSync(p, "utf8")]);
    else if (/\.css$/.test(f)) css.push(readFileSync(p, "utf8"));
  }
};
walk(join(ROOT, "src"));
const allCss = css.join("\n");

const problems = [];
for (const c of LIB_CLASSES) if (!allCss.includes(`.${c}`)) problems.push(`라이브러리 클래스 .${c} 의 규칙이 없음`);

const prefixes = new Map();   // 접두 → 처음 나온 파일
for (const [p, t] of code) {
  for (const m of t.matchAll(/className=\{`([^`]*)`\}/g)) {
    for (const k of m[1].matchAll(/(?:^|\s)([a-z][a-z0-9-]{2,}-)\$\{/g)) {
      if (!prefixes.has(k[1])) prefixes.set(k[1], p.replace(ROOT + "/", ""));
    }
  }
}
const missing = [...prefixes.keys()].filter((pre) => !allCss.includes(`.${pre}`)).sort();

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(missing, null, 2) + "\n");
  console.log(`기준선 갱신: 규칙 없는 접두 ${missing.length}개`);
  process.exit(0);
}
const base = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : []);
for (const pre of missing) if (!base.has(pre)) problems.push(`.${pre}* 규칙이 하나도 없음 — ${prefixes.get(pre)} 가 \`${pre}\${…}\` 로 만든다`);

if (problems.length) {
  console.error(`✗ 실행 중에 생기는 클래스의 스타일이 없다 ${problems.length}건:`);
  problems.forEach((x) => console.error(`   - ${x}`));
  console.error("  CSS 정리로 지운 거라면 되살린다. 정말 스타일이 필요 없으면 --update 로 기준선에 넣는다(사유는 커밋에).");
  process.exit(1);
}
console.log(`✓ 실행 중 클래스 스타일: 라이브러리 ${LIB_CLASSES.length}개·이어 붙인 접두 ${prefixes.size}개 확인 (기준선 ${base.size})`);
