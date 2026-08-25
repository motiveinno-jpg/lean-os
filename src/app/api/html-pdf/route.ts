import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowedAssetUrl } from "@/lib/pdf-fetch-guard";
import { logServerError } from "@/lib/server-error-log";
import { PDF_SANITIZE_CONFIG, PDF_SANITIZE_URI_REGEXP_SOURCE } from "@/lib/pdf-sanitize-config";
import { getPdfBrowser } from "@/lib/headless-chrome";

// 임의 HTML → 인쇄품질 PDF (텍스트변환 회사양식 발급 공용). contract-pdf 의 puppeteer 패턴 재사용.
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB — 과도한 입력 차단
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB — 응답 PDF 상한

// 브라우저 기동은 공용 런처로 — Vercel 라이브러리 미추출(libnss3) 우회 포함 (headless-chrome.ts)

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

    const browser = await getPdfBrowser();
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

      // XSS 방어: script·on*·iframe·object 제거 (레이아웃용 <style> 는 보존).
      //   정제는 jsdom 이 아니라 어차피 띄운 headless Chrome(진짜 DOM) 안에서 DOMPurify 로 —
      //   jsdom 의존 사슬이 프로덕션 함수를 모듈 평가 시점에 죽이던 사고의 근본 제거
      //   (pdf-sanitize-config.ts 주석 참조). dirty HTML 은 evaluate 의 '데이터 인자'로만
      //   전달되므로 정제 전에 실행될 경로가 없다.
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve("dompurify/dist/purify.min.js") });
      const html: string = await page.evaluate(
        (dirty, cfg, uriSrc) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const dp = (window as any).DOMPurify;
          return dp.sanitize(dirty, { ...cfg, ALLOWED_URI_REGEXP: new RegExp(uriSrc, "i") });
        },
        rawHtml, PDF_SANITIZE_CONFIG, PDF_SANITIZE_URI_REGEXP_SOURCE,
      );

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
  } catch (e) {
    // 내부 오류 전문은 클라이언트에 비노출 — 대신 error_logs 로 적재해 운영자 화면에서 본다.
    //   (2026-08-25 이전엔 여기서도 삼켜서 500 의 원인을 알 길이 없었다)
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[html-pdf]", msg);
    await logServerError({ where: "html-pdf", message: msg, context: { stack: e instanceof Error ? String(e.stack).slice(0, 1200) : null } });
    // x-ov-pdf: 배포 세대 표식 — "지금 서빙 중인 빌드에 수정이 실렸는가"를 밖에서 확인하는 용도
    return NextResponse.json({ error: "서버 오류" }, { status: 500, headers: { "x-ov-pdf": "env-v3" } });
  }
}
