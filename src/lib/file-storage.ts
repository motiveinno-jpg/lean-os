import { logRead } from "@/lib/log-read";
/**
 * OwnerView File Storage Engine
 * 파일 업로드/삭제/버전 관리 — 문서, 딜, 금고(Vault) 통합
 *
 * Buckets:
 *   - document-files: 일반 문서 첨부 (최대 50MB)
 *   - company-assets: 회사 로고/이미지 등 (최대 5MB)
 *   - certificates: 인증서/자격증 (최대 10MB)
 */

import { supabase } from "@/lib/supabase";
import { assertStorageQuota } from "@/lib/storage-quota";
import { logAudit } from "./audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ── Types ──

type BucketName = "document-files" | "company-assets" | "certificates" | "employee-files";

interface UploadParams {
  companyId: string;
  bucket: BucketName;
  file: File;
  context?: {
    documentId?: string;
    dealId?: string;
    vaultDocId?: string;
    folderId?: string;
  };
  /** true = 파일보관함 원장(document_files)에 등록해 파일보관함 목록에 보이게 한다.
   *  **기본 false** — 파일보관함 탭의 올리기만 true 를 준다. 다른 화면(서식 편집기·금고·계약 보관·문서 첨부)이
   *  올리는 파일은 그 화면의 것이지 사용자가 보관함에 넣은 파일이 아니다. 종전엔 기본 true 라
   *  파일보관함에 "올린 적 없는 근로계약서"가 나타났다. */
  register?: boolean;
  category?: string;
  tags?: string[];
  userId: string;
  /** 큰 파일(6MB+) 이어올리기 진행률(0~100) — 화면이 "올리는 중 N%" 를 보여줄 때 */
  onProgress?: (pct: number) => void;
}

interface UploadResult {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
}

// ── Constants ──

const MAX_SIZES: Record<BucketName, number> = {
  //   50MB → 500MB (결정 146 ①, 드팜므 문의발 P4) — 6MB 넘는 파일은 이어올리기(TUS)로 올린다.
  //   버킷 한도(storage.buckets.file_size_limit)도 500MB 로 같이 올렸다(20260902050000).
  "document-files": 500 * 1024 * 1024,
  "company-assets": 5 * 1024 * 1024,
  certificates: 10 * 1024 * 1024,
  "employee-files": 50 * 1024 * 1024,
};

//   이어올리기 경계 — 이보다 크면 TUS(6MB 청크, 끊겨도 이어서). Supabase 권장 청크 = 정확히 6MB
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

async function uploadResumable(bucket: string, storagePath: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다 — 다시 로그인 후 올려주세요.");
  const { Upload } = await import("tus-js-client");
  await new Promise<void>((resolve, reject) => {
    const up = new Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: RESUMABLE_THRESHOLD,
      metadata: { bucketName: bucket, objectName: storagePath, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
      onError: (e) => {
        //   413 = 프로젝트 전역 업로드 한도(대시보드 Storage 설정)가 버킷 한도보다 작다 —
        //   사람이 읽을 수 있는 문장으로(2026-09-02 실측: 전역 한도 상향 전엔 여기 걸린다)
        const msg = String(e?.message || e);
        reject(new Error(msg.includes("413") || msg.includes("Maximum size exceeded")
          ? "서버의 파일 크기 한도를 넘었습니다 — 관리자가 저장소 한도를 올리면 500MB까지 올릴 수 있습니다."
          : msg));
      },
      onProgress: (sent, total) => { if (total > 0) onProgress?.(Math.round((sent / total) * 100)); },
      onSuccess: () => resolve(),
    });
    //   끊긴 업로드가 있으면 그 조각부터 이어서 — 처음부터 다시 올리지 않는다
    up.findPreviousUploads().then((prev) => {
      if (prev.length > 0) up.resumeFromPreviousUpload(prev[0]);
      up.start();
    }).catch(() => up.start());
  });
}

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
];

// ── Helpers ──

// Extensions allowed when browser reports empty or generic MIME type
const ALLOWED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "svg",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt", "zip", "hwp",
];

function validateFile(file: File, bucket: BucketName): void {
  const maxSize = MAX_SIZES[bucket];
  if (file.size > maxSize) {
    const limitMB = Math.round(maxSize / (1024 * 1024));
    throw new Error(`파일 크기는 ${limitMB}MB 이하만 가능합니다.`);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const isAllowedType = ALLOWED_TYPES.includes(file.type);
  const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);

  // Accept if MIME type matches OR if extension matches (browsers may report
  // empty/generic MIME for less common formats like .hwp)
  if (!isAllowedType && !isAllowedExt) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${file.type || ext}`);
  }
}

function buildStoragePath(companyId: string, context?: UploadParams["context"]): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);

  let contextSegment = "general";
  if (context?.documentId) contextSegment = `documents/${context.documentId}`;
  else if (context?.dealId) contextSegment = `deals/${context.dealId}`;
  else if (context?.vaultDocId) contextSegment = `vault/${context.vaultDocId}`;
  else if (context?.folderId) contextSegment = `folders/${context.folderId}`;

  return `${companyId}/${contextSegment}/${timestamp}_${random}`;
}

function getExtension(fileName: string): string {
  return fileName.split(".").pop() || "bin";
}

// ── Signed URL — 버킷 private 전환 대비. public 버킷에서도 동작하므로 지금 적용해도 안 깨짐.
//   저장된 file_url(public) 대신 storage_path 로 매 조회 시 signed URL 발급.
const SIGNED_TTL = 60 * 60; // 1시간

// downloadName 을 주면 서명 URL 자체에 Content-Disposition 다운로드 파일명을 실어(Supabase
//   createSignedUrl 의 download 옵션) 저장 경로의 안전화된(추한) 이름 대신 원본 이름으로 받게 한다.
export async function getSignedUrl(bucket: string, storagePath: string, ttl = SIGNED_TTL, downloadName?: string): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, ttl, downloadName ? { download: downloadName } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

// DB 에 저장된 (구) public URL 에서 bucket/path 를 추출해 signed URL 로 변환.
//   private 전환된 버킷의 표시 지점에서 onClick 으로 호출. 추출 실패 시 원본 반환.
export async function resolveSignedUrl(stored?: string | null, downloadName?: string): Promise<string | null> {
  if (!stored) return null;
  const m = stored.match(/\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (m) {
    const signed = await getSignedUrl(m[1], decodeURIComponent(m[2]), SIGNED_TTL, downloadName);
    if (signed) return signed;
  }
  return stored;
}

// 저장된 URL 을 signed 로 변환해 새 탭으로 연다 (표시 지점 onClick 용).
//   downloadName 을 주면 원본 파일명 그대로 다운로드되게(저장 경로의 안전화 이름 대신).
export async function openStoredFile(stored?: string | null, downloadName?: string): Promise<void> {
  const url = await resolveSignedUrl(stored, downloadName);
  if (url) window.open(url, "_blank", "noopener");
}

/** 첨부파일을 **원본 파일명 그대로** 내려받는다 (2026-08-06 사장님 제보).
 *  Supabase 서명 URL 의 `?download=` 는 Content-Disposition 에 퍼센트 인코딩된 이름을 실어,
 *  브라우저가 그대로 저장해 `302.%EB%84%A4%EC%9D%B4...xlsx` 처럼 깨진다.
 *  파일명 헤더를 우리가 3중으로 제어하는 프록시(/api/files/download/[filename])를 거치게 한다.
 *  프록시를 못 타는 URL(외부 링크 등)은 종전처럼 새 탭으로 연다. */
export async function downloadStoredFile(stored?: string | null, downloadName?: string): Promise<void> {
  const signed = await resolveSignedUrl(stored, downloadName);
  if (!signed) return;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const name = (downloadName || "").trim();
  if (!name || !base || !signed.startsWith(`${base}/storage/v1/object/`)) {
    window.open(signed, "_blank", "noopener");
    return;
  }
  // 경로 조각에도 원본 이름을 실어 헤더를 무시하는 뷰어까지 커버 (프록시 주석 참조)
  const proxied = `/api/files/download/${encodeURIComponent(name.replace(/[/\\]/g, "_"))}?u=${encodeURIComponent(signed)}`;
  const a = document.createElement("a");
  a.href = proxied;
  a.download = name;          // 같은 출처라 이 힌트도 유효
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 파일 레코드 배열에 signed file_url 부착 (버킷별 batch 서명). storage_path 있는 것만.
async function attachSignedUrls<T extends { bucket?: string | null; storage_path?: string | null; file_url?: string | null }>(
  rows: T[], defaultBucket = "document-files",
): Promise<T[]> {
  if (!rows?.length) return rows;
  const byBucket = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.storage_path) continue;
    const b = r.bucket || defaultBucket;
    (byBucket.get(b) || byBucket.set(b, []).get(b)!).push(r);
  }
  for (const [bucket, list] of byBucket) {
    const paths = list.map((r) => r.storage_path as string);
    const data = logRead('lib/file-storage:data', await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_TTL));
    if (data) {
      data.forEach((d: any, i: number) => { if (d?.signedUrl) list[i].file_url = d.signedUrl; });
    }
  }
  return rows;
}

// ── 1. Upload single file ──

export async function uploadFile(params: UploadParams): Promise<UploadResult> {
  const { companyId, bucket, file, context, category, tags, userId, register = false, onProgress } = params;

  // Validate
  validateFile(file, bucket);
  // 회사 저장공간 한도 — 이 파일까지 더해 넘으면 숫자 들어간 안내로 끊는다(DB 게이트보다 먼저).
  await assertStorageQuota(companyId, file.size);

  // Build storage path
  const ext = getExtension(file.name);
  const basePath = buildStoragePath(companyId, context);
  const storagePath = `${basePath}.${ext}`;

  // Upload to Supabase Storage — 6MB 넘으면 이어올리기(TUS), 아니면 한 번에
  if (bucket === "document-files" && file.size > RESUMABLE_THRESHOLD) {
    await uploadResumable(bucket, storagePath, file, onProgress);
  } else {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;
    onProgress?.(100);
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

  // register:false — 문서 자산 업로드는 원장에 남기지 않는다 (파일보관함에 노출되지 않게)
  if (!register) {
    return {
      id: "",
      fileName: file.name,
      fileUrl: urlData.publicUrl,
      fileSize: file.size,
      mimeType: file.type,
      storagePath,
    };
  }

  //   버전 관리(결정 146 ③) — 파일보관함 파일(문서·딜·금고 연결이 아닌 것)은 같은 폴더에
  //   같은 이름을 올리면 덮지 않고 v2, v3 로 쌓인다. 목록은 parent_file_id null(최신 판)만
  //   보여주므로, 이전 판들의 parent 를 새 판으로 돌려 최신 판 하나만 남긴다.
  let version = 1;
  let prevIds: string[] = [];
  const isVaultFile = !context?.documentId && !context?.dealId && !context?.vaultDocId;
  if (isVaultFile) {
    let q = db.from("document_files").select("id, version")
      .eq("company_id", companyId).eq("file_name", file.name).is("parent_file_id", null);
    q = context?.folderId ? q.eq("folder_id", context.folderId) : q.is("folder_id", null);
    const { data: prev } = await q;
    if (prev && prev.length > 0) {
      version = Math.max(...prev.map((p: any) => Number(p.version) || 1)) + 1;
      prevIds = prev.map((p: any) => p.id);
    }
  }

  // Create document_files record
  const { data: record, error: insertError } = await db
    .from("document_files")
    .insert({
      company_id: companyId,
      document_id: context?.documentId || null,
      deal_id: context?.dealId || null,
      vault_doc_id: context?.vaultDocId || null,
      folder_id: context?.folderId || null,
      file_name: file.name,
      file_url: urlData.publicUrl,
      file_size: file.size,
      mime_type: file.type,
      storage_path: storagePath,
      bucket,
      category: category || null,
      tags: tags || [],
      version,
      uploaded_by: userId,
    })
    .select()
    .single();
  if (insertError) {
    // 원장 기록이 실패하면 방금 올린 파일은 앱에서 영영 안 보이는 고아가 된다 — 되돌린다.
    //   (2026-08-20 감사: 이 함수 하나에 문서함·금고·HR 양식 등 9개 화면이 매달려 있다)
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => {});
    throw insertError;
  }

  // Audit log (non-blocking — upload already succeeded)
  logAudit({
    companyId,
    userId,
    entityType: "file",
    entityId: record.id,
    action: "file_uploaded",
    afterJson: {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      bucket,
      context,
    },
  }).catch(() => {});

  //   이전 판들(그리고 그 밑에 매달린 더 이전 판들)을 새 판 밑으로 — 최신 하나만 목록에 남는다
  if (prevIds.length > 0) {
    await db.from("document_files").update({ parent_file_id: record.id })
      .eq("company_id", companyId)
      .or(`id.in.(${prevIds.join(",")}),parent_file_id.in.(${prevIds.join(",")})`);
  }

  return {
    id: record.id,
    fileName: file.name,
    fileUrl: urlData.publicUrl,
    fileSize: file.size,
    mimeType: file.type,
    storagePath,
  };
}

// ── 4b. 지난 판·사용량(결정 146) ──

/** 이 파일(최신 판)의 지난 판 목록 — 버전 내림차순, 열 수 있게 서명 URL 포함 */
export async function getFileVersions(fileId: string): Promise<any[]> {
  const { data, error } = await db.from("document_files")
    .select("id, file_name, file_size, version, created_at, storage_path, bucket, file_url, uploaded_by")
    .eq("parent_file_id", fileId)
    .order("version", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || []);
}

/** 회사 저장 사용량(바이트) — 파일보관함 원장(document_files) 합계. 지난 판 포함(지난 판도 자리를 차지한다).
 *  ⚠ PostgREST aggregate(sum())가 이 프로젝트에선 꺼져 있어(400, 2026-09-02 실측) 쪽수로 나눠 더한다. */
export async function getStorageUsage(companyId: string): Promise<number> {
  let total = 0;
  const PAGE = 1000;
  for (let page = 0; page < 50; page += 1) {   // 상한 5만 행 — 그 이상이면 RPC 로 옮길 때다
    const { data, error } = await db.from("document_files")
      .select("file_size")
      .eq("company_id", companyId)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return total;
    const rows = (data || []) as { file_size: number | null }[];
    for (const r of rows) total += Number(r.file_size) || 0;
    if (rows.length < PAGE) break;
  }
  return total;
}

// ── 4. Delete file ──

export async function deleteFile(
  fileId: string,
  userId: string,
  companyId: string,
  // 남의 파일까지 지울 수 있는 권한(마스터 또는 '/documents:delete' 위임자). 화면이 판정해 넘긴다.
  //   진짜 방어선은 RLS(document_files_delete_owner_or_perm) — 이 인자는 사람이 읽을 수 있는
  //   실패 메시지를 주기 위한 것이지, 이것만으로 막는 게 아니다. (2026-08-20 사장님)
  opts?: { canDeleteOthers?: boolean }
): Promise<void> {
  // Fetch file record
  const { data: file, error: fetchError } = await db
    .from("document_files")
    .select("*")
    .eq("id", fileId)
    .single();
  if (fetchError) throw fetchError;
  if (!file) throw new Error("파일을 찾을 수 없습니다.");

  if (file.uploaded_by !== userId && !opts?.canDeleteOthers) {
    throw new Error("본인이 올린 파일만 삭제할 수 있습니다. (다른 사람의 파일은 마스터 또는 삭제 권한을 받은 사람만)");
  }

  //   지난 판(결정 146 ③)도 같이 지운다 — 최신만 지우면 목록에서 안 보이는 이전 판들이
  //   저장소 용량만 차지하는 고아가 된다(2026-09-02 실측서 잡음). 파일 하나 = 역사 전체.
  const { data: olds } = await db.from("document_files")
    .select("id, bucket, storage_path")
    .eq("parent_file_id", fileId);

  // ⚠️ 순서 주의 — DB 행을 먼저 지운다. 종전엔 실물부터 지워서, RLS 가 행 삭제를 막으면
  //   파일만 사라지고 목록엔 남는 깨진 상태가 됐다. 행이 지워진 뒤엔 실물 삭제도 정책상 허용된다.
  const { error: deleteError } = await db
    .from("document_files")
    .delete()
    .eq("id", fileId);
  if (deleteError) throw deleteError;
  if (olds && olds.length > 0) await removeFileRows(olds);

  // Delete from storage
  const bucket = (file.bucket || "document-files") as BucketName;
  if (file.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(bucket)
      .remove([file.storage_path]);
    if (storageError) throw storageError;
  }

  // Audit log (non-blocking)
  logAudit({
    companyId,
    userId,
    entityType: "file",
    entityId: fileId,
    action: "file_deleted",
    beforeJson: {
      fileName: file.file_name,
      fileSize: file.file_size,
      mimeType: file.mime_type,
      bucket,
    },
  }).catch(() => {});
}

// ── 4b. Delete all files attached to a document (storage + rows) — used on document delete ──

export async function deleteFilesForDocument(documentId: string): Promise<void> {
  const files = logRead('lib/file-storage:files', await db
    .from("document_files")
    .select("id, bucket, storage_path")
    .eq("document_id", documentId));
  if (!files?.length) return;
  await removeFileRows(files);
}

// ── 4c. Prune files no longer referenced in a document's saved HTML body —
//   리치에디터로 PDF 페이지 이미지를 재삽입할 때마다 이전 삽입분이 고아로 남는 것 방지.
export async function pruneUnreferencedDocumentFiles(documentId: string, contentHtml: string): Promise<void> {
  const files = logRead('lib/file-storage:files', await db
    .from("document_files")
    .select("id, bucket, storage_path, file_url")
    .eq("document_id", documentId)
    .is("parent_file_id", null));
  if (!files?.length) return;
  const stale = files.filter((f: any) => f.file_url && !contentHtml.includes(f.file_url));
  await removeFileRows(stale);
}

async function removeFileRows(files: { id: string; bucket?: string | null; storage_path?: string | null }[]): Promise<void> {
  if (!files.length) return;
  const byBucket = new Map<string, string[]>();
  for (const f of files) {
    if (!f.storage_path) continue;
    const b = f.bucket || "document-files";
    (byBucket.get(b) || byBucket.set(b, []).get(b)!).push(f.storage_path);
  }
  for (const [bucket, paths] of byBucket) {
    await supabase.storage.from(bucket).remove(paths);
  }
  await db.from("document_files").delete().in("id", files.map((f) => f.id));
}

// ── 5. Get files for a document ──

export async function getFilesForDocument(documentId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .eq("document_id", documentId)
    .is("parent_file_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 10. Search files ──

export async function searchFiles(companyId: string, query: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .eq("company_id", companyId)
    .ilike("file_name", `%${query}%`)
    .is("parent_file_id", null)
    // 파일보관함에 직접 올린 파일만 — 문서·금고·딜에 딸린 첨부는 그 화면의 것
    .is("document_id", null).is("vault_doc_id", null).is("deal_id", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 11. Create folder ──

/** 폴더 공개 범위(결정 146 ②) — 일정과 같은 4단계. 숨김은 RLS 가 한다(20260902050000). */
export type FolderVisibility = "private" | "members" | "departments" | "company";

export async function createFolder(
  companyId: string,
  name: string,
  parentId?: string,
  opts?: { visibility?: FolderVisibility; targetUserIds?: string[]; targetDepartments?: string[]; createdBy?: string | null }
) {
  const visibility: FolderVisibility = opts?.visibility ?? "company";
  const { data, error } = await db
    .from("document_folders")
    .insert({
      company_id: companyId,
      name,
      parent_id: parentId || null,
      visibility,
      target_user_ids: visibility === "members" ? (opts?.targetUserIds ?? []) : [],
      target_departments: visibility === "departments" ? (opts?.targetDepartments ?? []) : [],
      created_by: opts?.createdBy ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** 폴더 공개 범위 바꾸기 — 만든 뒤에도 좁히거나 넓힐 수 있게(CRUD 완결).
 *  RLS(20260902060000)가 만든 사람·권한자만 통과시킨다 — 0행이면 성공처럼 조용히 넘어가지 않고
 *  사람이 읽을 문장으로 거절한다(2026-09-02 디비 아키텍트 지적). */
export async function updateFolderVisibility(
  folderId: string,
  visibility: FolderVisibility,
  opts?: { targetUserIds?: string[]; targetDepartments?: string[] }
) {
  const { data, error } = await db.from("document_folders").update({
    visibility,
    target_user_ids: visibility === "members" ? (opts?.targetUserIds ?? []) : [],
    target_departments: visibility === "departments" ? (opts?.targetDepartments ?? []) : [],
    updated_at: new Date().toISOString(),
  }).eq("id", folderId).select("id");
  if (error) {
    //   42501 = 바꾼 결과가 내 눈에 안 보이는 범위(예: 사람 지정에서 나를 뺌) — 이유를 번역
    if ((error as any).code === "42501") throw new Error("바꾼 범위에 본인이 빠져 있습니다 — '사람'으로 좁힐 때는 본인(또는 폴더를 만든 사람)을 포함해야 합니다.");
    throw error;
  }
  if (!data || data.length === 0) throw new Error("폴더를 만든 사람(또는 파일 삭제 권한자)만 범위를 바꿀 수 있습니다.");
}

// ── 12. Get folders for company ──

export async function getFolders(companyId: string) {
  const { data, error } = await db
    .from("document_folders")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── 12b. Move files into a folder ──
//   폴더에 넣은 파일은 저장소 경로에도 폴더가 박혀 있고(`{company}/folders/{folderId}/…`) 스토리지 RLS 가
//   그 경로로 공개 범위를 판단한다. 그래서 folder_id 만 바꾸면 목록과 실물의 범위가 어긋난다 — 실물을 먼저 옮기고
//   성공한 것만 행을 고친다. 지난 판(parent_file_id 가 이 파일인 행)도 같이 따라간다.
export async function moveFilesToFolder(
  fileIds: string[],
  folderId: string | null,
  companyId: string,
): Promise<{ moved: number; skipped: number; failed: string[] }> {
  if (fileIds.length === 0) return { moved: 0, skipped: 0, failed: [] };
  const { data: rows, error } = await db
    .from("document_files")
    .select("id, file_name, folder_id, storage_path, bucket, parent_file_id")
    .eq("company_id", companyId)
    .or(`id.in.(${fileIds.join(",")}),parent_file_id.in.(${fileIds.join(",")})`);
  if (error) throw error;

  const targetSegment = folderId ? `folders/${folderId}` : "general";
  let moved = 0, skipped = 0;
  const failed: string[] = [];
  for (const f of (rows || []) as any[]) {
    const isLatest = !f.parent_file_id;   // 세는 건 파일(최신 판)만 — 지난 판은 조용히 따라간다
    if ((f.folder_id || null) === (folderId || null)) { if (isLatest) skipped++; continue; }
    const patch: { folder_id: string | null; storage_path?: string; file_url?: string } = { folder_id: folderId };
    const parts = String(f.storage_path || "").split("/");
    //   경로가 `{company}/(general|folders/{id})/{파일}` 꼴인 파일보관함 파일만 실물을 옮긴다.
    //   다른 꼴(문서·딜에 붙은 파일 등)은 경로에 폴더가 없으니 행만 고친다.
    const vaultShaped = f.bucket === "document-files" && parts[0] === companyId
      && (parts[1] === "general" && parts.length === 3 || parts[1] === "folders" && parts.length === 4);
    if (vaultShaped) {
      const next = `${companyId}/${targetSegment}/${parts[parts.length - 1]}`;
      const { error: mvErr } = await supabase.storage.from(f.bucket).move(f.storage_path, next);
      if (mvErr) { failed.push(f.file_name); continue; }
      patch.storage_path = next;
      patch.file_url = supabase.storage.from(f.bucket).getPublicUrl(next).data.publicUrl;
    }
    const { data: hit, error: upErr } = await db.from("document_files").update(patch).eq("id", f.id).select("id");
    if (upErr || !hit || hit.length === 0) {
      //   행을 못 고쳤으면 실물을 되돌린다 — 목록은 옛 폴더인데 실물만 새 폴더면 내려받기가 깨진다
      if (vaultShaped) await supabase.storage.from(f.bucket).move(patch.storage_path!, f.storage_path).catch(() => {});
      failed.push(f.file_name);
      continue;
    }
    if (isLatest) moved++;
  }
  return { moved, skipped, failed };
}

// ── 13. Delete folder ──

export async function deleteFolder(
  folderId: string,
  userId: string,
  companyId: string
): Promise<void> {
  // Check for files in folder
  const filesInFolder = logRead('lib/file-storage:filesInFolder', await db
    .from("document_files")
    .select("id")
    .eq("folder_id", folderId)
    .limit(1));

  if (filesInFolder && filesInFolder.length > 0) {
    throw new Error("폴더에 파일이 있어 삭제할 수 없습니다. 파일을 먼저 이동하거나 삭제해주세요.");
  }

  // Check for child folders
  const childFolders = logRead('lib/file-storage:childFolders', await db
    .from("document_folders")
    .select("id")
    .eq("parent_id", folderId)
    .limit(1));

  if (childFolders && childFolders.length > 0) {
    throw new Error("하위 폴더가 있어 삭제할 수 없습니다. 하위 폴더를 먼저 삭제해주세요.");
  }

  // Fetch folder info for audit
  const folder = logRead('lib/file-storage:folder', await db
    .from("document_folders")
    .select("*")
    .eq("id", folderId)
    .single());

  // Delete folder — RLS 가 만든 사람·권한자만 통과(20260902060000). 0행 = 조용한 실패 금지
  const { data: deleted, error } = await db
    .from("document_folders")
    .delete()
    .eq("id", folderId)
    .select("id");
  if (error) throw error;
  if (!deleted || deleted.length === 0) throw new Error("폴더를 만든 사람(또는 파일 삭제 권한자)만 지울 수 있습니다.");

  // Audit log (non-blocking)
  logAudit({
    companyId,
    userId,
    entityType: "file",
    entityId: folderId,
    action: "folder_deleted",
    beforeJson: {
      folderName: folder?.name,
    },
  }).catch(() => {});
}

// ── 14. Upload employee file (입사서류) ──

export async function uploadEmployeeFile(params: {
  companyId: string;
  employeeId: string;
  category: string;
  file: File;
}): Promise<{ id: string; file_url: string; storage_path: string }> {
  const { companyId, employeeId, category, file } = params;

  validateFile(file, "employee-files");
  await assertStorageQuota(companyId, file.size);

  const ext = getExtension(file.name);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const storagePath = `${companyId}/${employeeId}/${category}/${timestamp}_${random}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("employee-files")
    .upload(storagePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from("employee-files").getPublicUrl(storagePath);

  const { data: record, error: insertError } = await db
    .from("employee_files")
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      category,
      file_name: file.name,
      file_url: urlData.publicUrl,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type,
    })
    .select()
    .single();
  if (insertError) {
    // 원장 기록이 실패하면 방금 올린 파일은 아무도 못 찾는 고아가 된다 — 되돌린다.
    //   (2026-08-20: category 제약 위반으로 막힌 업로드 3건이 스토리지에만 남아 있었다)
    await supabase.storage.from("employee-files").remove([storagePath]).catch(() => {});
    if ((insertError as { message?: string }).message?.includes("employee_files_category_check")) {
      throw new Error("이 서류 종류는 아직 저장할 수 없습니다 — 관리자에게 알려주세요.");
    }
    throw insertError;
  }

  return { id: record.id, file_url: urlData.publicUrl, storage_path: storagePath };
}

/** 입사서류 체크리스트에서 올린 파일 삭제 (2026-08-20 사장님 요청) — 체크리스트는 파일 id 가
 *  아니라 storage_path 로 파일을 들고 있어서(employees.onboarding_docs JSONB) 경로로 지운다.
 *  스토리지 → 원장 순서로 지우되 스토리지 실패는 무시한다: 이미 없는 파일 때문에 목록에서
 *  영영 못 지우는 상태가 되면 안 된다. */
export async function deleteEmployeeFileByPath(storagePath: string): Promise<void> {
  // 2026-08-20: 여기도 원장 먼저 — 권한이 없어 원장이 안 지워지는데 실물만 사라지면 안 된다.
  //   실물 삭제 실패는 종전대로 무시한다(이미 없는 파일 때문에 목록에서 영영 못 지우면 안 되므로).
  const { error } = await db.from("employee_files").delete().eq("storage_path", storagePath);
  if (error) throw error;
  await supabase.storage.from("employee-files").remove([storagePath]).catch(() => {});
}
