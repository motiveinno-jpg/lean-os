#!/usr/bin/env node
// Supabase Auth 가 보내는 메일 전부(가입 확인·비밀번호 재설정·로그인 링크·이메일 변경·초대·본인 재확인·보안 알림 7종)를
//   오너뷰 한글 디자인으로 덮어쓴다. 틀은 supabase/templates/auth/layout.html 하나, 메일별 문구는 아래 MAILS.
//   대시보드에서 직접 고치지 말고 여기를 고친 뒤 올린다.
//   링크는 {{ .SiteURL }}/api/auth/callback/?token_hash=…&type=… — src/app/api/auth/callback/route.ts 가 verifyOtp 로 세션을 심는다.
//   PAT 는 SUPABASE_ACCESS_TOKEN 환경변수에서만 읽는다.
//
// Usage: node scripts/apply-auth-email-templates.mjs [--dry] [--out <dir>]   (--out: 완성된 HTML 을 파일로 떨궈 눈으로 확인)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const LAYOUT = readFileSync(resolve(ROOT, "supabase/templates/auth/layout.html"), "utf8");

const link = (type, next) => `{{ .SiteURL }}/api/auth/callback/?token_hash={{ .TokenHash }}&type=${type}&next=${encodeURIComponent(next)}`;
const button = (href, label) => `        <tr><td align="center" style="padding:28px 32px;">
          <a href="${href}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 36px;border-radius:10px;">${label}</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;font-size:13px;line-height:1.7;color:#71717a;">
          버튼이 눌리지 않으면 아래 주소를 복사해 브라우저 주소창에 붙여 넣으세요.<br>
          <a href="${href}" style="color:#4f46e5;word-break:break-all;">${href.replace(/&/g, "&amp;")}</a>
        </td></tr>`;
const code = (token) => `        <tr><td align="center" style="padding:24px 32px 28px;">
          <div style="display:inline-block;background:#f4f5fb;border:1px solid #e5e7f0;border-radius:10px;padding:14px 28px;font-size:28px;font-weight:800;letter-spacing:6px;font-family:Menlo,Consolas,monospace;color:#18181b;">${token}</div>
        </td></tr>`;
const spacer = `        <tr><td style="padding:0 0 24px;"></td></tr>`;
const resetHint = `본인이 한 일이 아니라면 바로 <a href="https://www.owner-view.com/auth/reset" style="color:#4f46e5;">비밀번호를 재설정</a>하고 creative@mo-tive.com 으로 알려 주세요.`;
const ONCE = "이 링크는 1시간 동안, 한 번만 쓸 수 있습니다.";

// key = Supabase 설정 이름의 가운데 토막 (mailer_subjects_<key> / mailer_templates_<key>_content)
const MAILS = {
  confirmation: {
    subject: "[오너뷰] 이메일 주소를 확인해 주세요",
    heading: "이메일 주소를 확인해 주세요",
    body: "오너뷰에 가입해 주셔서 감사합니다.<br>\n          아래 버튼을 누르면 가입이 끝나고 바로 회사 공간이 열립니다.",
    action: button(link("signup", "/auth/verify"), "가입 완료하기"),
    foot: `${ONCE}<br>\n          가입한 적이 없다면 이 메일은 무시하셔도 됩니다. 계정은 만들어지지 않습니다.`,
  },
  recovery: {
    subject: "[오너뷰] 비밀번호 재설정 안내",
    heading: "비밀번호를 새로 정해 주세요",
    body: "<b>{{ .Email }}</b> 계정의 비밀번호 재설정을 요청하셨습니다.<br>\n          아래 버튼을 누르면 새 비밀번호를 정하는 화면이 열립니다.",
    action: button(link("recovery", "/auth/reset?step=new"), "새 비밀번호 정하기"),
    foot: `${ONCE}<br>\n          요청한 적이 없다면 이 메일은 무시하세요. 비밀번호는 바뀌지 않습니다.`,
  },
  magic_link: {
    subject: "[오너뷰] 로그인 링크",
    heading: "버튼을 눌러 로그인하세요",
    body: "<b>{{ .Email }}</b> 계정으로 비밀번호 없이 로그인하는 링크입니다.",
    action: button(link("email", "/dashboard"), "오너뷰 로그인"),
    foot: `${ONCE}<br>\n          요청한 적이 없다면 이 메일은 무시하세요. 누군가 링크를 받지 않는 한 로그인되지 않습니다.`,
  },
  email_change: {
    subject: "[오너뷰] 이메일 주소 변경 확인",
    heading: "이메일 주소 변경을 확인해 주세요",
    body: "로그인 이메일을 <b>{{ .Email }}</b> 에서 <b>{{ .NewEmail }}</b> 로 바꾸는 요청이 들어왔습니다.<br>\n          아래 버튼을 눌러야 변경이 완료됩니다.",
    action: button(link("email_change", "/dashboard"), "이메일 변경 확인"),
    foot: `${ONCE}<br>\n          요청한 적이 없다면 버튼을 누르지 마세요. 이메일은 바뀌지 않습니다.`,
  },
  invite: {
    subject: "[오너뷰] 초대가 도착했습니다",
    heading: "오너뷰에 초대되었습니다",
    body: "<b>{{ .Email }}</b> 로 오너뷰 초대가 도착했습니다.<br>\n          아래 버튼을 누르면 계정이 만들어지고 바로 시작할 수 있습니다.",
    action: button(link("invite", "/auth/verify"), "초대 수락하기"),
    foot: `${ONCE}<br>\n          초대받을 일이 없다면 이 메일은 무시하셔도 됩니다.`,
  },
  reauthentication: {
    subject: "[오너뷰] 본인 확인 코드",
    heading: "본인 확인 코드",
    body: "중요한 설정을 바꾸기 전에 본인인지 한 번 더 확인합니다.<br>\n          화면에 아래 코드를 입력해 주세요.",
    action: code("{{ .Token }}"),
    foot: "코드는 1시간 동안 쓸 수 있습니다. 요청한 적이 없다면 이 메일은 무시하시고, 걱정되면 비밀번호를 바꿔 주세요.",
  },
  // ── 보안 알림 (지금은 꺼져 있음 — 켜면 이 문구로 나간다) ──
  password_changed_notification: {
    subject: "[오너뷰] 비밀번호가 변경되었습니다",
    heading: "비밀번호가 변경되었습니다",
    body: "<b>{{ .Email }}</b> 계정의 비밀번호가 방금 변경되었습니다.",
    action: spacer, foot: resetHint,
  },
  email_changed_notification: {
    subject: "[오너뷰] 로그인 이메일이 변경되었습니다",
    heading: "로그인 이메일이 변경되었습니다",
    body: "계정의 로그인 이메일이 <b>{{ .OldEmail }}</b> 에서 <b>{{ .Email }}</b> 로 변경되었습니다.",
    action: spacer, foot: resetHint,
  },
  phone_changed_notification: {
    subject: "[오너뷰] 휴대전화 번호가 변경되었습니다",
    heading: "휴대전화 번호가 변경되었습니다",
    body: "<b>{{ .Email }}</b> 계정의 휴대전화 번호가 <b>{{ .Phone }}</b> 로 변경되었습니다.",
    action: spacer, foot: resetHint,
  },
  identity_linked_notification: {
    subject: "[오너뷰] 새 로그인 방법이 연결되었습니다",
    heading: "새 로그인 방법이 연결되었습니다",
    body: "<b>{{ .Email }}</b> 계정에 <b>{{ .Provider }}</b> 로그인이 연결되었습니다. 이제 이 방법으로도 로그인할 수 있습니다.",
    action: spacer, foot: resetHint,
  },
  identity_unlinked_notification: {
    subject: "[오너뷰] 로그인 방법 연결이 해제되었습니다",
    heading: "로그인 방법 연결이 해제되었습니다",
    body: "<b>{{ .Email }}</b> 계정에서 <b>{{ .Provider }}</b> 로그인 연결이 해제되었습니다.",
    action: spacer, foot: resetHint,
  },
  mfa_factor_enrolled_notification: {
    subject: "[오너뷰] 2단계 인증 수단이 추가되었습니다",
    heading: "2단계 인증 수단이 추가되었습니다",
    body: "<b>{{ .Email }}</b> 계정에 2단계 인증 수단(<b>{{ .FactorType }}</b>)이 추가되었습니다.",
    action: spacer, foot: resetHint,
  },
  mfa_factor_unenrolled_notification: {
    subject: "[오너뷰] 2단계 인증 수단이 삭제되었습니다",
    heading: "2단계 인증 수단이 삭제되었습니다",
    body: "<b>{{ .Email }}</b> 계정에서 2단계 인증 수단(<b>{{ .FactorType }}</b>)이 삭제되었습니다.",
    action: spacer, foot: resetHint,
  },
};

const render = (m) => LAYOUT
  .replace("%%TITLE%%", m.subject.replace(/^\[오너뷰\]\s*/, "오너뷰 "))
  .replace("%%HEADING%%", m.heading)
  .replace("%%BODY%%", m.body)
  .replace("%%ACTION%%", m.action)
  .replace("%%FOOTNOTE%%", m.foot);

const body = {};
for (const [key, m] of Object.entries(MAILS)) {
  body[`mailer_subjects_${key}`] = m.subject;
  body[`mailer_templates_${key}_content`] = render(m);
}

const outIdx = process.argv.indexOf("--out");
if (outIdx > 0) {
  const dir = resolve(process.argv[outIdx + 1]);
  mkdirSync(dir, { recursive: true });
  for (const [key, m] of Object.entries(MAILS)) writeFileSync(resolve(dir, `${key}.html`), render(m));
  console.log(`→ ${dir} 에 ${Object.keys(MAILS).length}통`);
}
if (process.argv.includes("--dry") || outIdx > 0) { console.log(Object.keys(MAILS).map((k) => `${k}: ${MAILS[k].subject}`).join("\n")); process.exit(0); }

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN 이 없습니다."); process.exit(1); }
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error("실패", res.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
const bad = Object.keys(body).filter((k) => j[k] !== body[k]);
console.log(bad.length ? `⚠ 반영 안 된 항목: ${bad.join(", ")}` : `✓ ${Object.keys(MAILS).length}통 제목·본문 적용`);
