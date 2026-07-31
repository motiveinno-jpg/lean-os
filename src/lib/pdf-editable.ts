// PDF → "원본 그대로 + 글자 수정 가능" HTML 변환.
// 원본 페이지 전체를 이미지로 보존하고, PDF 텍스트 조각을 같은 좌표의 투명한 편집
// 레이어로 얹는다. 수정하지 않은 글자는 원본 이미지가 그대로 보이고, 사용자가 고친
// 조각만 배경을 덮은 뒤 편집 텍스트로 표시되므로 폰트·색·줄바꿈·괘선 손실이 없다.

export const PDF_PAGE_W = 794; // A4 @96dpi 기준 편집 폭

export type PdfEditableText = {
  t: string;
  x: number;
  y: number;
  fs: number;
  w: number;
  b?: boolean;
  i?: boolean;
  c?: string;
  bg?: string;
  f?: string;
  e?: boolean;
};

function safeFontFamily(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9A-Za-z가-힣 _-]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

export function pdfTextSpanStyle(
  t: PdfEditableText,
  pageH: number,
  forceVisible = false,
): string {
  const left = ((t.x / PDF_PAGE_W) * 100).toFixed(3);
  const top = pageH > 0 ? ((t.y / pageH) * 100).toFixed(3) : "0";
  const fs = ((t.fs / PDF_PAGE_W) * 100).toFixed(3);
  const minW = ((Math.max(1, t.w) / PDF_PAGE_W) * 100).toFixed(3);
  const visible = forceVisible || t.e;
  const font = safeFontFamily(t.f);
  return [
    "position:absolute",
    `left:${left}%`,
    `top:${top}%`,
    `font-size:${fs}cqw`,
    `min-width:${minW}cqw`,
    "display:inline-block",
    t.b ? "font-weight:700" : "",
    t.i ? "font-style:italic" : "",
    font ? `font-family:"${font}"` : "",
    "white-space:pre",
    "line-height:1.15",
    visible ? `color:${t.c || "#111111"}` : "color:transparent",
    visible ? `background:${t.bg || "#ffffff"}` : "background:transparent",
    `caret-color:${t.c || "#111111"}`,
  ].filter(Boolean).join(";") + ";";
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 렌더된 글자 박스에서 가장 넓은 색을 배경, 배경과 다른 대표색을 글자색으로 추정. */
function sampleTextColors(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): { c?: string; bg?: string } {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(ctx.canvas.width - sx, Math.max(1, Math.ceil(w)));
  const sh = Math.min(ctx.canvas.height - sy, Math.max(1, Math.ceil(h)));
  if (sw <= 0 || sh <= 0) return {};
  try {
    const pixels = ctx.getImageData(sx, sy, sw, sh).data;
    const bins = new Map<string, { rgb: [number, number, number]; count: number }>();
    const step = sw * sh > 30_000 ? 2 : 1;
    for (let p = 0; p < pixels.length; p += 4 * step) {
      if (pixels[p + 3] < 128) continue;
      const rgb: [number, number, number] = [
        Math.round(pixels[p] / 16) * 16,
        Math.round(pixels[p + 1] / 16) * 16,
        Math.round(pixels[p + 2] / 16) * 16,
      ];
      const key = rgb.join(",");
      const hit = bins.get(key);
      if (hit) hit.count++;
      else bins.set(key, { rgb, count: 1 });
    }
    const ranked = [...bins.values()].sort((a, b) => b.count - a.count);
    if (!ranked.length) return {};
    const bg = ranked[0].rgb;
    const fg = ranked.find((v) => colorDistance(v.rgb, bg) >= 48)?.rgb;
    return {
      bg: rgbHex(...bg),
      c: fg ? rgbHex(...fg) : undefined,
    };
  } catch {
    return {};
  }
}

function fontMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styles: Record<string, any>,
  fontName: string,
): Pick<PdfEditableText, "b" | "i" | "f"> {
  let name = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontObj: any = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
    name = String(fontObj?.name || "");
  } catch { /* 미해석 폰트는 PDF.js 스타일 정보만 사용 */ }
  const styleFamily = String(styles?.[fontName]?.fontFamily || "");
  const combined = `${name} ${styleFamily}`;
  return {
    b: /bold|black|heavy|extrab|semib/i.test(combined) || undefined,
    i: /italic|oblique/i.test(combined) || undefined,
    f: safeFontFamily(styleFamily || name),
  };
}

function sameTextStyle(a: PdfEditableText, b: PdfEditableText): boolean {
  return Math.abs(a.fs - b.fs) <= 0.8
    && !!a.b === !!b.b
    && !!a.i === !!b.i
    && (a.f || "") === (b.f || "")
    && (a.bg || "") === (b.bg || "");
}

/**
 * PDF.js가 자간이 있는 한글을 한 글자씩 반환해도 같은 줄·같은 서식의 인접 글자는
 * 한 덩어리로 묶는다. 이름/주소/문장을 한 번에 선택해 수정하거나 변수로 교체할 수 있다.
 */
export function mergeEditableTextItems(items: PdfEditableText[]): PdfEditableText[] {
  const sorted = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines: PdfEditableText[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    const anchor = line?.[0];
    if (anchor && Math.abs(anchor.y - item.y) <= Math.max(anchor.fs, item.fs) * 0.35) {
      line.push({ ...item });
    } else {
      lines.push([{ ...item }]);
    }
  }

  return lines.flatMap((line) => {
    line.sort((a, b) => a.x - b.x);
    const merged: PdfEditableText[] = [];
    for (const item of line) {
      const current = merged[merged.length - 1];
      if (!current) {
        merged.push({ ...item });
        continue;
      }
      const right = current.x + current.w;
      const gap = item.x - right;
      const em = Math.max(current.fs, item.fs, 6);
      if (sameTextStyle(current, item) && gap <= em * 0.55) {
        const needsSpace = gap > em * 0.2
          && !/\s$/.test(current.t)
          && !/^\s/.test(item.t);
        current.t += `${needsSpace ? " " : ""}${item.t}`;
        current.w = Math.max(right, item.x + item.w) - current.x;
        continue;
      }
      merged.push({ ...item });
    }
    return merged;
  });
}

export async function pdfToEditableHtml(
  file: File,
  uploadImage?: (f: File) => Promise<string>,
  onProgress?: (message: string) => void,
): Promise<{ html: string; pageCount: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const Util = pdfjs.Util;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const container = document.createElement("div");

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    onProgress?.(`${pdf.numPages}페이지 중 ${pageNo}페이지 변환 중...`);
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const factor = PDF_PAGE_W / viewport.width;
    const pageH = Math.round(viewport.height * factor);
    const renderScale = 2.5;
    const imageViewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = imageViewport.width;
    canvas.height = imageViewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport: imageViewport }).promise;

    try { await page.getOperatorList(); } catch { /* 폰트 메타 로딩 실패는 무시 */ }
    const rawTexts: PdfEditableText[] = [];
    try {
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        if (typeof item.str !== "string" || !item.str.trim() || !Array.isArray(item.transform)) continue;
        const fontHeight = Math.hypot(item.transform[2] || 0, item.transform[3] || 0) || 10;
        const [dx, dy] = Util.applyTransform([item.transform[4], item.transform[5]], viewport.transform);
        const fs = Math.max(6, Math.round(fontHeight * factor * 10) / 10);
        const w = Math.max(1, Math.round((item.width || 0) * factor * 10) / 10);
        const colors = sampleTextColors(
          ctx,
          dx * renderScale,
          (dy - fontHeight * 1.08) * renderScale,
          Math.max(item.width || fontHeight, 1) * renderScale,
          fontHeight * 1.35 * renderScale,
        );
        rawTexts.push({
          t: item.str,
          x: Math.round(dx * factor),
          y: Math.round(dy * factor - fs * 0.83),
          fs,
          w,
          ...fontMeta(page, textContent.styles || {}, item.fontName),
          ...colors,
        });
      }
    } catch { /* 텍스트 레이어 없는 스캔 PDF는 원본 이미지만 유지 */ }

    const texts = mergeEditableTextItems(rawTexts);

    let src: string;
    if (uploadImage) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/png"),
      );
      try {
        const uploaded = blob
          ? await uploadImage(new File(
              [blob],
              `${file.name.replace(/\.pdf$/i, "")}-p${pageNo}.png`,
              { type: "image/png" },
            ))
          : canvas.toDataURL("image/png");
        // 로컬 Supabase URL은 운영 CSP의 img-src 허용 대상이 아니므로 로컬 검증에서는
        // 인라인 이미지를 사용한다. 운영 *.supabase.co URL은 업로드 결과를 그대로 저장.
        src = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(uploaded)
          ? canvas.toDataURL("image/png")
          : uploaded;
      } catch {
        src = canvas.toDataURL("image/png");
      }
    } else {
      src = canvas.toDataURL("image/png");
    }

    const pageDiv = document.createElement("div");
    pageDiv.setAttribute("data-pdf-page", "1");
    pageDiv.setAttribute("data-w", String(PDF_PAGE_W));
    pageDiv.setAttribute("data-h", String(pageH));
    pageDiv.setAttribute("data-texts", JSON.stringify(texts));
    pageDiv.style.cssText =
      `position:relative;width:${PDF_PAGE_W}px;max-width:100%;margin:12px auto;` +
      "background:#fff;container-type:inline-size;";

    const img = document.createElement("img");
    img.src = src;
    img.alt = `PDF ${pageNo}페이지 원본`;
    img.style.cssText = "width:100%;display:block;";
    pageDiv.appendChild(img);

    for (const text of texts) {
      const span = document.createElement("span");
      span.textContent = text.t;
      span.style.cssText = pdfTextSpanStyle(text, pageH);
      pageDiv.appendChild(span);
    }
    container.appendChild(pageDiv);
  }

  return { html: container.innerHTML, pageCount: pdf.numPages };
}
