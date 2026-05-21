#!/usr/bin/env node
// Deploy a Supabase edge function via the Management API (전체 재배포).
//   사용자 승인 후만 호출 (룰: edge PATCH 금지, 전체 재배포만).
//
// Usage:
//   node scripts/deploy-edge-function.mjs <function-slug>
//   ex) node scripts/deploy-edge-function.mjs attendance-checkin
//
// PAT 는 .env.supabase.local 또는 SUPABASE_ACCESS_TOKEN env 에서 읽음.

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
    /* fall */
  }
  return null;
}

async function deploy(pat, slug) {
  const source = readFileSync(
    resolve(REPO_ROOT, `supabase/functions/${slug}/index.ts`),
    "utf8",
  );

  // Management API: PATCH /v1/projects/{ref}/functions/{slug}
  //   body 에 코드 본문 전송. PATCH 이지만 코드 전체를 보내므로 부분 패치가
  //   아닌 전체 재배포 (룰 준수).
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${slug}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: source,
        verify_jwt: true,
      }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ deploy ${slug} — HTTP ${res.status}\n${text}`);
    return false;
  }
  console.log(`✓ deployed ${slug}`);
  console.log(text);
  return true;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: deploy-edge-function.mjs <slug>");
    process.exit(2);
  }
  const pat = readPat();
  if (!pat) {
    console.error("No PAT. Set SUPABASE_ACCESS_TOKEN or create .env.supabase.local");
    process.exit(2);
  }
  const ok = await deploy(pat, slug);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
