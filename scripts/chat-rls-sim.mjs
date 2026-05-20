#!/usr/bin/env node
// S1 후속 prod authed sim — chat 채널 생성·DM 직후 본인 SELECT 가시성 확인.
// 모든 INSERT 는 ROLLBACK.

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
  } catch { /* ignore */ }
  return null;
}

async function sql(pat, q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    },
  );
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: [] }; }
}

async function main() {
  const pat = readPat();
  if (!pat) { console.error("No PAT"); process.exitCode = 2; return; }

  // 1) 적당한 employee 사용자 한 명 잡기
  const userRes = await sql(pat, "SELECT u.id, u.auth_id, u.company_id FROM users u WHERE u.role IN ('employee','admin','owner') AND u.auth_id IS NOT NULL AND u.company_id IS NOT NULL LIMIT 1;");
  if (!userRes.ok || !userRes.data?.[0]) { console.error("no test user"); process.exitCode = 1; return; }
  const u = userRes.data[0];
  console.log("test user:", u);

  // 2) 새 RLS 헬퍼 동작 확인
  const helperRes = await sql(pat,
    `SELECT n.nspname, p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.proname='is_channel_member' AND n.nspname='public';`);
  console.log("is_channel_member:", JSON.stringify(helperRes.data));

  // 3) authed 컨텍스트에서 chat_channels.INSERT + chat_members.INSERT + SELECT 동작
  //    deal 채널 (RESTRICTIVE 적용 대상) — 만든 사람이 보이는지.
  const sim1 = await sql(pat, `
BEGIN;
SET LOCAL statement_timeout='8000';
SET LOCAL request.jwt.claims='{"sub":"${u.auth_id}","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- 시뮬레이션: deal 채널 생성 + 본인 chat_members 등록
WITH new_ch AS (
  INSERT INTO public.chat_channels (company_id, name, type)
  VALUES ('${u.company_id}', 'SIM_DEAL_CH', 'deal')
  RETURNING id
), ins_member AS (
  INSERT INTO public.chat_members (channel_id, user_id, role)
  SELECT id, '${u.id}', 'OWNER' FROM new_ch
  RETURNING channel_id
)
SELECT
  (SELECT count(*) FROM public.chat_channels WHERE id = (SELECT id FROM new_ch)) AS deal_visible,
  (SELECT count(*) FROM public.chat_members WHERE channel_id = (SELECT id FROM new_ch)) AS members_visible;
ROLLBACK;`);
  console.log("\n[sim1] deal channel + member INSERT, SELECT under RLS:");
  console.log(JSON.stringify(sim1, null, 2));

  // 4) DM 채널 (is_dm=true) — 본인+상대 둘 다 chat_members 등록 후 본인 SELECT
  const peerRes = await sql(pat, `SELECT id FROM public.users WHERE company_id='${u.company_id}' AND id <> '${u.id}' LIMIT 1;`);
  const peer = peerRes.data?.[0]?.id;
  if (peer) {
    const sim2 = await sql(pat, `
BEGIN;
SET LOCAL statement_timeout='8000';
SET LOCAL request.jwt.claims='{"sub":"${u.auth_id}","role":"authenticated"}';
SET LOCAL ROLE authenticated;

WITH new_dm AS (
  INSERT INTO public.chat_channels (company_id, name, is_dm)
  VALUES ('${u.company_id}', 'SIM_DM', true)
  RETURNING id
), ins_me AS (
  INSERT INTO public.chat_members (channel_id, user_id, role)
  SELECT id, '${u.id}', 'member' FROM new_dm
  RETURNING channel_id
), ins_peer AS (
  INSERT INTO public.chat_members (channel_id, user_id, role)
  SELECT id, '${peer}', 'member' FROM new_dm
  RETURNING channel_id
), ins_part_me AS (
  INSERT INTO public.chat_participants (channel_id, user_id, role)
  SELECT id, '${u.id}', 'member' FROM new_dm
  RETURNING channel_id
), msg AS (
  INSERT INTO public.chat_messages (channel_id, sender_id, content, type)
  SELECT id, '${u.id}', 'hello DM', 'text' FROM new_dm
  RETURNING id
)
SELECT
  (SELECT count(*) FROM public.chat_channels WHERE id = (SELECT id FROM new_dm)) AS dm_visible,
  (SELECT count(*) FROM public.chat_members WHERE channel_id = (SELECT id FROM new_dm)) AS members_visible,
  (SELECT count(*) FROM public.chat_messages WHERE channel_id = (SELECT id FROM new_dm)) AS msg_visible;
ROLLBACK;`);
    console.log("\n[sim2] DM channel + 2 members + message, SELECT under RLS:");
    console.log(JSON.stringify(sim2, null, 2));
  } else {
    console.log("\n[sim2] no peer in same company, skipped");
  }

  // 5) 비멤버 컨텍스트에서 멤버 채널 SELECT 시도 → 0 행이어야 정상 (격리)
  const sim3 = await sql(pat, `
BEGIN;
SET LOCAL statement_timeout='8000';

-- 임시 채널 만들고 멤버 등록은 다른 사용자만
WITH new_ch AS (
  INSERT INTO public.chat_channels (company_id, name, type)
  VALUES ('${u.company_id}', 'SIM_OTHER_CH', 'deal')
  RETURNING id
), ins_other AS (
  INSERT INTO public.chat_members (channel_id, user_id, role)
  SELECT id, '${peer || u.id}', 'OWNER' FROM new_ch
  RETURNING channel_id
)
SELECT id FROM new_ch INTO TEMP TABLE _ch_id;

-- 이제 본인 컨텍스트에서 SELECT
SET LOCAL request.jwt.claims='{"sub":"${u.auth_id}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*) FROM public.chat_channels WHERE id = (SELECT id FROM _ch_id LIMIT 1)) AS should_be_zero;
ROLLBACK;`);
  console.log("\n[sim3] non-member SELECT (should be 0 if RLS works):");
  console.log(JSON.stringify(sim3, null, 2));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
