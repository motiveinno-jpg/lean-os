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

console.log(await sql("SELECT policyname, cmd, permissive, qual, with_check FROM pg_policies WHERE tablename='chat_channels' ORDER BY policyname;"));
console.log("---");
console.log(await sql("SELECT policyname, cmd, permissive, qual, with_check FROM pg_policies WHERE tablename='chat_members' ORDER BY policyname;"));
