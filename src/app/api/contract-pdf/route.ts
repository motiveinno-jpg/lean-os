import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildSignedContractPrintHtml, STRIP_BODY_SIGNATURE_FN } from "@/lib/contract-print-html";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

// 서명완료 계약서 → 네이티브 인쇄 품질 PDF (업체별 1파일). 클라이언트가 chunk 로 호출 → zip.
export const runtime = "nodejs";
export const maxDuration = 300;

// URL 이미지 → dataURL (계약 양식 오버레이의 갑 직인 seal_url 변환용)
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// 서버리스 warm 인스턴스 재사용 — 콜드스타트(브라우저 launch) 1회로 분산
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
    // 1) 인증 + 권한 (대표/관리자만 — signatures 페이지 게이트와 동일)
    const ss = await createSupabaseServerClient();
    const {
      data: { user },
    } = await ss.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data: urow } = await admin
      .from("users")
      .select("company_id, role")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!urow?.company_id) return NextResponse.json({ error: "회사 정보 없음" }, { status: 403 });
    if (!urow.role || !["owner", "admin"].includes(urow.role)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0) return NextResponse.json({ error: "ids 누락" }, { status: 400 });
    if (ids.length > 20) return NextResponse.json({ error: "한 번에 최대 20건" }, { status: 400 });

    // 2) 본인 회사 + 서명완료 건만 (회사 격리)
    const { data: rows } = await admin
      .from("signature_requests")
      .select(
        "id, signer_name, signature_data_url, signed_contract_html, template_snapshot_html, signed_at, partner_id, status, companies(name, business_number, representative, seal_url)",
      )
      .in("id", ids)
      .eq("company_id", urow.company_id)
      .eq("status", "signed");

    const list = rows || [];
    // 거래처(을) 정보 — partner_id 별도 조회
    const pIds = [...new Set(list.map((r: any) => r.partner_id).filter(Boolean))];
    const pMap = new Map<string, any>();
    if (pIds.length) {
      const { data: ps } = await admin
        .from("partners")
        .select("id, name, business_number, representative")
        .in("id", pIds);
      (ps || []).forEach((p: any) => pMap.set(p.id, p));
    }

    // P4 — 활성 계약 양식(오버레이)이 있으면 puppeteer 대신 pdf-lib 오버레이로 최종본 생성(없으면 현행 폴백).
    let overlayFields: any[] | null = null;
    let overlayBytes: ArrayBuffer | null = null;
    let sealDataUrl: string | null = null;
    try {
      const { data: tpl } = await (admin as any)
        .from("pdf_form_templates")
        .select("file_path, fields")
        .eq("company_id", urow.company_id).eq("doc_type", "contract").eq("is_active", true)
        .maybeSingle();
      if (tpl?.file_path) {
        const { data: blob } = await admin.storage.from("form-templates").download(tpl.file_path);
        if (blob) {
          overlayBytes = await blob.arrayBuffer();
          overlayFields = (tpl.fields as any[]) || [];
          const sealUrl = (list[0] as any)?.companies?.seal_url;
          if (sealUrl) sealDataUrl = await fetchAsDataUrl(sealUrl);
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
        } catch (e: any) {
          results.push({ id: r.id, error: "overlay 실패: " + String(e?.message || e) });
          continue;
        }
      }

      // ── 폴백: 현행 puppeteer 렌더 ──
      if (!browser) browser = await getBrowser();
      const page = await browser.newPage();
      try {
        const html = buildSignedContractPrintHtml({
          bodyHtml: r.signed_contract_html || r.template_snapshot_html || "",
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
