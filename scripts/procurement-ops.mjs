// 운영 연결용. 비밀값은 기존 gitignored 환경파일에서 읽고 값 자체는 출력하지 않는다.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const source =
  process.env.PROCUREMENT_ENV_SOURCE || resolve("../../motive-lean-os-qa");
function parse(s) {
  return Object.fromEntries(
    s.split(/\r?\n/).flatMap((l) => {
      const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l.trim());
      return m ? [[m[1], m[2].replace(/^["']|["']$/g, "")]] : [];
    }),
  );
}
const env = {};
for (const name of [".env.local", ".env.ai.local", ".env.supabase.local"]) {
  try {
    Object.assign(env, parse(await readFile(resolve(source, name), "utf8")));
  } catch {}
}
const project = JSON.parse(
  await readFile(resolve(source, ".vercel/project.json"), "utf8"),
);
const ref = "njbvdkuvtdtkxyylwngn";
async function req(url, token, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`운영 API ${r.status} (${new URL(url).hostname})`);
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}
const mode = process.argv[2] || "inspect";
if (mode === "inspect") {
  const secrets = await req(
    `https://api.supabase.com/v1/projects/${ref}/secrets`,
    env.SUPABASE_ACCESS_TOKEN,
  );
  const vars = await req(
    `https://api.vercel.com/v9/projects/${project.projectId}/env?teamId=${project.orgId}`,
    env.VERCEL_API_TOKEN,
  );
  process.stdout.write(
    JSON.stringify(
      {
        localConfigured: Object.keys(env).filter((k) =>
          /ANTHROPIC|RESEND|G2B|CRON/.test(k),
        ),
        edgeConfigured: secrets
          .map((x) => x.name)
          .filter((k) => /ANTHROPIC|RESEND|G2B|CRON|DATA/.test(k)),
        productionConfigured: vars.envs
          .map((x) => x.key)
          .filter((k) =>
            /SUPABASE|ANTHROPIC|RESEND|G2B|CRON|PROCUREMENT/.test(k),
          ),
      },
      null,
      2,
    ) + "\n",
  );
} else if (mode === "bootstrap-local") {
  const keys = await req(
    `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
    env.SUPABASE_ACCESS_TOKEN,
  );
  const service = keys.find((k) => k.name === "service_role");
  if (!service?.api_key) throw new Error("서버 인증키를 확인하지 못했습니다.");
  const wanted = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: service.api_key,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: env.RESEND_ADMIN_KEY,
    RESEND_FROM_EMAIL: "모티브 입찰 알림 <noreply@mo-tive.com>",
    PROCUREMENT_COMPANY_ID: "c361afb9-8a52-4cac-add9-8992f0f7c09c",
    PROCUREMENT_AI_MODEL: "claude-opus-5",
    PROCUREMENT_CRON_SECRET: env.CRON_SECRET,
    CRON_SECRET: env.CRON_SECRET,
    PROCUREMENT_G2B_PROXY: "true",
  };
  if (!wanted.ANTHROPIC_API_KEY || !wanted.RESEND_API_KEY)
    throw new Error("AI/메일 기존 인증키를 확인하지 못했습니다.");
  await writeFile(
    resolve(".env.local"),
    Object.entries(wanted)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  process.stdout.write("로컬 연결 환경 작성 완료 (비밀값 출력 없음)\n");
} else if (mode === "deployment-status") {
  const result = await req(`https://api.vercel.com/v6/deployments?projectId=${project.projectId}&teamId=${project.orgId}&limit=5&target=production`,env.VERCEL_API_TOKEN);
  process.stdout.write(JSON.stringify(result.deployments.map(d=>({id:d.uid,state:d.state,url:d.url,sha:d.meta?.githubCommitSha})))+"\n");
} else if (mode === "mail-status") {
  const receipt=JSON.parse(await readFile("deliverables/procurement/live-check/mail-connection-receipt.json","utf8"));
  const result=await req(`https://api.resend.com/emails/${receipt.id}`,env.RESEND_ADMIN_KEY);
  process.stdout.write(JSON.stringify({id:result.id,last_event:result.last_event,to:result.to})+"\n");
} else if (mode === "models") {
  const result = await req(
    "https://api.anthropic.com/v1/models",
    env.ANTHROPIC_API_KEY,
    {
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    },
  );
  process.stdout.write(JSON.stringify(result.data.map((x) => x.id)) + "\n");
} else if (mode === "mail-domains") {
  const result = await req(
    "https://api.resend.com/domains",
    env.RESEND_ADMIN_KEY,
  );
  process.stdout.write(
    JSON.stringify(
      result.data.map((d) => ({ name: d.name, status: d.status })),
    ) + "\n",
  );
} else if (mode === "mail-test") {
  const receiptPath = resolve(
    "deliverables/procurement/live-check/mail-connection-receipt.json",
  );
  const result = await req(
    "https://api.resend.com/emails",
    env.RESEND_ADMIN_KEY,
    {
      method: "POST",
      headers: { "Idempotency-Key": "motive-procurement-connection-20261001" },
      body: JSON.stringify({
        from: "모티브 입찰 알림 <noreply@mo-tive.com>",
        to: ["ksc@mo-tive.com"],
        subject: "[모티브 입찰 자동화] 메일 연결 확인",
        text: "요청하신 입찰 알림 수신 주소 연결 시험입니다. 수신 주소: ksc@mo-tive.com. 나라장터 공고 수집 권한과 AI 분석을 검증하고 있습니다. 이 메일은 실제 입찰 추천 목록이 아닙니다. 자동 정기 발송은 검증 후 활성화합니다.",
      }),
    },
  );
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        id: result.id,
        to: "ksc@mo-tive.com",
        acceptedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.stdout.write(
    `메일 제공사 발송 접수 확인: ksc@mo-tive.com / ${result.id}\n`,
  );
} else if (mode === "proxy-auth") {
  const local = parse(await readFile(".env.local", "utf8"));
  const secret =
    local.PROCUREMENT_PROXY_SECRET || randomBytes(32).toString("hex");
  await req(
    `https://api.supabase.com/v1/projects/${ref}/secrets`,
    env.SUPABASE_ACCESS_TOKEN,
    {
      method: "POST",
      body: JSON.stringify([
        { name: "PROCUREMENT_PROXY_SECRET", value: secret },
      ]),
    },
  );
  local.PROCUREMENT_PROXY_SECRET = secret;
  await writeFile(
    ".env.local",
    Object.entries(local)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  process.stdout.write("입찰 프록시 전용 인증키 연결 완료 (값 비공개)\n");
} else if (mode === "db-inspect") {
  const result = await req(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    env.SUPABASE_ACCESS_TOKEN,
    {
      method: "POST",
      body: JSON.stringify({
        query:
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'procurement_%' ORDER BY table_name",
      }),
    },
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} else if (mode === "configure-production") {
  const local = parse(await readFile(".env.local", "utf8"));
  if (!local.PROCUREMENT_RESEND_SCOPED) {
    const domains = await req(
      "https://api.resend.com/domains",
      env.RESEND_ADMIN_KEY,
    );
    const domain = domains.data.find(
      (d) => d.name === "mo-tive.com" && d.status === "verified",
    );
    if (!domain) throw new Error("모티브 발신 도메인 인증 필요");
    const key = await req(
      "https://api.resend.com/api-keys",
      env.RESEND_ADMIN_KEY,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Motive procurement alerts",
          permission: "sending_access",
          domain_id: domain.id,
        }),
      },
    );
    local.RESEND_API_KEY = key.token;
    local.PROCUREMENT_RESEND_SCOPED = "true";
    if (!key.token) throw new Error("발신 전용 메일 인증키 생성 실패");
    await writeFile(
      ".env.local",
      Object.entries(local)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
  }
  const wanted = Object.fromEntries(
    [
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "PROCUREMENT_COMPANY_ID",
      "PROCUREMENT_AI_MODEL",
      "PROCUREMENT_PROXY_SECRET",
      "PROCUREMENT_G2B_PROXY",
    ].map((k) => [k, local[k]]),
  );
  wanted.PROCUREMENT_SCHEDULER_ENABLED = "true";
  const url = `https://api.vercel.com/v10/projects/${project.projectId}/env?teamId=${project.orgId}&upsert=true`;
  for (const [key, value] of Object.entries(wanted)) {
    if (!value) throw new Error(`연결 설정 누락: ${key}`);
    await req(url, env.VERCEL_API_TOKEN, {
      method: "POST",
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production"],
      }),
    });
  }
  process.stdout.write(
    "운영 AI·모티브 발신 전용 메일·작업 실행 설정 연결 완료. 공고 자동수집/정기발송 설정은 비활성 유지.\n",
  );
} else if (mode === "import-source") {
  const local = parse(await readFile(".env.local", "utf8"));
  const companyId = "c361afb9-8a52-4cac-add9-8992f0f7c09c";
  const headers = { apikey: local.SUPABASE_SERVICE_ROLE_KEY };
  const companies = await req(
    `${local.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/companies?id=eq.${companyId}&select=id,business_number`,
    local.SUPABASE_SERVICE_ROLE_KEY,
    { headers },
  );
  if (companies.length !== 1)
    throw new Error("모티브 회사 정보를 확인하지 못했습니다.");
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": resolve("src") } },
  });
  try {
    const { parseEvidenceImport } = await server.ssrLoadModule(
      "/src/lib/procurement/validation.ts",
    );
    const { fingerprint } = await server.ssrLoadModule(
      "/src/lib/procurement/fingerprint.ts",
    );
    const bundle = JSON.parse(
      await readFile(
        "deliverables/procurement/company-source/모티브_실적분석_가져오기.json",
        "utf8",
      ),
    );
    const items = parseEvidenceImport(bundle, companies[0].business_number);
    const result = await req(
      `${local.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/procurement_import_evidence`,
      local.SUPABASE_SERVICE_ROLE_KEY,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_company: companyId,
          p_user: null,
          p_items: items.map((e) => ({
            payload: e,
            import_key: fingerprint({
              category: e.category,
              title: e.title,
              text: e.text,
              source: e.source,
              project: e.project || null,
            }),
          })),
        }),
      },
    );
    process.stdout.write(
      `실제 회사 사업자번호 대조 및 미검증 근거 ${result}건 가져오기 완료\n`,
    );
  } finally {
    await server.close();
  }
} else if (mode === "provision") {
  const query = async (sql) =>
    req(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      env.SUPABASE_ACCESS_TOKEN,
      { method: "POST", body: JSON.stringify({ query: sql }) },
    );
  for (const [table, file] of [
    ["procurement_settings", "20260930170000_procurement_foundation.sql"],
    ["procurement_jobs", "20261001140000_procurement_ai_jobs.sql"],
  ]) {
    const result = await query(
      `SELECT to_regclass('public.${table}') AS present`,
    );
    if (!result[0].present)
      await query(await readFile(resolve("supabase/migrations", file), "utf8"));
    const verification = await query(
      `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='${table}' AND relrowsecurity`,
    );
    if (verification[0].n !== 1)
      throw new Error("입찰 마이그레이션 RLS 확인 실패");
    await query(
      `INSERT INTO public.applied_migrations(version) VALUES('${file.replace(/\.sql$/, "")}') ON CONFLICT(version) DO NOTHING`,
    );
  }
  await query(
    `INSERT INTO public.procurement_settings(company_id,settings) VALUES('c361afb9-8a52-4cac-add9-8992f0f7c09c','{"keywords":["홍보"],"recipients":["ksc@mo-tive.com"],"digestHour":8,"digestEnabled":false,"collectionEnabled":false,"minimumScore":75}'::jsonb) ON CONFLICT(company_id) DO UPDATE SET settings=procurement_settings.settings||'{"recipients":["ksc@mo-tive.com"]}'::jsonb,updated_at=now(); INSERT INTO public.feature_rollout(feature,company_id,note) VALUES('procurement','c361afb9-8a52-4cac-add9-8992f0f7c09c','모티브 사용자 요청 입찰 자동화') ON CONFLICT DO NOTHING;`,
  );
  process.stdout.write(
    "입찰 운영 테이블·모티브 기능 범위·ksc@mo-tive.com 수신 설정 저장 완료. 자동발송은 검증 후 활성화.\n",
  );
} else if (mode === "deploy-g2b") {
  for (const args of [
    [
      "--yes",
      "supabase",
      "secrets",
      "set",
      "PROCUREMENT_COMPANY_ID=c361afb9-8a52-4cac-add9-8992f0f7c09c",
      "--project-ref",
      ref,
    ],
    [
      "--yes",
      "supabase",
      "functions",
      "deploy",
      "procurement-g2b",
      "--project-ref",
      ref,
      "--no-verify-jwt",
    ],
  ]) {
    const r = spawnSync("npx", args, {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN },
      stdio: "inherit",
    });
    if (r.status !== 0) process.exit(r.status || 1);
  }
} else throw new Error("지원하지 않는 작업");
