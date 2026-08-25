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

/** 렌더된 글자 영역에서 배경과 충분히 다른 대표색을 글자색으로 추정한다.
 *  ⚠️ 2026-08-25 사장님 리포트("연한 글씨들은 아예 잘 보이지도 않아")로 수정:
 *  예전엔 배경과 48 이상 떨어진 색 중 '가장 픽셀 수가 많은' 색을 골랐는데, 획이 가는
 *  글자(괄호·조사·①…)는 안티앨리어스 중간톤(연회색) 픽셀이 실제 글자색보다 많아
 *  검정 글자가 rgb(208,208,208) 같은 연회색으로 추출됐다. 이제 픽셀 수 × 배경과의
 *  거리² 가중치로 골라 '진짜 획 색'이 이기게 하고, 그래도 배경과 너무 가까운 색이면
 *  색을 버려 기본 글자색(진한 색)으로 렌더한다 — 안 보이는 글자를 만들지 않는다. */
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
    // 배경과의 거리²×픽셀수 가중치 최대 = 안티앨리어스 중간톤이 아닌 실제 획 색
    let fg: [number, number, number] | undefined;
    let best = 0;
    for (const bin of ranked.slice(1)) {
      const d = colorDistance(bin.rgb, bg);
      if (d < 48) continue;
      const score = bin.count * d * d;
      if (score > best) { best = score; fg = bin.rgb; }
    }
    if (!fg) return undefined;
    // 가독 하한: 밝은 배경에서 추출색이 여전히 연하면(모든 채널 ≥200) 색을 버린다
    //   → span 에 color 미지정 = 문서 기본색(진한 색)으로 보인다.
    const bgLight = bg[0] + bg[1] + bg[2] >= 600;
    if (bgLight && Math.min(fg[0], fg[1], fg[2]) >= 200) return undefined;
    return rgbHex(...fg);
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
        // font-family 는 내보내지 않는다 (2026-08-25 발급 PDF 한글 소실의 진범):
        //   pdfjs 가 추측한 값은 "sans-serif" 같은 제네릭이라, span 마다 박히면 문서
        //   기본 한글 폰트(Pretendard)를 덮어써 서버 렌더에서 한글 글리프가 통째로
        //   빠졌다. PDF 원본 폰트는 어차피 렌더 환경에 없으므로 굵기·기울임·크기·색만
        //   보존하고 글꼴은 문서 기본을 따르게 한다.
        segment.i ? "font-style: italic" : "",
      ].filter(Boolean).join("; ");
      const inner = `<span style="${styles}">${escapeHtml(text)}</span>`;
      return segment.b ? `<strong>${inner}</strong>` : inner;
    }).join("");
    // 페이지 자체의 본문 여백(왼쪽 글 시작선·오른쪽 글 끝선)을 먼저 잰다.
    //   절대 페이지폭 기준으로 판정하면 여백이 넓은 문서에서 본문 전체가 '가운데'로
    //   오판되거나, 반대로 진짜 가운데 제목을 못 잡는다(2026-08-25 왼쪽 치우침 리포트).
    const xs0 = textLines.map((l) => Math.min(...l.runs.map((r) => r.x0))).sort((a, b) => a - b);
    const xs1 = textLines.map((l) => Math.max(...l.runs.map((r) => r.x1))).sort((a, b) => a - b);
    const baseL = xs0.length ? xs0[Math.floor(xs0.length * 0.05)] : 0;               // 글 시작선(5분위)
    const baseR = xs1.length ? xs1[Math.min(xs1.length - 1, Math.floor(xs1.length * 0.95))] : pageW; // 글 끝선(95분위)
    const alignOf = (l: VLine): "left" | "center" | "right" => {
      const x0 = Math.min(...l.runs.map((r) => r.x0));
      const x1 = Math.max(...l.runs.map((r) => r.x1));
      const li2 = x0 - baseL;   // 본문 시작선 대비 왼쪽 들임
      const ri2 = baseR - x1;   // 본문 끝선 대비 오른쪽 들임
      if (li2 > pageW * 0.06 && ri2 > pageW * 0.06 && Math.abs(li2 - ri2) < pageW * 0.08) return "center";
      if (ri2 < pageW * 0.02 && li2 > pageW * 0.25) return "right";
      return "left";
    };
    // 왼쪽 정렬 줄의 들여쓰기(pt) — 본문 시작선 대비. 표·중앙·오른쪽 줄은 0.
    const indentOf = (l: VLine): number => {
      const d = Math.min(...l.runs.map((r) => r.x0)) - baseL;
      return d >= 6 ? d : 0; // 6pt(≈2글자 반 칸) 미만은 잡음으로 무시
    };

    // 4) 표 재구성 — 연속 2줄 이상이 다열(runs≥2)이면 실제 편집 가능한 table 로 만든다.
    let tablesBuilt = 0;
    const pageHtml: string[] = [];
    let nextImage = 0;
    let para: { align: string; indent: number; gap: number; lines: string[] } | null = null;
    let prevY: number | null = null;
    let prevH = 0;
    const flushPara = () => {
      if (para && para.lines.length) {
        // 들여쓰기·문단 앞 간격은 data-* 로 남겨 리치에디터(TipTap flowIndent/flowGap)가
        // 재편집 후에도 보존한다. style 은 에디터 밖(발급 PDF·미리보기) 렌더용.
        const indentPx = Math.round((para.indent * 4) / 3);
        const styles = [
          para.align !== "left" ? `text-align: ${para.align}` : "",
          indentPx > 0 ? `margin-left: ${indentPx}px` : "",
          para.gap > 0 ? `margin-top: ${para.gap}px` : "",
        ].filter(Boolean).join("; ");
        const attrs =
          (styles ? ` style="${styles}"` : "") +
          (indentPx > 0 ? ` data-flow-indent="${indentPx}"` : "") +
          (para.gap > 0 ? ` data-flow-gap="${para.gap}"` : "");
        pageHtml.push(`<p${attrs}>${para.lines.join("<br>")}</p>`);
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

      // 일반 줄: PDF 줄바꿈 그대로 — 정렬·들여쓰기가 같고 줄간격이 촘촘하면 같은 문단에 <br> 로 잇는다
      const align = alignOf(ln);
      const indent = align === "left" ? indentOf(ln) : 0;
      // 열로 나뉜 덩어리 사이 간격을 원본 비율대로 복원 — 고정 3칸이면 라벨·값이 다 붙는다
      const lineHtml = ln.runs.map((r, ri) => {
        if (ri === 0) return spanOf(r);
        const gapPt = Math.max(0, r.x0 - ln.runs[ri - 1].x1);
        const em = Math.max(ln.runs[ri - 1].h, r.h, 6);
        const n = Math.min(40, Math.max(2, Math.round(gapPt / (em * 0.3))));
        return "&nbsp;".repeat(n) + spanOf(r);
      }).join("");
      const advance = prevY !== null ? prevY - ln.y : 0;
      const gapBig = prevY !== null && advance > Math.max(prevH, ln.h) * 1.9;
      // 문단 앞 간격(px): 원본의 초과 줄간격을 그대로 — "조항 사이 여백"이 살아야 자연스럽다
      const gapPx = gapBig
        ? Math.min(48, Math.max(4, Math.round(((advance - Math.max(prevH, ln.h) * 1.4) * 4) / 3)))
        : 0;
      const sameIndent = para !== null && Math.abs(para.indent - indent) < 4;
      if (!para || para.align !== align || !sameIndent || gapBig) {
        flushPara();
        para = { align, indent, gap: gapPx, lines: [lineHtml] };
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
