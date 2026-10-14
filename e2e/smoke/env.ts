// 배포 후 자동 점검 — 공용 설정. 운영(www.owner-view.com)을 QA 시드 회사 계정으로 실제로 눌러 본다.
//   서비스 키는 저장소·시크릿에 두지 않고 CI 시크릿 SUPABASE_ACCESS_TOKEN(관리 토큰)으로 실행 때마다 받아 온다.
export const REF = "njbvdkuvtdtkxyylwngn";
export const SB_URL = `https://${REF}.supabase.co`;
export const BASE_URL = process.env.SMOKE_BASE_URL || "https://www.owner-view.com";
export const QA_EMAIL = "qa-seed-owner@mo-tive.com";          // QA시드 주식회사 마스터
export const QA_COMPANY = "4d2157e8-35a2-4a78-8c6d-c774475ab110";
export const STATE_FILE = "e2e/smoke/.auth-state.json";
export const SMOKE_TAG = "SMOKE";                              // 점검이 만든 데이터 이름 머리 — 끝나면 이 이름만 지운다

let cached: { anon: string; service: string } | null = null;
export async function projectKeys(): Promise<{ anon: string; service: string }> {
  if (cached) return cached;
  const pat = process.env.SUPABASE_ACCESS_TOKEN;
  if (!pat) throw new Error("SUPABASE_ACCESS_TOKEN 이 없습니다 — 배포 후 점검을 돌릴 수 없습니다.");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) throw new Error(`Supabase 관리 API ${r.status}`);
  const keys = (await r.json()) as { name: string; api_key: string }[];
  cached = {
    anon: keys.find((k) => k.name === "anon")!.api_key,
    service: keys.find((k) => k.name === "service_role")!.api_key,
  };
  return cached;
}

/** 서비스 권한 REST 호출(정리·기록용) */
export async function rest(path: string, init: RequestInit = {}) {
  const { service } = await projectKeys();
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

/** QA 마스터로 매직링크 로그인한 세션(쿠키에 심을 원본) */
export async function qaSession(): Promise<any> {
  const { anon, service } = await projectKeys();
  const link = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: QA_EMAIL }),
  })).json();
  const s = await (await fetch(`${SB_URL}/auth/v1/verify`, {
    method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  })).json();
  if (!s.access_token) throw new Error("QA 계정 로그인 실패");
  return s;
}

/** 저장소 파일을 서비스 권한으로 글자로 읽는다(잠금 점검: 서버에 원문이 없는지) */
export async function storageText(bucket: string, path: string): Promise<string> {
  const { service } = await projectKeys();
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  if (!r.ok) throw new Error(`storage ${bucket}/${path} ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString("latin1");
}
