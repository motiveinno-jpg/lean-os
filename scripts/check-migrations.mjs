#!/usr/bin/env node
// P0-3: 코드↔DB 마이그레이션 적용상태 게이트.
//   `supabase/migrations/*.sql` 파일 ↔ `applied_migrations` ledger 를 diff.
//   ledger 부트스트랩 마이그(20260520010000_applied_migrations_ledger)보다 새로운
//   파일 중 미적용이 1건이라도 있으면 EXIT 1 + 목록 출력 → CI/배포 게이트로.
//
// Usage:
//   node scripts/check-migrations.mjs            # exit 1 on any pending
//   node scripts/check-migrations.mjs --json     # JSON 출력 (CI 친화)
//   node scripts/check-migrations.mjs --strict   # 부트스트랩 이전 파일도 검사

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

async function fetchApplied(pat) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "SELECT version FROM public.applied_migrations;" }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    // 테이블 미존재 시 부트스트랩 자체가 미적용
    if (/relation .* does not exist/i.test(text)) return null;
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const data = JSON.parse(text);
  return new Set(data.map((r) => r.version));
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

  const applied = await fetchApplied(pat).catch((e) => { console.error(e.message); return null; });

  if (applied === null) {
    // ledger 자체 미적용 — 부트스트랩만 pending 으로 보고하고 종료.
    const out = { ok: false, pending: [LEDGER_BOOTSTRAP], note: "ledger bootstrap not yet applied" };
    console.log(json ? JSON.stringify(out, null, 2) : `❌ ledger bootstrap not applied: apply ${LEDGER_BOOTSTRAP}.sql`);
    process.exitCode = 1;
    return;
  }

  // 부트스트랩 이전 파일은 default 로 검사 제외(베이스라인). --strict 면 전체 검사.
  const candidates = strict ? files : files.filter((f) => f >= LEDGER_BOOTSTRAP);
  const pending = candidates.filter((f) => !applied.has(f));
  const total = files.length;
  const out = {
    ok: pending.length === 0,
    total_files: total,
    applied_count: applied.size,
    checked: candidates.length,
    pending,
  };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else if (pending.length === 0) {
    console.log(`✓ all ${candidates.length} migrations applied (ledger has ${applied.size} rows, ${total} files in repo)`);
  } else {
    console.log(`❌ ${pending.length} migration(s) NOT applied to prod (코드 푸시 ≠ DB 적용 게이트):`);
    pending.forEach((p) => console.log(`   - ${p}.sql`));
    console.log(`\n적용: node scripts/apply-supabase-migration.mjs supabase/migrations/<file>.sql`);
  }

  process.exitCode = pending.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
