import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildSignedContractPrintHtml, STRIP_BODY_SIGNATURE_FN, PRETENDARD_CSS } from "@/lib/contract-print-html";
import { PDF_SANITIZE_CONFIG, PDF_SANITIZE_URI_REGEXP_SOURCE } from "@/lib/pdf-sanitize-config";
import { isAllowedAssetUrl } from "@/lib/pdf-fetch-guard";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import { getPdfBrowser } from "@/lib/headless-chrome";
import { fetchAssetAsDataUrl } from "@/lib/pdf-fetch-guard";

// 서명자가 남긴 HTML(signed_contract_html)은 외부 입력이다 — 렌더 전에 headless Chrome 안에서 DOMPurify 로 정제하고,
//   네트워크는 data:·자사 Storage·폰트 CDN 만 연다(내부망·임의 호스트 요청 차단). html-pdf 경로와 같은 방어.
const FONT_CDN = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@";
/** 직인 저장 URL → data URL. 비공개 버킷은 서버(service_role)가 직접 내려받고, data: 는 그대로, 그 외 URL 은 allowlist 페치. */
async function sealToDataUrl(admin: ReturnType<typeof createSupabaseAdminClient>, url: string): Promise<string | null> {
  if (url.startsWith("data:image/")) return url;
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
  if (m) {
    try {
      const { data } = await admin.storage.from(m[1]).download(decodeURIComponent(m[2]));
      if (data) {
        const ct = data.type && data.type.startsWith("image/") ? data.type : "image/png";
        const buf = Buffer.from(await data.arrayBuffer());
        if (buf.byteLength <= 5 * 1024 * 1024) return `data:${ct};base64,${buf.toString("base64")}`;
      }
    } catch { /* 아래 allowlist 페치로 */ }
  }
  return fetchAssetAsDataUrl(url);
}
let purifySrc: string | null = null;
function loadPurify(): string {
  if (!purifySrc) purifySrc = readFileSync(join(process.cwd(), "node_modules/dompurify/dist/purify.min.js"), "utf8");
  return purifySrc;
}

// 서명완료 계약서 → 네이티브 인쇄 품질 PDF (업체별 1파일). 클라이언트가 chunk 로 호출 → zip.
export const runtime = "nodejs";
export const maxDuration = 300;

// URL 이미지 → dataURL (계약 양식 오버레이의 갑 직인 seal_url 변환용)
// 브라우저 기동은 공용 런처로 — Vercel 라이브러리 미추출(libnss3) 우회 포함 (headless-chrome.ts)

export async function POST(req: NextRequest) {
  try {
    // 1) 인증 + 권한 (대표/관리자만 — signatures 페이지 게이트와 동일)
    const ss = await createSupabaseServerClient();
    const {
      data: { user },
    } = await ss.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const urow = logRead('contract-pdf/route:urow', await admin
      .from("users")
      .select("company_id, role")
      .eq("auth_id", user.id)
      .maybeSingle());
    if (!urow?.company_id) return NextResponse.json({ error: "회사 정보 없음" }, { status: 403 });
    if (!urow.role || !["owner", "admin"].includes(urow.role)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0) return NextResponse.json({ error: "ids 누락" }, { status: 400 });
    if (ids.length > 20) return NextResponse.json({ error: "한 번에 최대 20건" }, { status: 400 });

    // 2) 본인 회사 + 서명완료 건만 (회사 격리)
    const rows = logRead('contract-pdf/route:rows', await admin
      .from("signature_requests")
      .select(
        "id, signer_name, signature_data_url, signed_contract_html, template_snapshot_html, signed_at, partner_id, status, companies(name, business_number, representative, seal_url)",
      )
      .in("id", ids)
      .eq("company_id", urow.company_id)
      .eq("status", "signed"));

    const list = rows || [];
    // 거래처(을) 정보 — partner_id 별도 조회
    const pIds = [...new Set(list.map((r: any) => r.partner_id).filter(Boolean))];
    const pMap = new Map<string, any>();
    if (pIds.length) {
      const ps = logRead('contract-pdf/route:ps', await admin
        .from("partners")
        .select("id, name, business_number, representative")
        .in("id", pIds));
      (ps || []).forEach((p: any) => pMap.set(p.id, p));
    }

    // P4 — 활성 계약 양식(오버레이)이 있으면 puppeteer 대신 pdf-lib 오버레이로 최종본 생성(없으면 현행 폴백).
    let overlayFields: any[] | null = null;
    let overlayBytes: ArrayBuffer | null = null;
    let sealDataUrl: string | null = null;
    try {
      const tpl = logRead('contract-pdf/route:tpl', await (admin as any)
        .from("pdf_form_templates")
        .select("file_path, fields")
        .eq("company_id", urow.company_id).eq("doc_type", "contract").eq("is_active", true)
        .maybeSingle());
      if (tpl?.file_path) {
        const blob = logRead('contract-pdf/route:blob', await admin.storage.from("form-templates").download(tpl.file_path));
        if (blob) {
          overlayBytes = await blob.arrayBuffer();
          overlayFields = (tpl.fields as any[]) || [];
          const sealUrl = (list[0] as any)?.companies?.seal_url;
          if (sealUrl) sealDataUrl = await sealToDataUrl(admin, sealUrl);
        }
      }
    } catch { overlayFields = null; overlayBytes = null; }

    let browser: Browser | null = null; // 폴백(현행) 경로에서만 지연 launch
    const results: { id: string; pdfBase64?: string; error?: string }[] = [];

    for (const r of list as any[]) {
      const partner = r.partner_id ? pMap.get(r.partner_id) : null;

      // ── 오버레이 경로 (활성 계약 양식) ──
      if (overlayFields && overlayBytes) {
        try {
          const { fillFormTemplate } = await import("@/lib/pdf-overlay");
          const dateStr = r.signed_at ? String(r.signed_at).slice(0, 10) : "";
          const filled = await fillFormTemplate(overlayBytes, overlayFields, {
            values: {
              회사명: r.companies?.name ?? "",
              대표자명: r.companies?.representative ?? "",
              거래처명: partner?.name ?? r.signer_name ?? "",
              거래처대표: partner?.representative ?? "",
              작성일: dateStr,
              계약시작일: dateStr,
              서명_갑: sealDataUrl ?? "",
              서명_을: r.signature_data_url ?? "",
            },
          });
          results.push({ id: r.id, pdfBase64: Buffer.from(filled).toString("base64") });
          continue;
        } catch (e) {
          // 오버레이 실패 → 포기하지 않고 현행 puppeteer 렌더로 폴백(저장 누락 방지).
          console.warn("[contract-pdf] overlay 실패, puppeteer 폴백:", (e as Error)?.message);
        }
      }

      // ── 폴백: 현행 puppeteer 렌더 ──
      if (!browser) browser = await getPdfBrowser();
      const page = await browser.newPage();
      try {
        page.setDefaultNavigationTimeout(30000);
        page.setDefaultTimeout(30000);
        await page.setRequestInterception(true);
        page.on("request", (rq) => {
          const u = rq.url();
          if (u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank") return void rq.continue();
          if (u.startsWith(FONT_CDN) || u === PRETENDARD_CSS) return void rq.continue();
          if (isAllowedAssetUrl(u)) return void rq.continue();
          return void rq.abort();
        });
        // 본문 정제 — dirty HTML 은 evaluate 의 데이터 인자로만 넘어가므로 정제 전에 실행될 길이 없다.
        await page.setContent("<!doctype html><html><body></body></html>");
        await page.addScriptTag({ content: loadPurify() });
        const cleanBody: string = await page.evaluate(
          (dirty, cfg, uriSrc) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dp = (window as any).DOMPurify;
            return dp.sanitize(dirty, { ...cfg, ALLOWED_URI_REGEXP: new RegExp(uriSrc, "i") });
          },
          r.signed_contract_html || r.template_snapshot_html || "", PDF_SANITIZE_CONFIG, PDF_SANITIZE_URI_REGEXP_SOURCE,
        );
        const html = buildSignedContractPrintHtml({
          bodyHtml: cleanBody,
          company: r.companies || null,
          partner: partner
            ? { name: partner.name, business_number: partner.business_number, representative: partner.representative }
            : { name: r.signer_name },
          ourSignatureDataUrl: null, // signature_requests 는 갑 서명 컬럼 없음 → seal_url 사용
          ourSignedAt: null,
          signerSignatureDataUrl: r.signature_data_url,
          signedAtExternal: r.signed_at,
          recipientName: r.signer_name,
        });

        await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
        // 본문 내 거래처 서명 inline-block 블록 제거(푸터와 중복 방지) — ContractViewer 와 동일
        await page.evaluate(STRIP_BODY_SIGNATURE_FN);
        // 웹폰트 로드 완료 대기 (직렬화 가능한 void 반환)
        try {
          await page.evaluate(async () => {
            await (document as any).fonts?.ready;
          });
        } catch {
          /* noop */
        }

        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
        });
        results.push({ id: r.id, pdfBase64: Buffer.from(pdf).toString("base64") });
      } catch (e: any) {
        results.push({ id: r.id, error: String(e?.message || e) });
      } finally {
        await page.close().catch(() => {});
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "서버 오류" }, { status: 500 });
  }
}
