// 핵심 흐름을 실제로 해 본다(QA 시드 회사). 만든 데이터는 이름이 SMOKE 로 시작하고, 시작 전·끝난 뒤 모두 지운다.
import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { BASE_URL, QA_COMPANY, SMOKE_TAG, rest, qaSession, storageText } from "./env";
import { openPage, expectHealthy } from "./helpers";
import { cleanupSmokeData } from "./cleanup";

//   한 흐름이 실패해도 나머지는 돈다(어디가 깨졌는지 한 번에 보이게)
test.describe.configure({ mode: "default" });
test.afterAll(async () => { await cleanupSmokeData().catch(() => {}); });

const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(4, 14);

test("파일보관함 — 새 폴더(Enter) → 들어가기 → 파일 올리기", async ({ page }) => {
  const info = await openPage(page, "/documents/");
  await expectHealthy(page, "/documents/", info);
  const folder = `${SMOKE_TAG} 폴더 ${stamp()}`;
  await page.getByRole("button", { name: "새 폴더", exact: true }).click();
  await page.getByLabel("새 폴더 이름").fill(folder);
  await page.getByLabel("새 폴더 이름").press("Enter");
  const row = page.locator(".vx-row-folder", { hasText: folder });
  await expect(row, "새 폴더가 목록에 나타나야 한다").toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.locator(".vx-crumb-last")).toHaveText(folder, { timeout: 15_000 });
  await page.getByLabel("올릴 파일 고르기", { exact: true }).setInputFiles({ name: `${SMOKE_TAG}-test.txt`, mimeType: "text/plain", buffer: Buffer.from(`smoke ${Date.now()}`) });
  await expect(page.locator(".vx-row", { hasText: `${SMOKE_TAG}-test.txt` }), "올린 파일이 폴더 안에 보여야 한다").toBeVisible({ timeout: 30_000 });
});

test("파일보관함 암호화 — 암호화해서 올리기 → 저장본은 원문 아님 → 틀린/맞는 비밀번호 → 암호화 해제", async ({ page }) => {
  const info = await openPage(page, "/documents/");
  await expectHealthy(page, "/documents/", info);
  const name = `${SMOKE_TAG}-lock-${stamp()}.txt`;
  const secret = `SMOKE-SECRET-${Date.now()}`;
  const pw = "smoke-lock-pass-1";
  await page.getByLabel("암호화해서 올릴 파일 고르기").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(secret) });
  await page.getByPlaceholder("비밀번호 (8자 이상)").fill(pw);
  await page.getByPlaceholder("비밀번호 다시 입력").fill(pw);
  await page.getByRole("button", { name: "암호화해서 올리기", exact: true }).last().click();
  const row = page.locator(".vx-row", { hasText: name });
  await expect(row.locator(".vx-lock-mark"), "잠긴 파일 표시").toBeVisible({ timeout: 30_000 });

  //   저장소에 올라간 것은 원문이 아니어야 한다(서버는 내용을 모른다)
  const [rec] = await rest(`document_files?company_id=eq.${QA_COMPANY}&file_name=eq.${encodeURIComponent(name)}&select=id,storage_path,encryption`);
  expect(rec?.encryption, "DB 에 잠금 정보").toBeTruthy();
  expect(String(rec.storage_path), "저장 경로는 .locked").toMatch(/\.locked$/);
  const raw = await storageText("document-files", rec.storage_path);
  expect(raw.startsWith("OVLK1"), "잠긴 형식 머리").toBe(true);
  expect(raw, "원문이 저장소에 없어야 한다").not.toContain(secret);

  //   틀린 비밀번호 → 거절, 맞는 비밀번호 → 원문이 내려온다
  await row.locator(".vx-file-title").click();
  await page.getByPlaceholder("비밀번호", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "열기", exact: true }).click();
  await expect(page.locator(".vx-pw-err"), "틀린 비밀번호 안내").toHaveText("비밀번호가 맞지 않습니다.", { timeout: 20_000 });
  await page.getByPlaceholder("비밀번호", { exact: true }).fill(pw);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByRole("button", { name: "열기", exact: true }).click()]);
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(await dl.path()), "푼 내용이 원문과 같아야 한다").toEqual(Buffer.from(secret));

  //   잠금 풀기 → 표시가 사라지고 저장본이 원문으로
  await row.getByRole("button", { name: `${name} 파일 메뉴` }).click();
  await page.getByRole("menuitem", { name: "암호화 해제" }).click();
  await page.getByPlaceholder("비밀번호", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "암호화 해제", exact: true }).last().click();
  await expect(row.locator(".vx-lock-mark"), "잠금 표시가 사라져야 한다").toHaveCount(0, { timeout: 30_000 });
  const [after] = await rest(`document_files?id=eq.${rec.id}&select=storage_path,encryption`);
  expect(after.encryption, "잠금 정보가 비워져야 한다").toBeNull();
  expect(await storageText("document-files", after.storage_path), "풀린 저장본은 원문").toBe(secret);
});

test("거래처 — 등록 성공, 같은 사업자번호 재등록은 이유가 보이게 거절", async ({ page }) => {
  const info = await openPage(page, "/partners/");
  await expectHealthy(page, "/partners/", info);
  const biz = `999${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const open = async (name: string) => {
    await page.getByRole("button", { name: "+ 새 거래처" }).click();
    await page.getByPlaceholder("거래처명").fill(name);
    await page.getByPlaceholder("000-00-00000").fill(biz);
    await page.getByRole("button", { name: "저장", exact: true }).last().click();
  };
  await open(`${SMOKE_TAG} 거래처 ${stamp()}`);
  await expect(page.locator(".toast-item", { hasText: "등록되었습니다" }), "등록 성공 알림").toBeVisible({ timeout: 20_000 });
  await open(`${SMOKE_TAG} 거래처 중복 ${stamp()}`);
  //   2026-10-08: DB 가 이유를 적어 보냈는데 화면이 '알 수 없는 오류'로 가렸던 회귀를 막는다
  await expect(page.locator(".toast-item", { hasText: "이미 거래처" }), "중복 거절 이유가 보여야 한다").toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape").catch(() => {});
});

test("은행연동 — 화면 열림 + 인증서 자동 인식 토큰(마스터) 발급", async ({ page }) => {
  const info = await openPage(page, "/settings/integration/?tab=bank");
  await expectHealthy(page, "/settings/integration/?tab=bank", info);
  const s = await qaSession();
  const r = await page.request.get(`${BASE_URL}/api/codef/cert-token`, { headers: { Authorization: `Bearer ${s.access_token}` } });
  //   2026-10-08: 화면은 보이는데 서버가 늘 403 이던 권한 어긋남 회귀를 막는다
  expect(r.status(), "마스터는 인증서 자동 인식 토큰을 받아야 한다").toBe(200);
});

test("결재 허브 — 새 요청 양식 목록", async ({ page }) => {
  const info = await openPage(page, "/approvals/?tab=new-request");
  await expectHealthy(page, "/approvals/?tab=new-request", info);
  await page.getByText("유형을 고르세요", { exact: false }).first().click();
  await expect(page.getByText(/지출결의서|품의서|휴가 신청|경비 청구/).first(), "요청 유형을 열면 결재 양식이 보여야 한다").toBeVisible({ timeout: 20_000 });
});

test("알림 — 화면과 종 메뉴", async ({ page }) => {
  const info = await openPage(page, "/notifications/");
  await expectHealthy(page, "/notifications/", info);
});

test("AI 커넥터(MCP) — 로그인 토큰으로 도구 목록", async ({ request }) => {
  const s = await qaSession();
  const cid = `smoke-${randomBytes(4).toString("hex")}`, tok = "ovm_" + randomBytes(24).toString("base64url");
  await rest("oauth_clients", { method: "POST", body: JSON.stringify({ client_id: cid, client_name: "SMOKE", redirect_uris: ["http://localhost/cb"] }) });
  await rest("oauth_tokens", { method: "POST", body: JSON.stringify({
    token_hash: createHash("sha256").update(tok).digest("hex"), refresh_hash: "r" + randomBytes(8).toString("hex"), client_id: cid,
    user_id: s.user.id, company_id: QA_COMPANY,
    expires_at: new Date(Date.now() + 600e3).toISOString(), refresh_expires_at: new Date(Date.now() + 1200e3).toISOString(),
  }) });
  const r = await request.post(`${BASE_URL}/api/mcp/`, {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect(r.status()).toBe(200);
  const names = ((await r.json()).result?.tools || []).map((t: any) => t.name);
  for (const n of ["list_vault_files", "upload_vault_file", "move_vault_folder", "get_company_overview"]) expect(names, `MCP 도구 ${n}`).toContain(n);
});
