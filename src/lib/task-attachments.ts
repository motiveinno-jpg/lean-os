// 실행형 태스크 첨부 (이미지·파일) — 업로드/서명URL/삭제 (2026-07-01)
//   task-attachments 버킷(private, 회사폴더 격리). 경로 = {company_id}/{uuid}/{name}.
//   form-templates.ts 스토리지 패턴 재사용.

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const BUCKET = "task-attachments";

export interface TaskAttachment {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
}

export async function uploadTaskAttachment(companyId: string, file: File): Promise<TaskAttachment> {
  const id = crypto.randomUUID();
  const safe = (file.name || "file").replace(/[^\w.\-]/g, "_").slice(-120) || "file";
  const path = `${companyId}/${id}/${safe}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return { id, name: file.name || safe, path, type: file.type || "", size: file.size || 0 };
}

// 미리보기/다운로드용 임시 서명 URL (1시간)
export async function taskAttachmentUrl(path: string): Promise<string | null> {
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function removeTaskAttachment(path: string): Promise<void> {
  try { await db.storage.from(BUCKET).remove([path]); } catch { /* best-effort */ }
}

export const isImageAtt = (a: { type?: string; name?: string }) =>
  (a.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name || "");
