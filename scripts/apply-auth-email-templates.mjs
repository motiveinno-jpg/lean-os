#!/usr/bin/env node
// Supabase Auth 메일(가입 확인·비밀번호 재설정) 템플릿을 저장소 파일로 덮어쓴다.
//   원본: supabase/templates/auth/*.html — 대시보드에서 직접 고치지 말고 파일을 고친 뒤 이 스크립트로 올린다.
//   링크는 {{ .SiteURL }}/api/auth/callback/?token_hash=… (src/app/api/auth/callback/route.ts 가 verifyOtp).
//   PAT 는 SUPABASE_ACCESS_TOKEN 환경변수에서만 읽는다.
//
// Usage: node scripts/apply-auth-email-templates.mjs [--dry]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN 이 없습니다."); process.exit(1); }

const read = (f) => readFileSync(resolve(ROOT, "supabase/templates/auth", f), "utf8");
const body = {
  mailer_subjects_confirmation: "[오너뷰] 이메일 주소를 확인해 주세요",
  mailer_templates_confirmation_content: read("confirmation.html"),
  mailer_subjects_recovery: "[오너뷰] 비밀번호 재설정 안내",
  mailer_templates_recovery_content: read("recovery.html"),
};

if (process.argv.includes("--dry")) { console.log(Object.keys(body).map((k) => `${k}: ${body[k].length}자`).join("\n")); process.exit(0); }

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error("실패", res.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
console.log("✓ 적용:", Object.keys(body).map((k) => `${k}=${String(j[k] ?? "").slice(0, 30)}`).join(" | "));
