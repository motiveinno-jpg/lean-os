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
const db = supabase as any;

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
];

// ── Helpers ──

function validateFile(file: File, bucket: BucketName): void {
  const maxSize = MAX_SIZES[bucket];
  if (file.size > maxSize) {
    const limitMB = Math.round(maxSize / (1024 * 1024));
    throw new Error(`파일 크기는 ${limitMB}MB 이하만 가능합니다.`);
  }

  const isAllowed = ALLOWED_TYPES.includes(file.type);
  if (!isAllowed) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${file.type}`);
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

  // Audit log
  await logAudit({
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
  });

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
  const { data: versions } = await db
    .from("document_files")
    .select("version")
    .or(`id.eq.${rootId},parent_file_id.eq.${rootId}`)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = versions && versions.length > 0 ? versions[0].version + 1 : parent.version + 1;

  // Upload to storage
  const ext = getExtension(file.name);
  const basePath = buildStoragePath(companyId, {
    documentId: parent.document_id,
    dealId: parent.deal_id,
    vaultDocId: parent.vault_doc_id,
    folderId: parent.folder_id,
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

  // Audit log
  await logAudit({
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
  });

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

  // Audit log
  await logAudit({
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
  });
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
  return data || [];
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
  return data || [];
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
  return data || [];
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
  return data || [];
}

// ── 9. Get file versions ──

export async function getFileVersions(parentFileId: string) {
  const { data, error } = await db
    .from("document_files")
    .select("*")
    .or(`id.eq.${parentFileId},parent_file_id.eq.${parentFileId}`)
    .order("version", { ascending: true });
  if (error) throw error;
  return data || [];
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
  return data || [];
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
  const { data: filesInFolder } = await db
    .from("document_files")
    .select("id")
    .eq("folder_id", folderId)
    .limit(1);

  if (filesInFolder && filesInFolder.length > 0) {
    throw new Error("폴더에 파일이 있어 삭제할 수 없습니다. 파일을 먼저 이동하거나 삭제해주세요.");
  }

  // Check for child folders
  const { data: childFolders } = await db
    .from("document_folders")
    .select("id")
    .eq("parent_id", folderId)
    .limit(1);

  if (childFolders && childFolders.length > 0) {
    throw new Error("하위 폴더가 있어 삭제할 수 없습니다. 하위 폴더를 먼저 삭제해주세요.");
  }

  // Fetch folder info for audit
  const { data: folder } = await db
    .from("document_folders")
    .select("*")
    .eq("id", folderId)
    .single();

  // Delete folder
  const { error } = await db
    .from("document_folders")
    .delete()
    .eq("id", folderId);
  if (error) throw error;

  // Audit log
  await logAudit({
    companyId,
    userId,
    entityType: "file",
    entityId: folderId,
    action: "folder_deleted",
    beforeJson: {
      folderName: folder?.name,
    },
  });
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
  return data || [];
}

// ── 16. Delete employee file ──

export async function deleteEmployeeFile(fileId: string) {
  const { data: file } = await db
    .from("employee_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  if (file?.storage_path) {
    await supabase.storage.from("employee-files").remove([file.storage_path]);
  }

  const { error } = await db.from("employee_files").delete().eq("id", fileId);
  if (error) throw error;
}
