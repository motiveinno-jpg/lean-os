// PDF 렌더 시 서버가 원격 자산(직인·서명 이미지 등)을 data URL 로 가져올 때의 SSRF 가드.
//   - OwnerView Supabase Storage HTTPS URL 만 허용 (내부망·메타데이터·임의 호스트 차단).
//   - 리다이렉트는 따르지 않는다(응답 3xx 는 실패로 본다).
//   - timeout·최대 바이트·image content-type 강제.
//   테스트 가능하도록 순수 함수(isAllowedAssetUrl)로 분리.

const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT_MS = 8000;

/** 허용 호스트: OwnerView Supabase 프로젝트 호스트의 storage object 경로만.
 *  env 가 없으면 아무것도 허용하지 않는다 — 종전의 "*.supabase.co 면 허용" 폴백은 다른 프로젝트 URL 까지 열었다. */
export function isAllowedAssetUrl(raw: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;

  let allowedHost = "";
  try {
    allowedHost = supabaseUrl ? new URL(supabaseUrl).host : "";
  } catch {
    allowedHost = "";
  }
  if (!allowedHost) return false;
  if (u.host !== allowedHost) return false;
  return u.pathname.startsWith("/storage/v1/object/");
}

/** allowlist·timeout·크기·content-type·redirect 재검증을 적용해 원격 이미지를 data URL 로 반환. 실패 시 null. */
export async function fetchAssetAsDataUrl(url: string): Promise<string | null> {
  if (!isAllowedAssetUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // 리다이렉트는 따라가지 않는다 — 따라간 뒤 검사하면 첫 요청이 이미 나간 뒤다.
    const res = await fetch(url, { redirect: "manual", signal: controller.signal });
    if (res.status >= 300 && res.status < 400) return null;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const len = Number(res.headers.get("content-length") || "0");
    if (len && len > MAX_ASSET_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ASSET_BYTES) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
