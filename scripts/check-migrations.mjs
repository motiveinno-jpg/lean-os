#!/usr/bin/env node
// P0-3: 코드↔DB 마이그레이션 적용상태 게이트 (2026-07-22 reconcile 정합 수정).
//   단일 신뢰기준 = Supabase 공식 ledger `supabase_migrations.schema_migrations`(타임스탬프).
//   커스텀 `public.applied_migrations`(파일명)는 보조. 형식이 달라 과거 133건 거짓 pending 났음.
//   → 타임스탬프 프리픽스로 정규화(scripts/migration-ledger.mjs reconcile)해 거짓실패/거짓성공 제거.
//   두 ledger 충돌(drift)은 리포트만 하고, ledger backfill 은 별도 리뷰·승인 후 수행(여기선 하지 않음).
//
// Usage:
//   node scripts/check-migrations.mjs            # exit 1 on any true pending
//   node scripts/check-migrations.mjs --json
//   node scripts/check-migrations.mjs --strict   # 부트스트랩 이전 파일도 검사

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile } from "./migration-ledger.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "supabase/migrations");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const LEDGER_BOOTSTRAP = "20260520010000_applied_migrations_ledger";

function readPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const raw = readFileSync(resolve(REPO_ROOT, ".env.supabase.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^(?:SUPABASE_ACCESS_TOKEN\s*=\s*)?(.+)$/);
      if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* fall through */ }
  return null;
}

async function query(pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const json = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const pat = readPat();
  if (!pat) {
    console.error("No PAT (set SUPABASE_ACCESS_TOKEN or .env.supabase.local).");
    process.exitCode = 2;
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/i, ""))
    .sort();

  // 1차: 공식 ledger. version(적용시각) + name(파일 접미사) 둘 다 로드 — name 이 파일 매칭 핵심키.
  //   조회 실패 시 게이트 실패 처리 — 거짓 성공 방지.
  let schemaVersions, schemaNames;
  try {
    const rows = await query(pat, "SELECT version, name FROM supabase_migrations.schema_migrations;");
    schemaVersions = new Set(rows.map((r) => String(r.version)));
    schemaNames = new Set(rows.filter((r) => r.name != null).map((r) => String(r.name)));
  } catch (e) {
    console.error(`❌ 공식 ledger(schema_migrations) 조회 실패 — 게이트 통과 불가: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  // 2차(보조): 커스텀 ledger. 없어도 치명 아님(공식으로 판정).
  let appliedVersions = new Set();
  try {
    const rows = await query(pat, "SELECT version FROM public.applied_migrations;");
    appliedVersions = new Set(rows.map((r) => String(r.version)));
  } catch { /* legacy ledger 없음 — 공식만으로 판정 */ }

  const r = reconcile(files, schemaVersions, appliedVersions, LEDGER_BOOTSTRAP, strict, schemaNames);
  const out = {
    ok: r.ok,
    total_files: files.length,
    schema_ledger_count: schemaVersions.size,
    schema_name_count: schemaNames.size,
    applied_ledger_count: appliedVersions.size,
    checked: r.checked,
    pending: r.pending,
    drift: r.drift,
  };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    if (r.drift.schema_only.length) {
      console.log(`ℹ️ drift: 공식 ledger 엔 있으나 커스텀 applied_migrations 미기록 ${r.drift.schema_only.length}건 (공식 신뢰 — 정상, backfill 은 승인 후).`);
    }
    if (r.drift.applied_only.length) {
      console.log(`⚠️ 충돌: 커스텀 ledger 엔 있으나 공식 schema_migrations 엔 없음 ${r.drift.applied_only.length}건 — 조사 필요:`);
      r.drift.applied_only.forEach((p) => console.log(`   - ${p}`));
    }
    if (r.ok) {
      console.log(`✓ all ${r.checked} migrations applied (공식 ${schemaVersions.size} / 커스텀 ${appliedVersions.size} / 파일 ${files.length}).`);
    } else {
      console.log(`❌ ${r.pending.length} migration(s) 미적용(공식·커스텀 어디에도 없음):`);
      r.pending.forEach((p) => console.log(`   - ${p}.sql`));
      console.log(`\n적용: node scripts/apply-supabase-migration.mjs supabase/migrations/<file>.sql (SQL+ledger 원자적 기록)`);
    }
  }

  process.exitCode = r.ok ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
