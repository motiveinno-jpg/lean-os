// AI 커넥터(MCP) — 업무 › 파일보관함 도구. 서버 전용.
//   누가 무엇을 볼 수 있나는 DB 가 그 사람 권한(RLS)으로 판정한다(mcp_vault_files·mcp_vault_file, 마이그 20260929320000).
//   파일 내용은 그 판정을 통과한 파일만 서버가 내려받아 글자를 뽑는다(AI 참모 첨부와 같은 추출기).
import { oauthDb } from "@/lib/mcp-oauth";
import { extractDocumentText, DOCUMENT_TEXT_EXTS } from "@/lib/copilot-attachments";

const MAX_BYTES = 100 * 1024 * 1024;      // 글자 뽑기는 100MB 까지(함수 300초 안). 원본 내려받기(download_vault_files)는 크기 제한 없음
const PAGE_CHARS = 60_000;                // 한 번에 돌려주는 글자 수 — 긴 문서는 offset 으로 이어 읽는다
const IMAGE_EXTS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export const VAULT_TOOLS = [
  {
    name: "list_vault_files",
    description:
      "업무 › 파일보관함의 폴더와 파일 목록(이름·폴더·크기·종류·태그·올린 날짜·id). 로그인한 사람이 볼 수 있는 것만 나온다. " +
      "folder_id 로 한 폴더만, query 로 파일 이름·태그·폴더 이름 검색. 내용을 보려면 read_vault_file 에 id 를 넘긴다.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        folder_id: { type: "string", description: "이 폴더의 파일만(목록의 folders[].id)" },
        query: { type: "string", description: "파일 이름·태그·폴더 이름에 들어간 글자" },
        limit: { type: "integer", description: "최대 몇 개(기본 100, 최대 300)" },
      },
    },
  },
  {
    name: "read_vault_file",
    description:
      "파일보관함 파일 하나의 내용을 글자로 읽는다(HWP·HWPX·PDF·DOCX·XLSX·XLS·CSV·TXT·MD·JSON). 이미지(PNG·JPG·GIF·WEBP)는 그림으로 준다. " +
      "긴 문서는 한 번에 6만 자까지 — 결과의 이어 읽기 offset 을 넘기면 이어서 읽는다. 100MB 까지. 스캔 PDF(글자 없는 그림)는 글자를 못 뽑는다. 원본 파일이 필요하면 download_vault_files.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        file_id: { type: "string", description: "list_vault_files 의 id" },
        offset: { type: "integer", description: "몇 번째 글자부터(기본 0)" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "download_vault_files",
    description:
      "파일보관함 파일을 원본 그대로 내려받을 링크를 만든다(최대 20개, 링크는 10분 동안만 유효). " +
      "터미널에서는 curl -L -o \"파일이름\" \"download_url\" 로 저장하면 된다. 볼 권한이 없는 파일은 링크를 만들지 않는다.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        file_ids: { type: "array", items: { type: "string" }, description: "list_vault_files 의 id 들(1~20개)" },
      },
      required: ["file_ids"],
    },
  },
];
export const isVaultTool = (name: string) => VAULT_TOOLS.some((t) => t.name === name);
const DOWNLOAD_TTL_SEC = 600;

type Tok = { user_id: string; company_id: string; client_id: string };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function log(tok: Tok, tool: string, ok: boolean, error: string | null) {
  await oauthDb().from("mcp_access_log").insert({ company_id: tok.company_id, user_id: tok.user_id, client_id: tok.client_id, tool, ok, error });
}
const text = (o: unknown): Content[] => [{ type: "text", text: JSON.stringify(o) }];

export async function callVaultTool(tok: Tok, name: string, args: Record<string, unknown>): Promise<{ content: Content[]; isError: boolean }> {
  const db = oauthDb();
  if (name === "list_vault_files") {
    const folder = typeof args.folder_id === "string" && UUID.test(args.folder_id) ? args.folder_id : null;
    const { data, error } = await db.rpc("mcp_vault_files", {
      p_auth: tok.user_id, p_company: tok.company_id, p_folder: folder,
      p_query: typeof args.query === "string" ? args.query.slice(0, 80) : null,
      p_limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 100,
    });
    if (error) { await log(tok, name, false, error.message.slice(0, 200)); return { content: text({ error: "파일 목록을 불러오지 못했습니다." }), isError: true }; }
    await log(tok, name, true, null);
    return { content: text({ ...data, note: "로그인한 사람이 볼 수 있는 파일만입니다(폴더 공개 범위 적용). 최신 판만, 파일보관함에 직접 올린 파일만." }), isError: false };
  }

  if (name === "download_vault_files") {
    //   원본 내려받기 — 파일마다 그 사람 권한(RLS)으로 확인한 뒤에만 10분짜리 서명 링크를 만든다.
    //   링크는 가진 사람 누구나 받을 수 있으므로 짧게 두고, 만든 사실을 기록한다.
    const ids = (Array.isArray(args.file_ids) ? args.file_ids : [args.file_ids]).map(String).filter((x) => UUID.test(x));
    const uniq = [...new Set(ids)].slice(0, 20);
    if (uniq.length === 0) return { content: text({ error: "file_ids 에 list_vault_files 의 id 를 넣어 주세요." }), isError: true };
    const files: unknown[] = [];
    for (const id of uniq) {
      const { data: meta } = await db.rpc("mcp_vault_file", { p_auth: tok.user_id, p_company: tok.company_id, p_file: id });
      const f = meta as { id: string; name: string; size: number | null; bucket: string; storage_path: string | null; folder: string | null } | null;
      if (!f) { files.push({ id, error: "파일이 없거나 볼 권한이 없습니다." }); continue; }
      if (!f.storage_path) { files.push({ id, name: f.name, error: "저장된 실물이 없는 파일입니다." }); continue; }
      const { data: signed, error: sErr } = await db.storage.from(f.bucket).createSignedUrl(f.storage_path, DOWNLOAD_TTL_SEC);
      if (sErr || !signed?.signedUrl) { files.push({ id, name: f.name, error: "링크를 만들지 못했습니다." }); continue; }
      //   파일 이름은 직접 한 번만 인코딩해 붙인다 — SDK 의 download 옵션은 두 번 인코딩해
      //   브라우저로 받으면 한글 이름이 %EC%9B… 로 깨졌다(2026-09-29 머리글 실측)
      const url = `${signed.signedUrl}${signed.signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.name)}`;
      files.push({ id, name: f.name, folder: f.folder, size: f.size, download_url: url });
    }
    const okCount = files.filter((x) => (x as { download_url?: string }).download_url).length;
    await log(tok, name, okCount > 0, okCount === uniq.length ? null : `${uniq.length - okCount} failed`);
    return {
      content: text({ files, expires_in_seconds: DOWNLOAD_TTL_SEC, note: "링크는 10분 뒤 만료됩니다. 터미널: curl -L -o \"<name>\" \"<download_url>\"" }),
      isError: okCount === 0,
    };
  }

  // read_vault_file
  const fileId = String(args.file_id || "");
  if (!UUID.test(fileId)) return { content: text({ error: "file_id 가 올바르지 않습니다. list_vault_files 의 id 를 넘기세요." }), isError: true };
  const { data: meta, error } = await db.rpc("mcp_vault_file", { p_auth: tok.user_id, p_company: tok.company_id, p_file: fileId });
  if (error) { await log(tok, name, false, error.message.slice(0, 200)); return { content: text({ error: "파일을 확인하지 못했습니다." }), isError: true }; }
  if (!meta) { await log(tok, name, false, "not_visible"); return { content: text({ error: "파일이 없거나 볼 권한이 없습니다." }), isError: true }; }
  const f = meta as { id: string; name: string; mime_type: string | null; size: number | null; bucket: string; storage_path: string | null; folder: string | null };
  if (!f.storage_path) return { content: text({ error: "저장된 실물이 없는 파일입니다." }), isError: true };
  if ((f.size ?? 0) > MAX_BYTES) return { content: text({ error: `파일이 너무 커서 글자를 뽑지 않습니다(${Math.round((f.size ?? 0) / 1048576)}MB, 100MB 까지). 원본이 필요하면 download_vault_files 로 내려받으세요.` }), isError: true };

  const ext = (f.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) || "";
  const { data: blob, error: dlErr } = await db.storage.from(f.bucket).download(f.storage_path);
  if (dlErr || !blob) { await log(tok, name, false, "download_failed"); return { content: text({ error: "파일을 내려받지 못했습니다." }), isError: true }; }
  const buf = await blob.arrayBuffer();

  if (IMAGE_EXTS[ext]) {
    if (buf.byteLength > IMAGE_MAX_BYTES) return { content: text({ error: "그림이 커서 대화로 보내지 않습니다(4MB 까지). 원본은 download_vault_files 로 내려받으세요." }), isError: true };
    await log(tok, name, true, null);
    return { content: [{ type: "text", text: `${f.folder ? `${f.folder} / ` : ""}${f.name}` }, { type: "image", data: Buffer.from(buf).toString("base64"), mimeType: IMAGE_EXTS[ext] }], isError: false };
  }
  if (!DOCUMENT_TEXT_EXTS.includes(ext)) {
    await log(tok, name, false, `unsupported:${ext}`);
    return { content: text({ error: `이 형식(.${ext || "?"})은 글자를 읽지 못합니다. 읽을 수 있는 형식: ${DOCUMENT_TEXT_EXTS.join("·").toUpperCase()}·그림` }), isError: true };
  }
  let body: string;
  try {
    body = await extractDocumentText(f.name, buf);
  } catch (e) {
    await log(tok, name, false, String((e as Error)?.message || e).slice(0, 200));
    return { content: text({ error: (e as Error)?.message || "글자를 뽑지 못했습니다." }), isError: true };
  }
  if (!body) {
    await log(tok, name, false, "empty");
    return { content: text({ error: ext === "pdf" ? "PDF 에 글자가 없습니다(스캔한 그림 PDF 일 수 있음)." : "읽을 수 있는 글자가 없습니다." }), isError: true };
  }
  const offset = Math.max(0, Math.trunc(Number(args.offset) || 0));
  const chunk = body.slice(offset, offset + PAGE_CHARS);
  const next = offset + PAGE_CHARS < body.length ? offset + PAGE_CHARS : null;
  await log(tok, name, true, null);
  return {
    content: [{
      type: "text",
      text: `[${f.folder ? `${f.folder} / ` : ""}${f.name}] ${offset + 1}~${offset + chunk.length}자 / 전체 ${body.length}자${next ? ` · 이어 읽기: offset=${next}` : ""}\n\n${chunk}`,
    }],
    isError: false,
  };
}
