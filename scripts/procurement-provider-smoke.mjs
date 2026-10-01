// 실제 제공사 연결 시험. synthetic 입력만 AI에 보내며 운영 DB에는 쓰지 않는다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
if (!globalThis.WebSocket) globalThis.WebSocket = (await import("ws")).WebSocket;
function parse(s) {
  return Object.fromEntries(
    s.split(/\r?\n/).flatMap((l) => {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
      if (!m) return [];
      let v = m[2];
      try {
        v = JSON.parse(v);
      } catch {}
      return [[m[1], v]];
    }),
  );
}
Object.assign(process.env, parse(await readFile(".env.local", "utf8")));
const out = resolve("deliverables/procurement/live-check");
await mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { "@": resolve("src") } },
});
try {
  if (process.argv[2] === "g2b") {
    const { fetchG2bNotices } = await server.ssrLoadModule(
      "/src/lib/procurement/g2b.ts",
    );
    const notices = await fetchG2bNotices(
      ["홍보"],
      "edge-proxy",
      new Date(),
      async (input, init) => {
        const parameters = Object.fromEntries(
          new URL(String(input)).searchParams,
        );
        delete parameters.serviceKey;
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/procurement-g2b`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.PROCUREMENT_PROXY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              companyId: process.env.PROCUREMENT_COMPANY_ID,
              parameters,
            }),
            signal: init?.signal,
          },
        );
        if (!response.ok) {
          const diagnostic = await response
            .clone()
            .json()
            .catch(() => ({}));
          process.stdout.write(
            JSON.stringify({
              status: response.status,
              upstreamStatus: diagnostic.upstreamStatus,
              reasonCode: diagnostic.reasonCode,
              errorKind: diagnostic.errorKind,
              error: diagnostic.error,
            }) + "\n",
          );
        }
        return response;
      },
    );
    await writeFile(
      resolve(out, "나라장터_실응답.json"),
      JSON.stringify(notices, null, 2),
    );
    process.stdout.write(
      `PASS: 나라장터 홍보 최근7일 ${notices.length}건 정규화\n`,
    );
  } else if (process.argv[2] === "workspace") {
    const { createClient } = await import("@supabase/supabase-js");
    const { workspace } = await server.ssrLoadModule(
      "/src/lib/procurement/server.ts",
    );
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const ws = await workspace(db, process.env.PROCUREMENT_COMPANY_ID);
    if (
      !ws.ready ||
      ws.settings.recipients[0] !== "ksc@mo-tive.com" ||
      ws.evidence.length !== 28
    )
      throw new Error("운영 입찰 회사·자료·수신 설정 불일치");
    process.stdout.write(
      JSON.stringify({
        ready: ws.ready,
        evidence: ws.evidence.length,
        members: ws.workforce.members.length,
        recipients: ws.settings.recipients,
        integration: ws.integration,
      }) + "\n",
    );
  } else {
    const { callProcurementAI } = await server.ssrLoadModule(
      "/src/lib/procurement/ai.ts",
    );
    const { fixtureWorkspace, notice } = await server.ssrLoadModule(
      "/src/lib/procurement/__tests__/fixtures.ts",
    );
    const ws = fixtureWorkspace();
    const result = await callProcurementAI(
      process.argv[2] === "proposal" ? "proposal" : "analysis",
      notice,
      ws,
      "가상 검증 공고. 실제 사업 수행이나 증빙 확정을 주장하지 말 것.",
      async (url, options) => {
        const response = await fetch(url, options);
        if (response.ok)
          await writeFile(
            resolve(out, `synthetic-${process.argv[2]}-provider.json`),
            await response.clone().text(),
          );
        return response;
      },
    );
    await writeFile(
      resolve(out, `synthetic-${process.argv[2] || "analysis"}.json`),
      JSON.stringify(result, null, 2),
    );
    if (process.argv[2] === "proposal") {
      const { proposalMarkdown, proposalDocx, proposalPrintHtml } =
        await server.ssrLoadModule("/src/lib/procurement/documents.ts");
      const markdown = proposalMarkdown(result.data, notice, ws);
      await writeFile(
        resolve(out, "검증용_제안서.docx"),
        await proposalDocx(markdown),
      );
      await writeFile(
        resolve(out, "검증용_제안서.html"),
        proposalPrintHtml(markdown),
      );
    }
    process.stdout.write(
      `PASS: 실제 AI ${process.argv[2] || "analysis"} 구조·원문 인용·회사 참조 검증 / ${result.model}\n`,
    );
  }
} finally {
  await server.close();
}
