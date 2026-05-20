import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = "njbvdkuvtdtkxyylwngn";
const raw = readFileSync(resolve(REPO_ROOT, ".env.supabase.local"), "utf8");
const pat = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith("#"))[0].replace(/^.*?=/,"").replace(/^["']|["']$/g,"");

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method:"POST", headers:{Authorization:`Bearer ${pat}`,"Content-Type":"application/json"},
      body:JSON.stringify({query:q})});
  return r.text();
}

// 1) 기존 채널 카운트 vs chat_members 없는 채널
console.log("총 채널:", await sql("SELECT count(*)::int AS n FROM chat_channels;"));
console.log("chat_members 0 인 채널:", await sql("SELECT count(*)::int AS n FROM chat_channels c WHERE NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id=c.id);"));
console.log("chat_participants 는 있고 chat_members 는 없는 채널:",
  await sql("SELECT count(*)::int AS n FROM chat_channels c WHERE EXISTS (SELECT 1 FROM chat_participants p WHERE p.channel_id=c.id) AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id=c.id);"));

// 2) is_dm 채널 카운트
console.log("DM 채널 총:", await sql("SELECT count(*)::int AS n FROM chat_channels WHERE is_dm=true;"));
console.log("deal 채널 총:", await sql("SELECT count(*)::int AS n FROM chat_channels WHERE type='deal' OR deal_id IS NOT NULL;"));

// 3) chat_channels 컬럼
console.log("chat_channels columns:",
  await sql("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='chat_channels' AND table_schema='public' ORDER BY ordinal_position;"));
