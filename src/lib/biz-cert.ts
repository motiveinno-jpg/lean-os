// 사업자등록증 자동 판독 — 거래처 등록 입력칸 채우기 (2026-09-03 사장님)
//   파일을 base64 로 엣지 함수(biz-cert-extract)에 보내고, 돌아온 값으로 폼을 채운다. 저장은 사람이 한다.
import { supabase } from "@/lib/supabase";

export type BizCertFields = {
  doc_kind: "corp" | "individual" | "unknown";
  name: string; business_number: string; representative: string; address: string;
  business_type: string; business_item: string; open_date: string; corp_number: string;
};
export type BizCertResult = { fields: BizCertFields; confidence: number; notes: string };

export const BIZ_CERT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    r.readAsDataURL(file);
  });
}

/** 브라우저·OS 마다 파일 형식 표기가 제각각(빈값·application/x-pdf·image/jpg·대문자 확장자) — 확장자와 함께 표준 형식으로 맞춘다 (2026-09-03 사장님: PDF 가 거절됨) */
export function normalizeBizCertMime(file: File): string {
  const t = (file.type || "").toLowerCase().trim();
  const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "");
  if (ext === "pdf" || t === "application/pdf" || t === "application/x-pdf" || t === "application/acrobat" || t === "applications/vnd.pdf" || t === "text/pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg" || t === "image/jpeg" || t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (ext === "png" || t === "image/png" || t === "image/x-png") return "image/png";
  if (ext === "webp" || t === "image/webp") return "image/webp";
  if (ext === "gif" || t === "image/gif") return "image/gif";
  return t || `(알 수 없음 .${ext || "?"})`;
}

export async function extractBizCert(file: File): Promise<BizCertResult> {
  const mime = normalizeBizCertMime(file);
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    throw new Error(`PDF 또는 JPG·PNG·WEBP 이미지만 올릴 수 있습니다. (올린 파일 형식: ${mime}${mime.includes("heic") || mime.includes("heif") ? " — 아이폰 사진은 JPG 로 내보내 주세요" : ""})`);
  }
  if (file.size > 12 * 1024 * 1024) throw new Error("12MB 이하 파일만 올릴 수 있습니다.");
  const data = await toBase64(file);
  const { data: res, error } = await supabase.functions.invoke("biz-cert-extract", { body: { mime, data, name: file.name } });
  if (error) {
    const ctx = (error as { context?: Response })?.context;
    let msg = "사업자등록증을 읽지 못했습니다.";
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const r = res as BizCertResult & { error?: string };
  if (r?.error) throw new Error(r.error);
  return r;
}
