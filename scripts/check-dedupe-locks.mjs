#!/usr/bin/env node
// "있나 확인 → 없으면 넣기"를 잠금 없이 하는 DB 함수를 막는다.
//
// 왜: 같은 것이 두 번 생기는 사고의 공통 뿌리(2026-09-28 조사). 중복 방지를
//   `if exists (select …) then return null` / `if not exists (…) then insert …` 로 짜면
//   거의 동시에 온 두 요청(저장 연타·재시도·크론 겹침)이 둘 다 "없다"를 보고 둘 다 넣는다.
//   마이그 20260928270000 에서 기존 8곳(알림·카드·거래처·전표 초안 4·정산 전표)에 같은 키
//   잠금을 걸었다. 새로 만드는 함수도 같은 규칙을 지키게 기계가 본다.
//
// 규칙: 그 뒤에 추가된 마이그레이션의 plpgsql 본문에서
//   ① `if [not] exists (select` 가 있고 ② 같은 본문에 `insert into` 또는 `return null` 이 있으면
//   ③ `pg_advisory_xact_lock` 이 있어야 한다. 유일 인덱스(ON CONFLICT)로 막는 경우처럼
//   잠금이 필요 없으면 그 본문 안에 `-- dedupe-ok: <사유>` 를 적는다.
//
// 사용: node scripts/check-dedupe-locks.mjs   (preflight 에서 돈다)
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(REPO_ROOT, "supabase", "migrations");
const BASELINE = "20260928270000";   // 이 마이그(포함) 이전 파일은 이미 전수 점검함

export function findUnlockedChecks(sql) {
  const out = [];
  // $tag$ … $tag$ 본문을 모두 꺼낸다(함수·DO 블록)
  const re = /\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/g;
  for (const m of sql.matchAll(re)) {
    const body = m[2];
    const lower = body.toLowerCase();
    if (!/\bif\s+(not\s+)?exists\s*\(\s*select\b/.test(lower)) continue;
    if (!/\binsert\s+into\b/.test(lower) && !/\breturn\s+null\b/.test(lower)) continue;
    if (lower.includes("pg_advisory_xact_lock") || /--\s*dedupe-ok:\s*\S/.test(body)) continue;
    const head = sql.slice(Math.max(0, m.index - 300), m.index);
    const name = (head.match(/function\s+([\w.]+)\s*\([^)]*\)[^$]*$/i) || [])[1] || "(DO 블록)";
    out.push(name);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f.slice(0, 14) > BASELINE).sort();
  const bad = [];
  for (const f of files) {
    for (const name of findUnlockedChecks(readFileSync(join(DIR, f), "utf8"))) bad.push(`${f} · ${name}`);
  }
  if (bad.length) {
    console.error(`✗ 잠금 없는 '확인 → 넣기' ${bad.length}곳 — 동시 요청이면 두 번 들어간다:`);
    bad.forEach((b) => console.error(`   - ${b}`));
    console.error("  고치기: 확인 전에 perform pg_advisory_xact_lock(hashtextextended('<무엇>:' || <키>, 0));");
    console.error("  유일 인덱스로 막는 등 잠금이 필요 없으면 본문에 -- dedupe-ok: <사유>");
    process.exit(1);
  }
  console.log(`✓ '확인 → 넣기' 잠금 검사: ${files.length}개 새 마이그레이션, 문제 없음`);
}
