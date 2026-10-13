// 점검 시작 전: QA 마스터 세션을 쿠키로 만들어 저장(모든 테스트가 같은 로그인으로 시작) + 지난 점검이 남긴 데이터 정리
import fs from "fs";
import { BASE_URL, REF, STATE_FILE, qaSession } from "./env";
import { cleanupSmokeData } from "./cleanup";

export default async function globalSetup() {
  await cleanupSmokeData().catch(() => {});
  const session = await qaSession();
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = `sb-${REF}-auth-token`, CH = 3180;
  const parts: { name: string; value: string }[] = [];
  if (raw.length <= CH) parts.push({ name, value: raw });
  else for (let i = 0; i * CH < raw.length; i++) parts.push({ name: `${name}.${i}`, value: raw.slice(i * CH, (i + 1) * CH) });
  const host = new URL(BASE_URL).hostname;
  const state = {
    cookies: parts.map((c) => ({ ...c, domain: host, path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: false, secure: BASE_URL.startsWith("https"), sameSite: "Lax" as const })),
    origins: [],
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  process.env.SMOKE_ACCESS_TOKEN = session.access_token;
}
