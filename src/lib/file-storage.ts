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
  category?: string;
  tags?: string[];
  userId: string;
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
  "document-files": 50 * 1024 * 1024,
  "company-assets": 5 * 1024 * 1024,
  certificates: 10 * 1024 * 1024,
  "employee-files": 50 * 1024 * 1024,
};

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
  const { companyId, bucket, file, context, category, tags, userId } = params;

  // Validate
  validateFile(file, bucket);

  // Build storage path
  const ext = getExtension(file.name);
  const basePath = buildStoragePath(companyId, context);
  const storagePath = `${basePath}.${ext}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file);
  if (uploadError) throw uploadError;

  // Get public URL
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

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
      version: 1,
      uploaded_by: userId,
    })
    .select()
    .single();
  if (insertError) throw insertError;

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

  return {
    id: record.id,
    fileName: file.name,
    fileUrl: urlData.publicUrl,
    fileSize: file.size,
    mimeType: file.type,
    storagePath,
  };
}

// ── 2. Upload multiple files ──

export async function uploadMultipleFiles(
  params: Omit<UploadParams, "file"> & { files: File[] }
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (const file of params.files) {
    const result = await uploadFile({ ...params, file });
    results.push(result);
  }

  return results;
}

// ── 3. Create new version ──

export async function createNewVersion(
  parentFileId: string,
  file: File,
  userId: string,
  companyId: string
): Promise<UploadResult> {
  // Fetch parent file
  const { data: parent, error: fetchError } = await db
    .from("document_files")
    .select("*")
    .eq("id", parentFileId)
    .single();
  if (fetchError) throw fetchError;
  if (!parent) throw new Error("원본 파일을 찾을 수 없습니다.");

  // Validate
  const bucket = (parent.bucket || "document-files") as BucketName;
  validateFile(file, bucket);

  // Get max version for this file chain
  const rootId = parent.parent_file_id || parentFileId;
  const versions = logRead('lib/file-storage:versions', await db
    .from("document_files")
    .select("version")
    .or(`id.eq.${rootId},parent_file_id.eq.${rootId}`)
    .order("version", { ascending: false })
    .limit(1));

  const nextVersion = versions && versions.length > 0 ? (versions[0].version ?? 0) + 1 : (parent?.version ?? 0) + 1;

  // Upload to storage
  const ext = getExtension(file.name);
  const basePath = buildStoragePath(companyId, {
    documentId: parent?.document_id ?? undefined,
    dealId: parent?.deal_id ?? undefined,
    vaultDocId: parent?.vault_doc_id ?? undefined,
    folderId: parent?.folder_id ?? undefined,
  });
  const storagePath = `${basePath}_v${nextVersion}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

  // Create new version record
  const { data: record, error: insertError } = await db
    .from("document_files")
    .insert({
      company_id: companyId,
      document_id: parent.document_id || null,
      deal_id: parent.deal_id || null,
      vault_doc_id: parent.vault_doc_id || null,
      folder_id: parent.folder_id || null,
      file_name: file.name,
      file_url: urlData.publicUrl,
      file_size: file.size,
      mime_type: file.type,
      storage_path: storagePath,
      bucket,
      category: parent.category || null,
      tags: parent.tags || [],
      version: nextVersion,
      parent_file_id: rootId,
      uploaded_by: userId,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  // Audit log (non-blocking)
  logAudit({
    companyId,
    userId,
    entityType: "file",
    entityId: record.id,
    action: "file_version_created",
    afterJson: {
      fileName: file.name,
      version: nextVersion,
      parentFileId: rootId,
    },
  }).catch(() => {});

  return {
    id: record.id,
    fileName: file.name,
    fileUrl: urlData.publicUrl,
    fileSize: file.size,
    mimeType: file.type,
    storagePath,
  };
}

// ── 4. Delete file ──

export async function deleteFile(
  fileId: string,
  userId: string,
  companyId: string
): Promise<void> {
  // Fetch file record
  const { data: file, error: fetchError } = await db
    .from("document_files")
    .select("*")
    .eq("id", fileId)
    .single();
  if (fetchError) throw fetchError;
  if (!file) throw new Error("파일을 찾을 수 없습니다.");

  // Delete from storage
  const bucket = (file.bucket || "document-files") as BucketName;
  if (file.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(bucket)
      .remove([file.storage_path]);
    if (storageError) throw storageError;
  }

  // Delete DB record
  const { error: deleteError } = await db
    .from("document_files")
    .delete()
    .eq("id", fileId);
  if (deleteError) throw deleteError;

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

// ── 6. Get files for a deal ──

export async function getFilesForDeal(dealId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .eq("deal_id", dealId)
    .is("parent_file_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 7. Get files for vault ──

export async function getFilesForVault(companyId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .eq("company_id", companyId)
    .not("vault_doc_id", "is", null)
    .is("parent_file_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 8. Get files in a folder ──

export async function getFilesInFolder(folderId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .eq("folder_id", folderId)
    .is("parent_file_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 9. Get file versions ──

export async function getFileVersions(parentFileId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .or(`id.eq.${parentFileId},parent_file_id.eq.${parentFileId}`)
    .order("version", { ascending: true });
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
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return attachSignedUrls(data || []);
}

// ── 11. Create folder ──

export async function createFolder(
  companyId: string,
  name: string,
  parentId?: string
) {
  const { data, error } = await db
    .from("document_folders")
    .insert({
      company_id: companyId,
      name,
      parent_id: parentId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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

  // Delete folder
  const { error } = await db
    .from("document_folders")
    .delete()
    .eq("id", folderId);
  if (error) throw error;

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
  if (insertError) throw insertError;

  return { id: record.id, file_url: urlData.publicUrl, storage_path: storagePath };
}

// ── 15. Get employee files ──

export async function getEmployeeFiles(employeeId: string) {
  const { data, error } = await db
    .from("employee_files")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachSignedUrls(data || [], "employee-files");
}

// ── 16. Delete employee file ──

export async function deleteEmployeeFile(fileId: string) {
  const file = logRead('lib/file-storage:file', await db
    .from("employee_files")
    .select("storage_path")
    .eq("id", fileId)
    .single());

  if (file?.storage_path) {
    await supabase.storage.from("employee-files").remove([file.storage_path]);
  }

  const { error } = await db.from("employee_files").delete().eq("id", fileId);
  if (error) throw error;
}
