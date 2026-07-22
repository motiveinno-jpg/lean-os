import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { sanitizePdfHtml } from "@/lib/sanitize-html";
import { isAllowedAssetUrl } from "@/lib/pdf-fetch-guard";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

// 임의 HTML → 인쇄품질 PDF (텍스트변환 회사양식 발급 공용). contract-pdf 의 puppeteer 패턴 재사용.
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB — 과도한 입력 차단
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB — 응답 PDF 상한

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
    const rawHtml: string = typeof body?.html === "string" ? body.html : "";
    if (!rawHtml) return NextResponse.json({ error: "html 이 필요합니다." }, { status: 400 });
    if (Buffer.byteLength(rawHtml, "utf8") > MAX_HTML_BYTES) {
      return NextResponse.json({ error: "문서가 너무 큽니다." }, { status: 413 });
    }

    // XSS 방어: script·on*·iframe·object 제거 (레이아웃용 <style> 는 보존).
    const html = sanitizePdfHtml(rawHtml);

    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(30000);

      // SSRF·데이터 유출 차단: data: URI 와 자사 Supabase Storage 만 허용, 그 외 모든 네트워크 abort.
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        const u = r.url();
        if (u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank") return void r.continue();
        if (isAllowedAssetUrl(u)) return void r.continue();
        return void r.abort();
      });

      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
      try {
        await Promise.race([
          page.evaluate(async () => { await (document as any).fonts?.ready; }),
          new Promise((resolve) => setTimeout(resolve, 6000)),
        ]);
      } catch { /* noop */ }
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      if (Buffer.byteLength(Buffer.from(pdf)) > MAX_PDF_BYTES) {
        return NextResponse.json({ error: "생성된 PDF가 너무 큽니다." }, { status: 413 });
      }
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
      });
    } finally {
      await page.close().catch(() => {});
    }
  } catch {
    // 내부 오류 전문 비노출
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
