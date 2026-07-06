#!/usr/bin/env node
// DB 가드 실존 스모크 (2026-07-06) — 클라이언트 테스트가 못 잡는 Postgres 트리거 안전장치가
//   프로덕션에서 살아있는지 확인. 사라지면 조용한 데이터 사고가 되는 것들:
//     - trg_settlement_prevent_overmatch : 정산 과배분 차단 (한 출금이 여러 송장에 초과 확정)
//     - trg_settlement_post_voucher / _void_voucher : 정산 확정 시 분개전표 자동기장/취소 무효
//     - trg_settlement_clear_stale : 확정 시 stale 제안 자동반려
//     - trg_card_tx_prevent_dup : 카드거래 재동기화 중복 차단
//     - card_tx_autolink : CODEF 카드거래 → corporate_card 자동 연결
//
// Usage: node scripts/db-guards-smoke.mjs   (exit 1 = 가드 유실)
// CI: preflight.yml 에서 SUPABASE_ACCESS_TOKEN 시크릿으로 실행.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";

const REQUIRED_TRIGGERS = [
  ["invoice_settlements", "trg_settlement_prevent_overmatch"],
  ["invoice_settlements", "trg_settlement_post_voucher"],
  ["invoice_settlements", "trg_settlement_void_voucher"],
  ["invoice_settlements", "trg_settlement_clear_stale"],
  ["card_transactions", "trg_card_tx_prevent_dup"],
  ["card_transactions", "card_tx_autolink"],
];

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

async function main() {
  const pat = readPat();
  if (!pat) {
    console.error("No PAT (set SUPABASE_ACCESS_TOKEN or .env.supabase.local).");
    process.exitCode = 2;
    return;
  }
  const sql = `select c.relname as tbl, t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relname in ('invoice_settlements','card_transactions')`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`Management API error: ${res.status} ${await res.text()}`);
    process.exitCode = 2;
    return;
  }
  const rows = await res.json();
  const have = new Set(rows.map((r) => `${r.tbl}.${r.tgname}`));
  const missing = REQUIRED_TRIGGERS.filter(([tbl, tg]) => !have.has(`${tbl}.${tg}`));
  if (missing.length) {
    console.error("❌ DB 가드 유실:");
    for (const [tbl, tg] of missing) console.error(`   - ${tbl}.${tg}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ DB guards OK — ${REQUIRED_TRIGGERS.length}/${REQUIRED_TRIGGERS.length} critical triggers present`);
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
