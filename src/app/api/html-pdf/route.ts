import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

// 임의 HTML → 인쇄품질 PDF (텍스트변환 회사양식 발급 공용). contract-pdf 의 puppeteer 패턴 재사용.
export const runtime = "nodejs";
export const maxDuration = 120;

// 서버리스 warm 인스턴스 재사용 — 콜드스타트(브라우저 launch) 분산
let _browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    args: [...chromium.args, "--font-render-hinting=none"],
    defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  return _browser;
}

export async function POST(req: NextRequest) {
  try {
    // 인증 필요 (로그인 사용자만) — 회사양식 발급은 앱 내부에서만 호출
    const ss = await createSupabaseServerClient();
    const { data: { user } } = await ss.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const body = await req.json().catch(() => null);
    const html: string = typeof body?.html === "string" ? body.html : "";
    if (!html) return NextResponse.json({ error: "html 이 필요합니다." }, { status: 400 });

    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      // domcontentloaded + 폰트 대기(최대 6초). networkidle0 은 외부 폰트 CDN(jsDelivr)이 느리거나
      //   막힌 서버리스 환경에서 30초 hang → 500 오류의 원인이었음. 폰트가 늦으면 시스템 폰트로 렌더.
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
      try {
        await Promise.race([
          page.evaluate(async () => { await (document as any).fonts?.ready; }),
          new Promise((resolve) => setTimeout(resolve, 6000)),
        ]);
      } catch { /* noop */ }
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
      });
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "서버 오류" }, { status: 500 });
  }
}
