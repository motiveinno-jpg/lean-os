// 핸드오프 → 적용 경로: src/lib/pdf-overlay.ts  (2026-06-29, P1)
//
// 회사 업로드 PDF(배경 양식) 위에 동적 값(거래처·금액·날짜·서명)을 좌표 오버레이.
//   - pdf-lib 로 원본 PDF 로드 → fontkit 으로 NanumGothic 임베드 → drawText/drawImage.
//   - 좌표는 정규화(0~1, 좌상단 원점). pdf-lib 는 좌하단 원점 → y 변환 필수.
//   - jsPDF 로는 기존 PDF 편집 불가 → 이 파일이 pdf-lib 의 유일한 사용처.
//
// ⚠️ 선행: npm install pdf-lib @pdf-lib/fontkit  (미설치 시 import 에러)
// 폰트: pdf-korean-font.ts 와 동일한 NanumGothic TTF(gstatic) 재사용 — 캐시 분리(이쪽은 ArrayBuffer 필요).

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// pdf-korean-font.ts 와 동일 URL (NanumGothic Regular, ~1.1MB)
const FONT_URL =
  "https://fonts.gstatic.com/s/nanumgothic/v23/PN_3Rfi-oW3hYwmKDpxS7F_z_tLfxno73g.ttf";

let cachedFontBytes: ArrayBuffer | null = null;

async function loadFontBytes(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Korean font fetch failed: ${res.status}`);
  cachedFontBytes = await res.arrayBuffer();
  return cachedFontBytes;
}

// pdf_form_templates.fields 의 단일 필드 (DB 스키마와 1:1)
export interface OverlayField {
  key: string;
  label?: string;
  page: number; // 1-base
  x: number;
  y: number;
  w: number;
  h: number; // 정규화 0~1, 좌상단 원점
  align?: "left" | "center" | "right";
  font_size?: number; // pt, 기본 10
  kind: "text" | "amount" | "date" | "signature" | "items_table";
}

export interface FillOptions {
  // key → 값. text/amount/date 는 문자열(또는 숫자), signature 는 PNG dataURL.
  values: Record<string, string | number | null | undefined>;
}

const fmtAmount = (v: string | number) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("ko-KR") : String(v);
};

const fmtDate = (v: string | number) => {
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s;
};

/**
 * 원본 PDF(배경) 위에 fields 값을 오버레이해 채워진 PDF bytes 를 반환.
 * @param pdfBytes  업로드 원본 PDF (storage 에서 받은 ArrayBuffer/Uint8Array)
 * @param fields    pdf_form_templates.fields
 * @param opts      { values: { 거래처명, 합계금액, 작성일, 서명_공급자(dataURL) ... } }
 */
export async function fillFormTemplate(
  pdfBytes: ArrayBuffer | Uint8Array,
  fields: OverlayField[],
  opts: FillOptions
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(await loadFontBytes(), { subset: true });

  const pages = pdfDoc.getPages();
  const { values } = opts;

  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();

    const boxX = f.x * pw;
    const boxW = f.w * pw;
    const boxYTop = f.y * ph; // 좌상단 기준 거리(위에서 아래로)
    const boxH = f.h * ph;

    if (f.kind === "signature") {
      const data = values[f.key];
      if (typeof data === "string" && data.startsWith("data:image")) {
        try {
          const png = await pdfDoc.embedPng(data);
          // 박스 안에 비율 유지 fit
          const scale = Math.min(boxW / png.width, boxH / png.height);
          const dw = png.width * scale;
          const dh = png.height * scale;
          page.drawImage(png, {
            x: boxX + (boxW - dw) / 2,
            y: ph - boxYTop - dh, // 좌하단 원점 변환
            width: dw,
            height: dh,
          });
        } catch {
          /* 서명 임베드 실패 — 스킵(나머지 필드는 계속) */
        }
      }
      continue;
    }

    if (f.kind === "items_table") {
      // P1: 영역만 인식. 행 자동확장은 P5. 여기선 렌더 생략.
      continue;
    }

    const raw = values[f.key];
    if (raw === null || raw === undefined || raw === "") continue;
    let text = String(raw);
    if (f.kind === "amount") text = fmtAmount(raw);
    else if (f.kind === "date") text = fmtDate(raw);

    const size = f.font_size ?? 10;
    const textW = font.widthOfTextAtSize(text, size);
    let tx = boxX;
    if (f.align === "right") tx = boxX + boxW - textW;
    else if (f.align === "center") tx = boxX + (boxW - textW) / 2;

    // 박스 세로 중앙에 baseline 근사: 박스 상단에서 (boxH+size)/2 만큼 내려 baseline.
    const baselineFromTop = boxYTop + (boxH + size) / 2 - size * 0.2;
    page.drawText(text, {
      x: tx,
      y: ph - baselineFromTop,
      size,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
  }

  return pdfDoc.save();
}
