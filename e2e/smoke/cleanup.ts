// 점검이 만든 데이터만 지운다 — 전부 QA 시드 회사, 이름이 SMOKE 로 시작하는 것만. 다른 데이터는 건드리지 않는다.
import { QA_COMPANY, SB_URL, SMOKE_TAG, projectKeys, rest } from "./env";

export async function cleanupSmokeData() {
  const { service } = await projectKeys();
  // 파일보관함: SMOKE 폴더 안 파일·하위 폴더 → 폴더(아래부터) / 폴더 밖 SMOKE 파일
  const folders: { id: string; parent_id: string | null }[] = await rest(`document_folders?company_id=eq.${QA_COMPANY}&name=like.${SMOKE_TAG}*&select=id,parent_id`);
  const fids = folders.map((f) => f.id);
  const files: { id: string; storage_path: string | null; parent_file_id: string | null }[] = await rest(
    `document_files?company_id=eq.${QA_COMPANY}&or=(file_name.like.${SMOKE_TAG}*${fids.length ? `,folder_id.in.(${fids.join(",")})` : ""})&select=id,storage_path,parent_file_id`);
  const paths = files.map((f) => f.storage_path).filter(Boolean);
  if (paths.length) {
    await fetch(`${SB_URL}/storage/v1/object/document-files`, {
      method: "DELETE", headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
  for (const f of files.filter((x) => x.parent_file_id)) await rest(`document_files?id=eq.${f.id}`, { method: "DELETE" });
  for (const f of files.filter((x) => !x.parent_file_id)) await rest(`document_files?id=eq.${f.id}`, { method: "DELETE" });
  const depth = (id: string): number => { let d = 0, p = folders.find((x) => x.id === id)?.parent_id; while (p && fids.includes(p)) { d++; p = folders.find((x) => x.id === p)?.parent_id; } return d; };
  for (const f of [...folders].sort((a, b) => depth(b.id) - depth(a.id))) await rest(`document_folders?id=eq.${f.id}`, { method: "DELETE" });
  // 거래처
  await rest(`partners?company_id=eq.${QA_COMPANY}&name=like.${SMOKE_TAG}*`, { method: "DELETE" });
  // MCP 점검용 OAuth 클라이언트(토큰은 연쇄 삭제)
  await rest(`oauth_clients?client_id=like.smoke-*`, { method: "DELETE" });
}
