#!/usr/bin/env node
// Apply a Supabase migration (or run a verification query) via the Supabase
// Management API. The PAT is never hard-coded here or passed on the command
// line — it is read from the SUPABASE_ACCESS_TOKEN env var, or from the
// gitignored `.env.supabase.local` file at the repo root.
//
// Usage:
//   node scripts/apply-supabase-migration.mjs supabase/migrations/<file>.sql [more.sql ...]
//   node scripts/apply-supabase-migration.mjs --query "select 1;"
//
// Project ref defaults to the OwnerView project and can be overridden with
// SUPABASE_PROJECT_REF. Exit code is non-zero on the first failure.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";

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
  } catch {
    /* fall through */
  }
  return null;
}

async function runSql(pat, sql, label) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ ${label} — HTTP ${res.status}\n${text}`);
    return false;
  }
  console.log(`✓ ${label}`);
  if (text && text.trim() && text.trim() !== "[]") console.log(text);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: apply-supabase-migration.mjs <file.sql ...> | --query <sql>");
    process.exit(2);
  }
  const pat = readPat();
  if (!pat) {
    console.error(
      "No PAT. Set SUPABASE_ACCESS_TOKEN or create .env.supabase.local (gitignored).",
    );
    process.exitCode = 2;
    return;
  }

  if (args[0] === "--query") {
    const ok = await runSql(pat, args.slice(1).join(" "), "query");
    process.exitCode = ok ? 0 : 1;
    return;
  }

  for (const file of args) {
    const sql = readFileSync(resolve(REPO_ROOT, file), "utf8");
    const ok = await runSql(pat, sql, file);
    if (!ok) {
      process.exitCode = 1;
      return;
    }
  }
}

// Set exitCode (don't force process.exit) so stdout fully flushes before the
// process tears down — process.exit() races libuv on Windows piped stdout.
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
