#!/usr/bin/env node
// Deploy a Supabase Edge Function via the official supabase CLI (정공 경로).
// PAT 는 SUPABASE_ACCESS_TOKEN env 또는 gitignored `.env.supabase.local` 에서 읽어
// CLI 프로세스 env 로만 전달한다 (커맨드라인/로그 노출 없음).
//
// Usage:
//   node scripts/deploy-edge-cli.mjs <function-slug> [--no-use-api]
//   ex) node scripts/deploy-edge-cli.mjs codef-sync
//
// 배경: scripts/deploy-edge-function.mjs (Management API PATCH) 는 metadata 만 갱신하고
// eszip bundle 을 안 바꿔 BOOT_ERROR 회귀 위험 → DEPRECATED. 이 스크립트가 CLI 정공 배포.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const useApi = !args.includes("--no-use-api");
if (!slug) {
  console.error("Usage: node scripts/deploy-edge-cli.mjs <function-slug> [--no-use-api]");
  process.exit(1);
}
const pat = readPat();
if (!pat) {
  console.error("SUPABASE_ACCESS_TOKEN not found (env or .env.supabase.local)");
  process.exit(1);
}

const cliArgs = ["-y", "supabase", "functions", "deploy", slug, "--project-ref", PROJECT_REF];
if (useApi) cliArgs.push("--use-api"); // Docker 불필요 — API 번들링

console.log(`→ npx ${cliArgs.join(" ")}`);
const res = spawnSync("npx", cliArgs, {
  cwd: REPO_ROOT,
  stdio: "inherit",
  shell: process.platform === "win32", // Windows: npx.cmd 해석
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: pat },
});
process.exit(res.status ?? 1);
