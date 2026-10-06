#!/usr/bin/env node
// 세무대리인 쓰기 가드(advisor_ro_ins/upd/del)는 반드시 RESTRICTIVE 로 만든다 — 2026-10-06 사고 재발 방지.
//   PERMISSIVE 로 만들면 회사 격리 정책과 OR 로 묶여 "세무대리인 아님 = 통과"가 되어, 아무 회사 앞으로 행을 넣을 수 있다
//   (20260824020000 에서 한 번, 20261006110000 에서 23개 표를 다시 고쳤다).
//   검사: CUTOFF 이후 마이그레이션의 `create policy advisor_ro_*` 문장에 `as restrictive` 가 없으면 실패.
//   CUTOFF 이전 파일의 잘못은 20261006110000 이 운영에서 고쳤으므로 보지 않는다.
//
// Usage: node scripts/check-rls-advisor-restrictive.mjs
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const CUTOFF = "20261006110000";

const bad = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  if (f.slice(0, 14) <= CUTOFF) continue;
  const sql = readFileSync(resolve(DIR, f), "utf8");
  //   문장 단위(세미콜론·format 문자열 끝)로 끊어 본다 — execute format('create policy advisor_ro_ins on ... as restrictive ...') 도 잡힌다
  const re = /create\s+policy\s+"?(advisor_ro_\w+)"?[\s\S]*?(?:;|'\s*,|'\s*\))/gi;
  let m;
  while ((m = re.exec(sql))) {
    if (!/\bas\s+restrictive\b/i.test(m[0])) bad.push(`${f}: ${m[1]}`);
  }
}

if (bad.length) {
  console.error(`❌ advisor_ro_* 정책에 'as restrictive' 가 없습니다 (${bad.length}건) — 회사 격리가 뚫립니다:`);
  bad.forEach((b) => console.error(`   - ${b}`));
  console.error(`   정본: create policy advisor_ro_ins on public.<표> as restrictive for insert to authenticated with check (not (select public.is_advisor_session()));`);
  process.exitCode = 1;
} else {
  console.log("✓ advisor_ro_* 정책은 모두 restrictive");
}
