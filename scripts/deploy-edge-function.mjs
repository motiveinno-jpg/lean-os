#!/usr/bin/env node
// ⚠️ DEPRECATED — Management API PATCH 는 함수 metadata 만 갱신하고
//   실제 eszip bundle 은 옛 버전 그대로 남아 BOOT_ERROR 회귀 위험.
//   (2026-05-21 attendance-checkin v2~v11 BOOT_ERROR 인시던트 사후 식별).
//
// 정공 deploy 는 supabase CLI 사용:
//   $ export SUPABASE_ACCESS_TOKEN=<PAT>
//   $ npx -y supabase functions deploy <slug> --project-ref <ref>
//   → eszip bundle 새로 빌드 + entrypoint_path 도 매 버전마다 새 디렉토리
//   → boot 안정성 보장
//
// 본 스크립트는 진단/메타데이터 확인 용으로만 유지. 실제 코드 배포에는
// supabase CLI 또는 Dashboard 사용 권장.
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
