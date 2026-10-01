// 실제 컴포넌트의 입력·첨부·검토 UI를 격리된 Vite 서버에서 시험한다. 운영 API/메일/DB 호출 없음.
import { createServer } from "vite";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { mkdtemp, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "procurement-ui-"));
await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
const output = join(repo, "deliverables/procurement/screenshots");
await mkdir(output, { recursive: true });
const ws = {
  workforce: {
    source: "오너뷰 직원·프로젝트 업무",
    observedAt: "2026-10-01T00:00:00Z",
    members: [
      {
        id: "qa-person",
        name: "QA 재직 직원",
        department: "QA 부서",
        position: "QA 직책",
        role: null,
        linked: true,
        assignments: [],
      },
    ],
    excludedCount: 1,
    unassignedCount: 0,
    caveat: "검증용 명단이며 가용 시간은 미확인입니다.",
  },
  company: {
    id: "qa-company",
    name: "QA 검증용 회사 · 실제 회사 자료 아님",
    business_number: "000-00-00000",
    representative: "QA 담당자",
    address: "QA 검증용 주소",
    phone: null,
    fax: null,
    industry: null,
    business_type: null,
    business_category: null,
  },
  profile: null,
  files: [],
  settings: {
    keywords: ["홍보"],
    recipients: [],
    digestHour: 8,
    digestEnabled: false,
    collectionEnabled: false,
    minimumScore: 75,
  },
  evidence: [
    {
      id: "qa-evidence",
      category: "project",
      title: "QA 검증용 원본 증빙",
      text: "실제 모티브 실적이 아닌 검증용 자료입니다.",
      source: "QA 원본",
      documentFileId: null,
      verified: true,
      verifiedAt: "2026-09-30T00:00:00Z",
      expiresAt: null,
    },
  ],
  notices: [
    {
      id: "qa-notice",
      content_hash: "qa-hash",
      created_at: "2026-09-30T00:00:00Z",
      payload: {
        id: "qa-notice",
        noticeNo: "QA-001",
        revision: "000",
        title: "검증용 홍보 콘텐츠 운영 용역",
        agency: "QA 기관",
        publishedAt: "2026-09-30T00:00:00Z",
        deadline: "2028-10-20T09:00:00Z",
        budget: 100000000,
        url: null,
        status: "open",
        documents: [],
        attachments: [],
      },
    },
  ],
  reviews: [],
  cases: [],
  drafts: [],
  runs: [],
  ready: true,
  integration: { g2b: false, mail: false, scheduler: false },
};
await writeFile(
  join(root, "index.html"),
  '<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f8f9fc;font-family:system-ui}*{box-sizing:border-box}button,input,select,textarea{font:inherit}h1,h2,h3,h4{margin:0}fieldset{min-width:0}</style><div id="root"></div><script type="module" src="/main.tsx"></script></html>',
);
await writeFile(
  join(root, "main.tsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import ${JSON.stringify(join(repo, "src/app/globals.css"))};import {ProcurementWorkspace} from ${JSON.stringify(join(repo, "src/components/procurement/workspace.tsx"))};window.actions=[];createRoot(document.getElementById('root')).render(<ProcurementWorkspace ws={${JSON.stringify(ws)}} refresh={()=>{}} onAction={async(body)=>{window.actions.push(body)}}/>);`,
);
const server = await createServer({
  configFile: false,
  root,
  css: { postcss: { plugins: [tailwind()] } },
  server: {
    host: "127.0.0.1",
    port: 3017,
    strictPort: true,
    fs: { allow: [repo, root] },
  },
  resolve: {
    alias: {
      "@": join(repo, "src"),
      react: join(repo, "node_modules/react"),
      "react-dom": join(repo, "node_modules/react-dom"),
    },
  },
  esbuild: { jsx: "automatic" },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "@ssabrojs/hwpxjs",
      "jszip",
      "xlsx",
      "pdfjs-dist",
      "pdfjs-dist/legacy/build/pdf.mjs",
    ],
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  // 검증은 외부 폰트 서버의 지연에 의존하지 않는다. 실제 스타일·시스템 대체 글꼴로 시험한다.
  await page.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3017", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "입찰 검토", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
  await page.getByRole("button", { name: /QA 기관/ }).click();
  await page
    .getByRole("heading", { name: "실적 기반 사전 분류 · 추가 확인 필요" })
    .waitFor();
  await page.getByText("종합점수 미확정 (평가 완료 0/100 배점)").waitFor();
  await page
    .getByRole("button", { name: "필수 조건 추가", exact: true })
    .click();
  await page.getByLabel("필수 조건", { exact: true }).fill("업종 등록 확인");
  await page
    .getByRole("button", { name: "평가와 근거 저장", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.actions[0].review.requirements[0].label),
    "업종 등록 확인",
  );
  assert.equal(
    await page.evaluate(() =>
      window.actions[0].review.scores.every((s) => s.points === null),
    ),
    true,
  );
  await page
    .getByRole("button", { name: "원문·공고 정보 보완", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "제안요청서.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "홍보 콘텐츠 운영 실적과 전문 인력이 필요합니다. 제안서와 실적증명서를 제출하여야 합니다.",
    ),
  });
  try {
    await page
      .getByLabel("추출된 원문", { exact: true })
      .waitFor({ timeout: 10000 });
  } catch (e) {
    process.stderr.write(
      JSON.stringify(
        {
          errors,
          alerts: await page.getByRole("alert").allTextContents(),
          labels: await page.locator("label:has(textarea)").allTextContents(),
        },
        null,
        2,
      ) + "\n",
    );
    await page.screenshot({
      path: join(output, "attachment-failure.png"),
      fullPage: true,
    });
    throw e;
  }
  assert.match(
    await page.getByLabel("추출된 원문", { exact: true }).inputValue(),
    /홍보 콘텐츠/,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: /원본 전체와 대조/ }).isChecked(),
    false,
  );
  await page.getByRole("button", { name: "회사 자료", exact: true }).click();
  await page
    .getByRole("heading", { name: "오너뷰 기준 현재 인력", exact: true })
    .waitFor();
  await page.getByRole("heading", { name: /QA 재직 직원/ }).waitFor();
  await page.getByLabel("실적 분석 JSON 파일", { exact: true }).setInputFiles({
    name: "qa-projects.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        companyBusinessNumber: "0000000000",
        items: [
          {
            category: "project",
            title: "QA 실적",
            text: "QA 원본",
            source: "QA 시트",
          },
        ],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "실적 자료 저장", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.actions.at(-1).action),
    "import-evidence",
  );
  await page.getByText("000-00-00000", { exact: true }).waitFor();
  await page.getByLabel("자료명", { exact: true }).fill("QA 실적자료");
  await page
    .getByLabel("발급처·원본 위치·기준일", { exact: true })
    .fill("QA 검증 원본");
  await page
    .getByLabel("증빙 내용·사업별 담당 범위·금액·일시 등", { exact: true })
    .fill("QA 검증용 사업 실적입니다.");
  await page
    .getByRole("button", { name: "회사 자료 등록", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.actions.at(-1).evidence.verified),
    false,
  );
  await page.getByRole("button", { name: "검증 철회", exact: true }).click();
  await page
    .getByLabel("검증 철회 이유", { exact: true })
    .fill("QA 원본 재확인 필요");
  await page
    .getByRole("button", { name: "검증 철회 기록", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.actions.at(-1).action),
    "revoke-evidence",
  );
  await page.getByRole("button", { name: "필요한 자료", exact: true }).click();
  await page.getByRole("heading", { name: "입찰 자격", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "intake.png"), fullPage: true });
  await page
    .getByRole("button", { name: "수집·메일 설정", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "현재 요약 메일 발송", exact: true })
      .isDisabled(),
    true,
  );
  await page.route("**/api/procurement?view=digest", (route) =>
    route.fulfill({
      json: {
        subject: "QA 메일 미리보기",
        html: "<html lang='ko'><body>QA 검토 메일 · 실제 발송 없음</body></html>",
        previewHash: "qa-preview",
      },
    }),
  );
  await page
    .getByRole("button", { name: "메일 본문 미리보기", exact: true })
    .click();
  await page.getByText("QA 메일 미리보기", { exact: true }).waitFor();
  await page
    .frameLocator('iframe[title="아침 메일 미리보기"]')
    .getByText("QA 검토 메일 · 실제 발송 없음", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "settings.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "공고·상세 검토", exact: true })
    .click();
  await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "390px 화면 가로 넘침",
  );
  assert.deepEqual(errors, [], "브라우저 런타임 오류");
  process.stdout.write(
    "PASS: 회사정보·실적 분류·자료 가져오기·미확정 평가·조건 저장·원문 추출·증빙 등록/철회·자료 요청·메일 미리보기·390px 반응형, 브라우저 오류 0\n",
  );
} finally {
  await browser?.close();
  await server.close();
}
