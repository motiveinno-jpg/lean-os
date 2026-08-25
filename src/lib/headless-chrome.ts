// 서버 PDF 렌더용 headless Chrome 공용 런처 — api/html-pdf · api/contract-pdf 가 쓴다.
//
// ■ 2026-08-25 채우기·출력 500 의 최종 원인 (error_logs '[html-pdf]' + sparticuz 소스 대조)
//   증상: /tmp/chromium 은 있는데 `libnss3.so: cannot open shared object file` 로 즉사.
//   원인: @sparticuz/chromium 은 AWS_EXECUTION_ENV/AWS_LAMBDA_JS_RUNTIME 로 Lambda 를
//   감지했을 때만 공유 라이브러리(al2023.tar.br → /tmp/al2023/lib)를 추출하고
//   LD_LIBRARY_PATH 를 잡는다. Vercel 의 새 함수 런타임은 이 AWS env 를 노출하지 않아
//   chromium 본체만 풀리고 라이브러리는 통째로 건너뛰었다.
//   해결: import 전에 env 를 우리가 채워 감지를 통과시킨다(그래서 반드시 동적 import).
//   그래도 죽으면(半추출 warm 인스턴스 등) /tmp 캐시를 지우고 릴리스 팩(tar)으로 1회 재시도.
//
// ⚠️ PACK_URL 버전은 package.json 의 @sparticuz/chromium 버전과 반드시 일치시킬 것.
import { existsSync, rmSync } from "node:fs";
import type { Browser } from "puppeteer-core";

const PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

let _browser: Browser | null = null;

export async function getPdfBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;

  // Lambda 감지 통과용 — Vercel(리눅스)에서만. 로컬 mac 개발은 건드리지 않는다.
  if (process.platform === "linux" && !process.env["AWS_EXECUTION_ENV"] && !process.env["AWS_LAMBDA_JS_RUNTIME"]) {
    process.env["AWS_EXECUTION_ENV"] = "AWS_Lambda_nodejs22.x";
  }

  // 정적 import 금지 — 모듈 로드가 죽으면 catch·로깅까지 못 가고 빈 500 이 된다(같은 날 실사고).
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);

  const launch = async (executablePath: string) =>
    puppeteer.launch({
      args: [...chromium.args, "--font-render-hinting=none"],
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });

  try {
    _browser = await launch(await chromium.executablePath());
  } catch (first) {
    // 라이브러리 미추출 상태로 굳은 /tmp 캐시(부분 추출 warm 인스턴스) 정리 후
    // 릴리스 팩으로 전체를 다시 받는다 — /tmp/chromium 이 남아 있으면
    // executablePath() 가 추출 없이 즉시 반환해 같은 실패를 반복한다.
    try {
      for (const p of ["/tmp/chromium", "/tmp/chromium-pack", "/tmp/al2023", "/tmp/al2", "/tmp/fonts", "/tmp/swiftshader"]) {
        if (existsSync(p)) rmSync(p, { recursive: true, force: true });
      }
    } catch { /* 정리 실패면 어차피 아래 재시도에서 드러난다 */ }
    try {
      _browser = await launch(await chromium.executablePath(PACK_URL));
    } catch {
      throw first; // 원인 파악엔 첫 에러가 더 유용하다 (libnss3 등)
    }
  }
  return _browser;
}
