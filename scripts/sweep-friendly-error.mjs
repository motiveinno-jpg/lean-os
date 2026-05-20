#!/usr/bin/env node
// P0-E 일괄 변환: toast(... err?.message || "<fallback>" ...) 형태에서
// raw err.message 노출 → friendlyError(err, "<fallback>") 로 일괄 교체.
// 라벨은 그대로 유지, 원인 변환만 일관화.
//
// 안전 규칙:
//   - toast(...) 인자 안에서만 매칭
//   - 이미 friendlyError 사용 중인 라인은 건너뜀
//   - "use client" / "use server" / .ts / .tsx 모두 대상
//   - import 자동 삽입(파일에 friendlyError 없을 때만)
//   - 변경된 파일만 stdout 출력
//   - dry-run: --dry

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(REPO, "src");
const DRY = process.argv.includes("--dry");

const exts = new Set([".tsx", ".ts"]);
const skipDirs = new Set(["node_modules", ".next", "dist", "build"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (exts.has(name.slice(name.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

// 매칭: toast(...) 안에서 `<expr>?.message || "<msg>"` or `<expr>.message || "<msg>"`
// 또는 동일 패턴 with backticks. 보수적: toast( 줄 1줄 안에서만 변환.
const PATTERNS = [
  // toast(... <expr>?.message || "fallback" ...)
  { re: /toast\(([^)]*?)\b(\w+)\??\.message\s*\|\|\s*("([^"]+)"|'([^']+)'|`([^`]+)`)([^)]*?)\)/g,
    repl: (m, pre, name, _all, dq, sq, bq, post) => {
      const fallback = dq || sq || bq;
      // 이미 friendlyError 들어간 라인이면 건너뜀
      if (m.includes("friendlyError(")) return m;
      const quote = dq ? `"${fallback}"` : sq ? `'${fallback}'` : `\`${fallback}\``;
      return `toast(${pre}friendlyError(${name}, ${quote})${post})`;
    }
  },
];

let changedFiles = 0;
let totalReplacements = 0;

for (const file of walk(ROOT)) {
  let src = readFileSync(file, "utf8");
  let touched = false;
  let count = 0;

  for (const { re, repl } of PATTERNS) {
    const before = src;
    src = src.replace(re, (...args) => { const r = repl(...args); if (r !== args[0]) count++; return r; });
    if (src !== before) touched = true;
  }

  if (!touched) continue;

  // import 자동 추가
  if (!/from\s+["']@\/lib\/friendly-error["']/.test(src)) {
    // 첫 import 라인 찾기
    const m = src.match(/(\nimport\s[^;]+from\s+["'][^"']+["'];)/);
    if (m) {
      const idx = src.indexOf(m[1]) + m[1].length;
      src = src.slice(0, idx) + `\nimport { friendlyError } from "@/lib/friendly-error";` + src.slice(idx);
    } else {
      // import 가 아예 없는 파일이면 맨 앞에 추가 (use client 다음 줄)
      const uc = src.match(/^("use client"|"use server");?\s*\n/);
      if (uc) {
        src = src.replace(uc[0], uc[0] + `import { friendlyError } from "@/lib/friendly-error";\n`);
      } else {
        src = `import { friendlyError } from "@/lib/friendly-error";\n` + src;
      }
    }
  }

  if (!DRY) writeFileSync(file, src, "utf8");
  console.log(`${DRY ? "[dry]" : "✓"} ${file.replace(REPO + "/", "")}  (+${count})`);
  changedFiles++;
  totalReplacements += count;
}

console.log(`\n${DRY ? "[dry] would change" : "changed"} ${changedFiles} files, ${totalReplacements} replacements.`);
