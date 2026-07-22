// PDF 렌더 시 서버가 원격 자산(직인·서명 이미지 등)을 data URL 로 가져올 때의 SSRF 가드.
//   - OwnerView Supabase Storage HTTPS URL 만 허용 (내부망·메타데이터·임의 호스트 차단).
//   - redirect 후 최종 URL 도 동일 allowlist 로 재검증.
//   - timeout·최대 바이트·image content-type 강제.
//   테스트 가능하도록 순수 함수(isAllowedAssetUrl)로 분리.

const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT_MS = 8000;

/** 허용 호스트: OwnerView Supabase 프로젝트 호스트만. env 없으면 *.supabase.co storage 경로로 폴백. */
export function isAllowedAssetUrl(raw: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  const allowedHost = (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : "";
    } catch {
      return "";
    }
  })();

  // 우리 Supabase 프로젝트 호스트 + storage object 경로만 허용.
  if (allowedHost && u.host === allowedHost) {
    return u.pathname.startsWith("/storage/v1/object/");
  }
  // env 미설정 환경 방어적 폴백: *.supabase.co 의 storage object 경로.
  if (u.host.endsWith(".supabase.co")) {
    return u.pathname.startsWith("/storage/v1/object/");
  }
  return false;
}

/** allowlist·timeout·크기·content-type·redirect 재검증을 적용해 원격 이미지를 data URL 로 반환. 실패 시 null. */
export async function fetchAssetAsDataUrl(url: string): Promise<string | null> {
  if (!isAllowedAssetUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) return null;
    // redirect 후 최종 URL 도 allowlist 여야 함 (open-redirect → SSRF 방지).
    if (res.url && !isAllowedAssetUrl(res.url)) return null;
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
