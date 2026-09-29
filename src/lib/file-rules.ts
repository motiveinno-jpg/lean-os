// 파일 올리기 규칙(형식·크기) — 앱 업로드(file-storage.uploadFile)와 AI 커넥터 올리기(mcp-vault)가 같이 쓴다.
//   규칙을 바꾸면 두 경로가 함께 바뀐다(따로 두면 한쪽만 느슨해진다).
export type BucketName = "document-files" | "company-assets" | "certificates" | "employee-files";

export const MAX_SIZES: Record<BucketName, number> = {
  //   50MB → 500MB (결정 146 ①, 드팜므 문의발 P4) — 6MB 넘는 파일은 이어올리기(TUS)로 올린다.
  //   버킷 한도(storage.buckets.file_size_limit)도 500MB 로 같이 올렸다(20260902050000).
  "document-files": 500 * 1024 * 1024,
  "company-assets": 5 * 1024 * 1024,
  certificates: 10 * 1024 * 1024,
  "employee-files": 50 * 1024 * 1024,
};

export const ALLOWED_TYPES = [
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

// Extensions allowed when browser reports empty or generic MIME type
export const ALLOWED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "svg",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt", "zip", "hwp",
];

/** 이름·크기·MIME 으로 검사 — 통과 못 하면 사람이 읽을 문구로 throw */
export function validateFileMeta(name: string, size: number, mimeType: string, bucket: BucketName): void {
  const maxSize = MAX_SIZES[bucket];
  if (size > maxSize) {
    const limitMB = Math.round(maxSize / (1024 * 1024));
    throw new Error(`파일 크기는 ${limitMB}MB 이하만 가능합니다.`);
  }
  const ext = name.split(".").pop()?.toLowerCase() || "";
  // MIME 이 맞거나 확장자가 맞으면 통과 — 브라우저가 .hwp 등에 빈·일반 MIME 을 주는 경우가 있다
  if (!ALLOWED_TYPES.includes(mimeType) && !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${mimeType || ext}`);
  }
}
