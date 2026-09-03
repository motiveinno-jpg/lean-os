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

export async function extractBizCert(file: File): Promise<BizCertResult> {
  const mime = (file.type || "").toLowerCase() || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  if (!mime) throw new Error("PDF 또는 JPG·PNG 이미지를 올려 주세요.");
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
