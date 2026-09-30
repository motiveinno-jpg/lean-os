// AI 커넥터(MCP) — 업무 › 파일보관함 도구. 서버 전용.
//   누가 무엇을 볼 수 있나는 DB 가 그 사람 권한(RLS)으로 판정한다(mcp_vault_files·mcp_vault_file, 마이그 20260929320000).
//   파일 내용은 그 판정을 통과한 파일만 서버가 내려받아 글자를 뽑는다(AI 참모 첨부와 같은 추출기).
import { oauthDb } from "@/lib/mcp-oauth";
import { extractDocumentText, DOCUMENT_TEXT_EXTS } from "@/lib/copilot-attachments";
import { validateFileMeta } from "@/lib/file-rules";
import { randomBytes } from "node:crypto";

const MAX_BYTES = 100 * 1024 * 1024;      // 글자 뽑기는 100MB 까지(함수 300초 안). 원본 내려받기(download_vault_files)는 크기 제한 없음
const PAGE_CHARS = 60_000;                // 한 번에 돌려주는 글자 수 — 긴 문서는 offset 으로 이어 읽는다
const IMAGE_EXTS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export const VAULT_TOOLS = [
  {
    name: "list_vault_files",
    description:
      "업무 › 파일보관함의 폴더와 파일 목록(이름·폴더·크기·종류·태그·올린 날짜·id). 로그인한 사람이 볼 수 있는 것만 나온다. " +
      "폴더는 폴더 안에 폴더를 둘 수 있고 folders[].path 가 맨 위부터의 경로다. 파일의 folder 도 경로(null = 폴더 밖·맨 위). " +
      "folder_id 로 한 폴더만, query 로 파일 이름·태그·폴더 경로 검색. 내용을 보려면 read_vault_file 에 id 를 넘긴다.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        folder_id: { type: "string", description: "이 폴더의 파일만(목록의 folders[].id)" },
        query: { type: "string", description: "파일 이름·태그·폴더 경로에 들어간 글자" },
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
  {
    name: "create_vault_folder",
    description:
      "파일보관함에 폴더를 만든다. parent_id 를 주면 그 폴더 안에(몇 단계든), 없으면 맨 위에. 같은 자리에 같은 이름 폴더가 이미 있으면 새로 만들지 않고 그 폴더를 돌려준다. " +
      "visibility(맨 위 폴더만): company(회사 전체, 기본)·private(나만)·departments(departments 에 적은 부서만). 하위 폴더는 상위 폴더의 공개 범위를 따른다. 특정 사람 지정은 오너뷰 화면에서.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        name: { type: "string", description: "폴더 이름" },
        parent_id: { type: "string", description: "상위 폴더 id(없으면 맨 위)" },
        visibility: { type: "string", enum: ["company", "private", "departments"], description: "공개 범위(맨 위 폴더만, 기본 company)" },
        departments: { type: "array", items: { type: "string" }, description: "visibility=departments 일 때 부서 이름들" },
      },
      required: ["name"],
    },
  },
  {
    name: "upload_vault_file",
    description:
      "파일보관함에 파일을 올리는 1단계 — 올리기 링크(2시간)를 받는다. 받은 upload_url 로 파일을 PUT 한 뒤 반드시 finish_vault_upload 를 불러야 목록에 등록된다. " +
      "터미널: curl -X PUT -H \"Content-Type: <mime_type>\" --data-binary @\"로컬파일\" \"<upload_url>\". " +
      "folder_id 를 주면 그 폴더에, 비우면 폴더 밖(맨 위)에 올린다. " +
      "형식·크기(500MB)·저장공간 한도는 오너뷰 화면에서 올릴 때와 같다. 같은 폴더에 같은 이름이면 덮지 않고 새 판(v2, v3…)으로 쌓인다.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        file_name: { type: "string", description: "저장될 파일 이름(확장자 포함)" },
        size_bytes: { type: "integer", description: "파일 크기(바이트)" },
        folder_id: { type: "string", description: "넣을 폴더 id(비우면 폴더 밖·맨 위)" },
        mime_type: { type: "string", description: "파일 형식(모르면 비워 두면 확장자로 정함)" },
        tags: { type: "array", items: { type: "string" }, description: "태그(선택)" },
      },
      required: ["file_name", "size_bytes"],
    },
  },
  {
    name: "finish_vault_upload",
    description: "파일보관함 올리기 2단계 — upload_url 로 파일을 다 올린 뒤 upload_id 를 넘기면 실물을 확인하고 목록에 등록한다.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { upload_id: { type: "string", description: "upload_vault_file 이 준 upload_id" } },
      required: ["upload_id"],
    },
  },
  {
    name: "delete_vault_files",
    description:
      "파일보관함 파일을 지운다(지난 판까지 함께, 되돌릴 수 없음). 파일마다 id 와 이름(list_vault_files 그대로)을 둘 다 넣어야 하고, " +
      "이름이 맞지 않으면 지우지 않는다. 본인이 올린 파일만 지울 수 있고 남의 파일은 마스터·파일 삭제 권한자만(오너뷰 화면과 같음). 한 번에 20개까지.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        files: {
          type: "array", description: "지울 파일들(1~20개)",
          items: {
            type: "object", additionalProperties: false,
            properties: { id: { type: "string", description: "list_vault_files 의 id" }, name: { type: "string", description: "그 파일의 이름(확인용)" } },
            required: ["id", "name"],
          },
        },
      },
      required: ["files"],
    },
  },
  {
    name: "move_vault_folder",
    description:
      "폴더의 상위 폴더를 바꾼다(폴더째 옮기기) — 안에 든 하위 폴더·파일이 모두 함께 따라간다. parent_id 를 비우면 맨 위로. " +
      "자기 자신이나 자기 하위 폴더 안으로는 못 옮기고, 옮긴 자리에 같은 이름 폴더가 있으면 거절된다. " +
      "옮긴 폴더는 새 상위 폴더의 공개 범위를 따른다. 폴더를 만든 사람·파일 삭제 권한자만.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        folder_id: { type: "string", description: "옮길 폴더 id(list_vault_files 의 folders[].id)" },
        parent_id: { type: "string", description: "새 상위 폴더 id — 비우면 맨 위" },
      },
      required: ["folder_id"],
    },
  },
  {
    name: "rename_vault_folder",
    description: "폴더 이름을 바꾼다. 같은 자리에 같은 이름 폴더가 있으면 거절. 폴더를 만든 사람·파일 삭제 권한자만.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        folder_id: { type: "string", description: "폴더 id" },
        name: { type: "string", description: "새 이름" },
      },
      required: ["folder_id", "name"],
    },
  },
  {
    name: "delete_vault_folder",
    description:
      "빈 폴더를 지운다(하위 폴더·파일이 하나라도 있으면 거절 — 안을 먼저 옮기거나 지운다). " +
      "id 와 이름(list_vault_files 그대로)이 둘 다 맞아야 지운다. 폴더를 만든 사람·파일 삭제 권한자만.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        folder_id: { type: "string", description: "폴더 id" },
        name: { type: "string", description: "그 폴더의 이름(확인용)" },
      },
      required: ["folder_id", "name"],
    },
  },
  {
    name: "move_vault_files",
    description:
      "파일 여러 개를 다른 폴더로(또는 folder_id 를 비워 폴더 밖·맨 위로) 옮긴다(한 번에 50개, 지난 판도 함께). 폴더 통째로 옮길 때는 move_vault_folder 가 낫다. " +
      "본인이 올린 파일만, 다른 사람의 파일은 마스터·파일 삭제 권한자만.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        file_ids: { type: "array", items: { type: "string" }, description: "옮길 파일 id 들(list_vault_files 의 id)" },
        folder_id: { type: "string", description: "옮겨 넣을 폴더 id(비우면 폴더 밖·맨 위)" },
      },
      required: ["file_ids"],
    },
  },
];
export const isVaultTool = (name: string) => VAULT_TOOLS.some((t) => t.name === name);
const UPLOAD_TTL_MS = 2 * 3600 * 1000;
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", zip: "application/zip", hwp: "application/x-hwp",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const mb = (n: number) => `${Math.round((n / 1048576) * 10) / 10}MB`;

/** 올리기 링크만 받고 등록하지 않은 실물 치우기 — 목록에 없이 저장공간만 먹지 않게(2시간 지난 것) */
async function sweepExpiredUploads() {
  const db = oauthDb();
  const { data } = await db.from("mcp_pending_uploads").select("id, storage_path")
    .is("done_file_id", null).is("cleaned_at", null).lt("expires_at", new Date().toISOString()).limit(50);
  const rows = (data || []) as { id: string; storage_path: string }[];
  if (!rows.length) return;
  await db.storage.from("document-files").remove(rows.map((r) => r.storage_path));
  await db.from("mcp_pending_uploads").update({ cleaned_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
}
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

  if (name === "delete_vault_files") {
    //   행 삭제·권한 판정·지난 판·감사 기록은 DB 함수가 그 사람 권한으로(앱 deleteFile 과 같은 순서) —
    //   여기서는 함수가 지웠다고 돌려준 경로의 실물만 치운다(행이 안 지워졌으면 실물도 그대로).
    const items = (Array.isArray(args.files) ? args.files : []) as { id?: unknown; name?: unknown }[];
    const list = items.map((x) => ({ id: String(x?.id || ""), name: String(x?.name || "") }))
      .filter((x) => UUID.test(x.id) && x.name).slice(0, 20);
    if (list.length === 0) return { content: text({ error: "files 에 {id, name} 을 넣어 주세요(list_vault_files 의 값 그대로)." }), isError: true };
    const results: unknown[] = [];
    let okCount = 0;
    for (const it of list) {
      const { data, error } = await db.rpc("mcp_vault_delete_file", { p_auth: tok.user_id, p_company: tok.company_id, p_file: it.id, p_name: it.name });
      if (error) { results.push({ id: it.id, name: it.name, error: "지우지 못했습니다." }); continue; }
      const r = data as { deleted?: boolean; error?: string; paths?: string[]; versions_removed?: number };
      if (!r.deleted) { results.push({ id: it.id, name: it.name, error: r.error }); continue; }
      if (r.paths?.length) await db.storage.from("document-files").remove(r.paths);
      okCount++;
      results.push({ id: it.id, name: it.name, deleted: true, versions_removed: r.versions_removed ?? 0 });
    }
    await log(tok, name, okCount > 0, okCount === list.length ? null : `${list.length - okCount} not deleted`);
    return { content: text({ results, deleted: okCount, note: "지운 파일은 되돌릴 수 없습니다." }), isError: okCount === 0 };
  }

  if (name === "move_vault_folder" || name === "rename_vault_folder" || name === "delete_vault_folder") {
    const folder = typeof args.folder_id === "string" && UUID.test(args.folder_id) ? args.folder_id : null;
    if (!folder) return { content: text({ error: "folder_id 를 넣어 주세요(list_vault_files 의 folders[].id)." }), isError: true };
    const parentRaw = typeof args.parent_id === "string" ? args.parent_id.trim() : "";
    if (name === "move_vault_folder" && parentRaw && !UUID.test(parentRaw)) return { content: text({ error: "parent_id 가 폴더 id 형식이 아닙니다." }), isError: true };
    const { data, error } = name === "move_vault_folder"
      ? await db.rpc("mcp_vault_move_folder", { p_auth: tok.user_id, p_company: tok.company_id, p_folder: folder, p_parent: parentRaw || null })
      : name === "rename_vault_folder"
        ? await db.rpc("mcp_vault_rename_folder", { p_auth: tok.user_id, p_company: tok.company_id, p_folder: folder, p_name: String(args.name || "") })
        : await db.rpc("mcp_vault_delete_folder", { p_auth: tok.user_id, p_company: tok.company_id, p_folder: folder, p_name: String(args.name || "") });
    if (error) { await log(tok, name, false, error.message.slice(0, 200)); return { content: text({ error: "처리하지 못했습니다." }), isError: true }; }
    const r = data as { error?: string };
    await log(tok, name, !r.error, r.error ?? null);
    return { content: text(r), isError: !!r.error };
  }

  if (name === "move_vault_files") {
    //   권한·대상 확인은 DB 가 그 사람으로(mcp_vault_file_move_plan). 실물이 경로의 폴더 id 로 공개 범위를 가르므로
    //   앱 moveFilesToFolder 와 같이 실물을 먼저 옮기고 성공한 것만 행을 고친다. 행을 못 고치면 실물을 되돌린다.
    const rawFolder = typeof args.folder_id === "string" ? args.folder_id.trim() : "";
    if (rawFolder && !UUID.test(rawFolder)) return { content: text({ error: "folder_id 가 폴더 id 형식이 아닙니다." }), isError: true };
    const folder = rawFolder || null;
    const ids = (Array.isArray(args.file_ids) ? args.file_ids.map(String) : []).filter((x) => UUID.test(x)).slice(0, 50);
    if (!ids.length) return { content: text({ error: "file_ids 를 넣어 주세요." }), isError: true };
    const results: unknown[] = [];
    let moved = 0;
    for (const id of ids) {
      const { data, error } = await db.rpc("mcp_vault_file_move_plan", { p_auth: tok.user_id, p_company: tok.company_id, p_file: id, p_folder: folder });
      if (error) { results.push({ id, error: "옮기지 못했습니다." }); continue; }
      const plan = data as { error?: string; name?: string; same?: boolean; to_name?: string; rows?: { id: string; storage_path: string | null; bucket: string }[] };
      if (plan.error) { results.push({ id, error: plan.error }); continue; }
      if (plan.same) { results.push({ id, name: plan.name, moved: false, note: "이미 그 폴더에 있습니다." }); continue; }
      let ok = true;
      for (const row of plan.rows || []) {
        const parts = String(row.storage_path || "").split("/");
        const vaultShaped = row.bucket === "document-files" && parts[0] === tok.company_id
          && (parts[1] === "general" && parts.length === 3 || parts[1] === "folders" && parts.length === 4);
        const patch: { folder_id: string | null; storage_path?: string; file_url?: string } = { folder_id: folder };
        if (vaultShaped) {
          const next = `${tok.company_id}/${folder ? `folders/${folder}` : "general"}/${parts[parts.length - 1]}`;
          const { error: mvErr } = await db.storage.from(row.bucket).move(row.storage_path!, next);
          if (mvErr) { ok = false; break; }
          patch.storage_path = next;
          patch.file_url = db.storage.from(row.bucket).getPublicUrl(next).data.publicUrl;
        }
        const { error: upErr } = await db.from("document_files").update(patch).eq("id", row.id).eq("company_id", tok.company_id);
        if (upErr) {
          if (vaultShaped) await db.storage.from(row.bucket).move(patch.storage_path!, row.storage_path!);
          ok = false; break;
        }
      }
      if (ok) { moved++; results.push({ id, name: plan.name, moved: true, to: plan.to_name }); }
      else results.push({ id, name: plan.name, error: "옮기다 실패했습니다. 다시 시도해 주세요." });
    }
    await log(tok, name, moved > 0, moved === ids.length ? null : `${ids.length - moved} not moved`);
    return { content: text({ results, moved }), isError: moved === 0 };
  }

  if (name === "create_vault_folder") {
    const parent = typeof args.parent_id === "string" && UUID.test(args.parent_id) ? args.parent_id : null;
    const deps = Array.isArray(args.departments) ? args.departments.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 20) : [];
    const { data, error } = await db.rpc("mcp_vault_create_folder", {
      p_auth: tok.user_id, p_company: tok.company_id, p_name: String(args.name || ""), p_parent: parent,
      p_visibility: typeof args.visibility === "string" ? args.visibility : "company", p_departments: deps,
    });
    if (error) { await log(tok, name, false, error.message.slice(0, 200)); return { content: text({ error: "폴더를 만들지 못했습니다." }), isError: true }; }
    const r = data as { error?: string; id?: string; existed?: boolean };
    await log(tok, name, !r.error, r.error ?? null);
    return { content: text(r.error ? r : { ...r, note: r.existed ? "같은 이름 폴더가 이미 있어 그 폴더를 씁니다." : "폴더를 만들었습니다." }), isError: !!r.error };
  }

  if (name === "upload_vault_file") {
    await sweepExpiredUploads().catch(() => {});
    const fileName = String(args.file_name || "").replace(/[\u0000-\u001f/\\]/g, "").trim().slice(0, 200);
    const size = Math.trunc(Number(args.size_bytes));
    const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) || "";
    const mime = (typeof args.mime_type === "string" && args.mime_type.trim()) || MIME_BY_EXT[ext] || "application/octet-stream";
    if (!fileName || !ext) return { content: text({ error: "file_name 에 확장자까지 적어 주세요." }), isError: true };
    if (!Number.isFinite(size) || size <= 0) return { content: text({ error: "size_bytes 에 파일 크기(바이트)를 적어 주세요." }), isError: true };
    try { validateFileMeta(fileName, size, mime, "document-files"); }
    catch (e) { return { content: text({ error: (e as Error).message }), isError: true }; }
    const folder = typeof args.folder_id === "string" && UUID.test(args.folder_id) ? args.folder_id : null;
    const { data: chk, error: cErr } = await db.rpc("mcp_vault_upload_check", { p_auth: tok.user_id, p_company: tok.company_id, p_folder: folder });
    if (cErr) { await log(tok, name, false, cErr.message.slice(0, 200)); return { content: text({ error: "올리기 준비에 실패했습니다." }), isError: true }; }
    const c = chk as { ok: boolean; error?: string; used_bytes: number; quota_bytes: number };
    if (!c.ok) return { content: text({ error: c.error }), isError: true };
    if (c.quota_bytes > 0 && c.used_bytes + size > c.quota_bytes) {
      return { content: text({ error: `저장공간이 부족합니다 — 사용 ${mb(c.used_bytes)} / 한도 ${mb(c.quota_bytes)}, 이 파일 ${mb(size)}. 오너뷰 요금제에서 저장공간을 늘리거나 파일을 정리해 주세요.` }), isError: true };
    }
    //   저장 경로는 앱 uploadFile 과 같은 꼴 — 스토리지 RLS 가 경로의 폴더 id 로 공개 범위를 가른다
    const storagePath = `${tok.company_id}/${folder ? `folders/${folder}` : "general"}/${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
    const { data: signed, error: sErr } = await db.storage.from("document-files").createSignedUploadUrl(storagePath);
    if (sErr || !signed?.signedUrl) { await log(tok, name, false, "sign_failed"); return { content: text({ error: "올리기 링크를 만들지 못했습니다." }), isError: true }; }
    const tags = Array.isArray(args.tags) ? args.tags.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 20) : [];
    const { data: pend, error: pErr } = await db.from("mcp_pending_uploads").insert({
      company_id: tok.company_id, user_id: tok.user_id, client_id: tok.client_id, folder_id: folder, file_name: fileName,
      storage_path: storagePath, declared_size: size, mime_type: mime, tags, expires_at: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    }).select("id").single();
    if (pErr || !pend) return { content: text({ error: "올리기 준비를 기록하지 못했습니다." }), isError: true };
    await log(tok, name, true, null);
    return {
      content: text({
        upload_id: pend.id, upload_url: signed.signedUrl, method: "PUT", headers: { "Content-Type": mime },
        expires_in_seconds: UPLOAD_TTL_MS / 1000,
        next: `1) curl -X PUT -H "Content-Type: ${mime}" --data-binary @"<로컬 파일 경로>" "<upload_url>"  2) finish_vault_upload(upload_id) — 부르지 않으면 2시간 뒤 치워진다`,
      }),
      isError: false,
    };
  }

  if (name === "finish_vault_upload") {
    const uid = String(args.upload_id || "");
    if (!UUID.test(uid)) return { content: text({ error: "upload_id 가 올바르지 않습니다." }), isError: true };
    const { data: pu } = await db.from("mcp_pending_uploads").select("*").eq("id", uid).maybeSingle();
    const p = pu as null | { id: string; user_id: string; company_id: string; folder_id: string | null; file_name: string; storage_path: string; mime_type: string; category: string | null; tags: string[]; expires_at: string; done_file_id: string | null; cleaned_at: string | null };
    if (!p || p.user_id !== tok.user_id || p.company_id !== tok.company_id) return { content: text({ error: "올리기 기록을 찾을 수 없습니다." }), isError: true };
    if (p.done_file_id) return { content: text({ file_id: p.done_file_id, note: "이미 등록된 파일입니다." }), isError: false };
    if (p.cleaned_at || Date.parse(p.expires_at) <= Date.now()) return { content: text({ error: "올리기 링크가 만료됐습니다. upload_vault_file 부터 다시 해 주세요." }), isError: true };
    //   실물이 정말 올라왔는지 — 크기는 선언값이 아니라 저장소가 잰 값으로 등록한다
    const slash = p.storage_path.lastIndexOf("/");
    const { data: objs } = await db.storage.from("document-files").list(p.storage_path.slice(0, slash), { search: p.storage_path.slice(slash + 1), limit: 5 });
    const obj = ((objs || []) as { name: string; metadata?: { size?: number } }[]).find((o) => o.name === p.storage_path.slice(slash + 1));
    if (!obj) return { content: text({ error: "아직 파일이 올라오지 않았습니다. upload_url 로 PUT 한 뒤 다시 불러 주세요." }), isError: true };
    const actual = Number(obj.metadata?.size || 0);
    try { validateFileMeta(p.file_name, actual, p.mime_type, "document-files"); }
    catch (e) { await db.storage.from("document-files").remove([p.storage_path]); return { content: text({ error: (e as Error).message }), isError: true }; }
    const { data: chk } = await db.rpc("mcp_vault_upload_check", { p_auth: tok.user_id, p_company: tok.company_id, p_folder: p.folder_id });
    const c = chk as { ok: boolean; error?: string; used_bytes: number; quota_bytes: number } | null;
    if (c && c.ok && c.quota_bytes > 0 && c.used_bytes > c.quota_bytes) {
      //   올린 실물까지 더해 한도를 넘었다 — 등록하지 않고 치운다(앱은 올리기 전에 막는 것과 같은 결과)
      await db.storage.from("document-files").remove([p.storage_path]);
      await db.from("mcp_pending_uploads").update({ cleaned_at: new Date().toISOString() }).eq("id", p.id);
      return { content: text({ error: `저장공간 한도를 넘어 등록하지 않았습니다(사용 ${mb(c.used_bytes)} / 한도 ${mb(c.quota_bytes)}).` }), isError: true };
    }
    const { data: pub } = db.storage.from("document-files").getPublicUrl(p.storage_path);
    const { data: reg, error: rErr } = await db.rpc("mcp_vault_register", {
      p_auth: tok.user_id, p_company: tok.company_id, p_folder: p.folder_id, p_name: p.file_name, p_path: p.storage_path,
      p_url: pub.publicUrl, p_size: actual, p_mime: p.mime_type, p_category: p.category, p_tags: p.tags,
    });
    if (rErr || !reg) { await log(tok, name, false, rErr?.message.slice(0, 200) ?? "register_failed"); return { content: text({ error: "목록에 등록하지 못했습니다." }), isError: true }; }
    const r = reg as { id: string; version: number };
    await db.from("mcp_pending_uploads").update({ done_file_id: r.id }).eq("id", p.id);
    await log(tok, name, true, null);
    return { content: text({ file_id: r.id, name: p.file_name, version: r.version, size: actual, note: r.version > 1 ? `같은 이름이 있어 v${r.version} 으로 쌓았습니다.` : "파일보관함에 등록했습니다." }), isError: false };
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
