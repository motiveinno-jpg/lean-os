// PDF → 워드/한글식 "흐름 문서" HTML 변환 (2026-07-29)
//   사장님: "영역(절대좌표 조각) 말고 아예 일반 한글파일이나 워드처럼" — 글자가
//   자유롭게 이어지고 지우면 당겨지는 일반 문서 편집이 필요할 때 쓴다.
//   · 줄바꿈: PDF 의 시각적 줄(y좌표) 하나 = 한 줄. 임의 재줄바꿈 없음.
//   · 글자 크기: PDF 폰트 크기(pt)를 px(×4/3)로 환산해 줄마다 그대로 적용.
//   · 정렬: 줄의 좌우 여백으로 가운데/오른쪽 정렬 감지 → text-align 부여.
//   · 표: 연속된 다열(多列) 줄들을 열 좌표로 묶어 실제 편집 가능한 <table> 로 재구성.
//   · 이미지: 페이지 전체 캡처를 배경으로 넣지 않고, 로고·직인 같은 개별 이미지만
//     원래 위치에서 잘라 흐름형 이미지 요소로 삽입.
//   (rich-editor 의 "PDF 글자만" 삽입과 hr 서식 새양식 업로드가 공용으로 사용 —
//    원래 rich-editor 내부에 있던 로직을 그대로 추출한 것. 동작 변경 없음.)
//   브라우저 전용 (pdfjs + canvas).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TextSegment = {
  text: string;
  h: number;
  b: boolean;
  i: boolean;
  c?: string;
  f?: string;
};

type Run = {
  text: string;
  x0: number;
  x1: number;
  h: number;
  segments: TextSegment[];
};

type VLine = { y: number; h: number; runs: Run[] };

export type PdfFlowResult = {
  html: string;
  pageCount: number;
  skippedBackgroundImages: number;
};

type Matrix = [number, number, number, number, number, number];
type ImageRegion = { x: number; y: number; w: number; h: number };

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 렌더된 글자 영역에서 배경과 충분히 다른 대표색을 글자색으로 추정한다. */
function sampleTextColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): string | undefined {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(ctx.canvas.width - sx, Math.max(1, Math.ceil(w)));
  const sh = Math.min(ctx.canvas.height - sy, Math.max(1, Math.ceil(h)));
  if (sw <= 0 || sh <= 0) return undefined;
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
    const bg = ranked[0]?.rgb;
    if (!bg) return undefined;
    const fg = ranked.find((value) => colorDistance(value.rgb, bg) >= 48)?.rgb;
    return fg ? rgbHex(...fg) : undefined;
  } catch {
    return undefined;
  }
}

function safeFontFamily(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9A-Za-z가-힣 _-]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function regionsOverlap(a: ImageRegion, b: ImageRegion): boolean {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  return intersection / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) > 0.8;
}

/**
 * PDF 연산자의 CTM을 따라 개별 이미지의 화면 좌표를 찾는다.
 * 페이지 면적의 65% 이상을 덮는 이미지는 배경/스캔 페이지로 간주해 제외한다.
 */
export function findFlowImageRegions(
  fnArray: number[],
  argsArray: unknown[][],
  ops: Record<string, number>,
  viewportTransform: Matrix,
  pageWidth: number,
  pageHeight: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  util: any,
): { regions: ImageRegion[]; skippedBackgroundImages: number } {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const regions: ImageRegion[] = [];
  let skippedBackgroundImages = 0;
  const imageOps = new Set([
    ops.paintImageXObject,
    ops.paintJpegXObject,
    ops.paintInlineImageXObject,
  ]);

  for (let index = 0; index < fnArray.length; index++) {
    const fn = fnArray[index];
    const args = argsArray[index] || [];
    if (fn === ops.save) {
      stack.push([...ctm] as Matrix);
      continue;
    }
    if (fn === ops.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === ops.transform && args.length >= 6) {
      ctm = util.transform(ctm, (args as number[]).slice(0, 6)) as Matrix;
      continue;
    }
    if (!imageOps.has(fn)) continue;

    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]]
      .map((point) => util.applyTransform(point, ctm))
      .map((point) => util.applyTransform(point, viewportTransform));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    const right = Math.min(pageWidth, Math.max(...xs));
    const bottom = Math.min(pageHeight, Math.max(...ys));
    const region = { x, y, w: right - x, h: bottom - y };
    if (region.w < 4 || region.h < 4) continue;
    if ((region.w * region.h) / Math.max(1, pageWidth * pageHeight) >= 0.65) {
      skippedBackgroundImages++;
      continue;
    }
    if (!regions.some((existing) => regionsOverlap(existing, region))) regions.push(region);
  }

  return { regions: regions.sort((a, b) => a.y - b.y), skippedBackgroundImages };
}

export async function pdfToFlowHtml(
  file: File,
  uploadImage?: (f: File) => Promise<string>,
  onProgress?: (msg: string) => void,
): Promise<PdfFlowResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const OPS = pdfjs.OPS;
  const Util = pdfjs.Util;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const total = pdf.numPages;

  // 페이지별로 HTML 조각을 누적 → 마지막에 한 번에 반환 (전체 페이지 보장).
  const parts: string[] = [];

  let importedItems = 0;
  let skippedBackgroundImages = 0;

  for (let i = 1; i <= total; i++) {
    onProgress?.(`${total}페이지 중 ${i}페이지 변환 중...`);
    const page = await pdf.getPage(i);
    const unitViewport = page.getViewport({ scale: 1.0 });
    const pageW = unitViewport.width;
    const renderScale = 2;
    const renderViewport = page.getViewport({ scale: renderScale });
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = Math.ceil(renderViewport.width);
    pageCanvas.height = Math.ceil(renderViewport.height);
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) continue;
    await page.render({ canvasContext: pageCtx, viewport: renderViewport }).promise;

    // 1) 연산자 목록으로 개별 이미지 좌표를 찾는다. 전체 페이지 이미지(배경/스캔)는 제외.
    //    페이지 렌더에서 해당 사각형만 잘라 쓰므로 원본 디코딩 형식과 무관하게 보존된다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let operatorList: any = null;
    try { operatorList = await page.getOperatorList(); } catch { /* 이미지 없는 PDF */ }
    const foundImages = operatorList
      ? findFlowImageRegions(
          operatorList.fnArray,
          operatorList.argsArray,
          OPS,
          renderViewport.transform as Matrix,
          pageCanvas.width,
          pageCanvas.height,
          Util,
        )
      : { regions: [], skippedBackgroundImages: 0 };
    skippedBackgroundImages += foundImages.skippedBackgroundImages;

    const imageItems: { top: number; html: string }[] = [];
    for (let imageIndex = 0; imageIndex < foundImages.regions.length; imageIndex++) {
      const region = foundImages.regions[imageIndex];
      const sx = Math.max(0, Math.floor(region.x));
      const sy = Math.max(0, Math.floor(region.y));
      const sw = Math.min(pageCanvas.width - sx, Math.max(1, Math.ceil(region.w)));
      const sh = Math.min(pageCanvas.height - sy, Math.max(1, Math.ceil(region.h)));
      if (sw <= 0 || sh <= 0) continue;
      const crop = document.createElement("canvas");
      crop.width = sw;
      crop.height = sh;
      const cropCtx = crop.getContext("2d");
      if (!cropCtx) continue;
      cropCtx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) =>
        crop.toBlob((value) => resolve(value), "image/png"),
      );
      let src = crop.toDataURL("image/png");
      if (blob && uploadImage) {
        src = await uploadImage(new File(
          [blob],
          `${file.name.replace(/\.pdf$/i, "")}-p${i}-image${imageIndex + 1}.png`,
          { type: "image/png" },
        ));
      }
      // PDF pt → CSS px(×4/3). data-* 는 TipTap 이미지 확장에서 보존한다.
      const flowWidth = Math.max(16, Math.round((region.w / renderScale) * (4 / 3)));
      const flowOffset = Math.max(0, Math.round((region.x / renderScale) * (4 / 3)));
      imageItems.push({
        top: region.y / renderScale,
        html:
          `<img src="${escapeHtml(src)}" alt="PDF ${i}페이지 이미지 ${imageIndex + 1}" ` +
          `data-flow-image="1" data-flow-width="${flowWidth}" data-flow-offset="${flowOffset}">`,
      });
    }
    importedItems += imageItems.length;

    // 2) 텍스트 아이템 수집 (위치·크기·굵기·기울임·글꼴·색상)
    type RawItem = {
      str: string; x: number; y: number; w: number; h: number;
      b: boolean; i: boolean; c?: string; f?: string;
    };
    const rawItems: RawItem[] = [];
    try {
      const tc = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of tc.items as any[]) {
        // PDF.js 가 표 셀 사이의 빈 영역을 폭이 큰 공백 item 으로 내보내기도 한다.
        // 이를 run 에 합치면 서로 다른 셀의 글자가 한 문장으로 붙으므로, 공백 자체는
        // 버리고 실제 글자 사이의 x 간격으로 일반 띄어쓰기/열 구분을 다시 판단한다.
        if (
          typeof it.str !== "string" ||
          it.str.trim().length === 0 ||
          !Array.isArray(it.transform)
        ) continue;
        const h = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
        const x = it.transform[4] || 0;
        const y = it.transform[5] || 0;
        const w = it.width || 0;
        const styleFamily = safeFontFamily(String(tc.styles?.[it.fontName]?.fontFamily || ""));
        let fontName = "";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fontObj: any = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName) : null;
          fontName = String(fontObj?.name || "");
        } catch { /* 미해석 폰트는 textContent 스타일만 사용 */ }
        const combinedFont = `${fontName} ${styleFamily || ""}`;
        const [screenX, baselineY] = Util.applyTransform([x, y], renderViewport.transform);
        rawItems.push({
          str: it.str,
          x,
          y,
          w,
          h,
          b: /bold|black|heavy|extrab|semib/i.test(combinedFont),
          i: /italic|oblique/i.test(combinedFont),
          f: styleFamily || safeFontFamily(fontName),
          c: sampleTextColor(
            pageCtx,
            screenX,
            baselineY - h * renderScale * 1.08,
            Math.max(w, h) * renderScale,
            h * renderScale * 1.35,
          ),
        });
      }
    } catch { /* 텍스트 레이어 없는 페이지 */ }

    // 3) y좌표로 시각적 줄 복원 → 줄 안에서 x 간격으로 run(연속 글자 덩어리) 분리.
    //    한 run 안에서도 서식 segment 를 유지해 굵은 부분·색상 등이 사라지지 않게 한다.
    rawItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const vlines: VLine[] = [];
    for (const it of rawItems) {
      const segment: TextSegment = {
        text: it.str, h: it.h, b: it.b, i: it.i, c: it.c, f: it.f,
      };
      const run: Run = {
        text: it.str, x0: it.x, x1: it.x + it.w, h: it.h, segments: [segment],
      };
      const last = vlines[vlines.length - 1];
      if (last && Math.abs(last.y - it.y) <= Math.max(2.5, last.h * 0.5)) {
        last.runs.push(run);
        last.h = Math.max(last.h, it.h);
      } else {
        vlines.push({ y: it.y, h: it.h, runs: [run] });
      }
    }
    // run 병합: 좁은 간격은 같은 덩어리(공백 복원), 넓은 간격은 열 구분으로 유지
    for (const ln of vlines) {
      ln.runs.sort((a, b) => a.x0 - b.x0);
      const merged: Run[] = [];
      for (const r of ln.runs) {
        const cur = merged[merged.length - 1];
        const em = Math.max(cur?.h || 0, r.h, 6);
        if (cur && r.x0 - cur.x1 <= em * 1.1) {
          const needsSpace = r.x0 - cur.x1 > em * 0.22;
          cur.text += `${needsSpace ? " " : ""}${r.text}`;
          if (needsSpace && r.segments.length) r.segments[0].text = ` ${r.segments[0].text}`;
          cur.segments.push(...r.segments);
          cur.x1 = Math.max(cur.x1, r.x1);
          cur.h = Math.max(cur.h, r.h);
        } else {
          merged.push({ ...r, segments: r.segments.map((segment) => ({ ...segment })) });
        }
      }
      ln.runs = merged.filter((r) => r.text.trim().length > 0);
    }
    const textLines = vlines.filter((l) => l.runs.length > 0);

    const pxOf = (h: number) => Math.min(72, Math.max(6, Math.round((h * 4) / 3)));
    const spanOf = (r: Run) => r.segments.map((segment, index) => {
      let text = segment.text;
      if (index === 0) text = text.trimStart();
      if (index === r.segments.length - 1) text = text.trimEnd();
      const styles = [
        `font-size: ${pxOf(segment.h)}px`,
        segment.c ? `color: ${segment.c}` : "",
        segment.f ? `font-family: &quot;${escapeHtml(segment.f)}&quot;` : "",
        segment.i ? "font-style: italic" : "",
      ].filter(Boolean).join("; ");
      const inner = `<span style="${styles}">${escapeHtml(text)}</span>`;
      return segment.b ? `<strong>${inner}</strong>` : inner;
    }).join("");
    const alignOf = (l: VLine): "left" | "center" | "right" => {
      const x0 = Math.min(...l.runs.map((r) => r.x0));
      const x1 = Math.max(...l.runs.map((r) => r.x1));
      const lm = x0, rm = pageW - x1;
      if (Math.abs(lm - rm) < pageW * 0.1 && lm > pageW * 0.15) return "center";
      if (rm < pageW * 0.08 && lm > pageW * 0.3) return "right";
      return "left";
    };

    // 4) 표 재구성 — 연속 2줄 이상이 다열(runs≥2)이면 실제 편집 가능한 table 로 만든다.
    let tablesBuilt = 0;
    const pageHtml: string[] = [];
    let nextImage = 0;
    let para: { align: string; lines: string[] } | null = null;
    let prevY: number | null = null;
    let prevH = 0;
    const flushPara = () => {
      if (para && para.lines.length) {
        const alignStyle = para.align !== "left" ? ` style="text-align: ${para.align}"` : "";
        pageHtml.push(`<p${alignStyle}>${para.lines.join("<br>")}</p>`);
      }
      para = null;
    };
    const flushImagesBefore = (top: number) => {
      while (nextImage < imageItems.length && imageItems[nextImage].top <= top) {
        flushPara();
        pageHtml.push(imageItems[nextImage].html);
        nextImage++;
      }
    };

    let li = 0;
    while (li < textLines.length) {
      const ln = textLines[li];
      const lineTop = Util.applyTransform([0, ln.y], unitViewport.transform)[1];
      flushImagesBefore(lineTop);
      // 표 밴드 감지: 이 줄부터 연속으로 다열인 줄 세기
      let bandEnd = li;
      while (bandEnd < textLines.length && textLines[bandEnd].runs.length >= 2) bandEnd++;
      if (bandEnd - li >= 2) {
        flushPara();
        const band = textLines.slice(li, bandEnd);
        // 열 좌표 클러스터링 (시작 x 기준, 페이지폭 3% 허용)
        const cols: number[] = [];
        for (const bl of band) {
          for (const r of bl.runs) {
            const hit = cols.findIndex((c) => Math.abs(c - r.x0) <= pageW * 0.03);
            if (hit < 0) cols.push(r.x0);
          }
        }
        cols.sort((a, b) => a - b);
        const rows = band.map((bl) => {
          const cells: string[] = new Array(cols.length).fill("");
          for (const r of bl.runs) {
            let ci = 0, best = Infinity;
            cols.forEach((c, idx) => { const d = Math.abs(c - r.x0); if (d < best) { best = d; ci = idx; } });
            cells[ci] = cells[ci] ? `${cells[ci]} ${spanOf(r)}` : spanOf(r);
          }
          return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
        });
        // 열 너비를 원본 x좌표 비율대로 — 표 모양이 PDF 와 최대한 같게
        const bandRight = Math.max(...band.flatMap((bl) => bl.runs.map((r) => r.x1)));
        const bounds = [...cols.slice(1), bandRight + 8];
        const totalW = bounds[bounds.length - 1] - cols[0] || 1;
        const colgroup = `<colgroup>${cols.map((c, idx) =>
          `<col style="width: ${Math.max(5, Math.round(((bounds[idx] - c) / totalW) * 100))}%">`
        ).join("")}</colgroup>`;
        pageHtml.push(`<table>${colgroup}<tbody>${rows.join("")}</tbody></table>`);
        tablesBuilt++;
        prevY = band[band.length - 1].y;
        prevH = band[band.length - 1].h;
        li = bandEnd;
        continue;
      }

      // 일반 줄: PDF 줄바꿈 그대로 — 정렬 같고 줄간격이 촘촘하면 같은 문단에 <br> 로 잇는다
      const align = alignOf(ln);
      const lineHtml = ln.runs.map(spanOf).join("&nbsp;&nbsp;&nbsp;");
      const gapBig = prevY !== null && prevY - ln.y > Math.max(prevH, ln.h) * 1.9;
      if (!para || para.align !== align || gapBig) {
        flushPara();
        para = { align, lines: [lineHtml] };
      } else {
        para.lines.push(lineHtml);
      }
      prevY = ln.y;
      prevH = ln.h;
      li++;
    }
    flushPara();
    flushImagesBefore(Infinity);

    // 페이지 전체 배경이나 페이지 번호 표시는 넣지 않는다. 각 페이지의 실제 내용만
    // 하나의 일반 문서 흐름으로 이어져 새 표/문장을 중간에 넣으면 아래가 자연스럽게 밀린다.
    if (pageHtml.length > 0) {
      parts.push(pageHtml.join(""));
      importedItems += textLines.length + tablesBuilt;
    }
  }

  if (importedItems === 0) {
    throw new Error(
      "편집 가능한 글자·표·개별 이미지를 찾지 못했습니다. 스캔된 페이지 전체 이미지는 배경으로 불러오지 않습니다.",
    );
  }

  return { html: parts.join(""), pageCount: total, skippedBackgroundImages };
}
