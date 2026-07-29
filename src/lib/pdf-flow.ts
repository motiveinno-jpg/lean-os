// PDF → 워드/한글식 "흐름 문서" HTML 변환 (2026-07-29)
//   사장님: "영역(절대좌표 조각) 말고 아예 일반 한글파일이나 워드처럼" — 글자가
//   자유롭게 이어지고 지우면 당겨지는 일반 문서 편집이 필요할 때 쓴다.
//   · 줄바꿈: PDF 의 시각적 줄(y좌표) 하나 = 한 줄. 임의 재줄바꿈 없음.
//   · 글자 크기: PDF 폰트 크기(pt)를 px(×4/3)로 환산해 줄마다 그대로 적용.
//   · 정렬: 줄의 좌우 여백으로 가운데/오른쪽 정렬 감지 → text-align 부여.
//   · 표: 연속된 다열(多列) 줄들을 열 좌표로 묶어 실제 편집 가능한 <table> 로 재구성.
//   · 이미지·괘선 페이지(직인·로고 등)만 페이지 PNG 로 보존해 유실 방지.
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

export async function pdfToFlowHtml(
  file: File,
  uploadImage?: (f: File) => Promise<string>,
  onProgress?: (msg: string) => void,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const OPS = pdfjs.OPS;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const total = pdf.numPages;

  // 페이지별로 HTML 조각을 누적 → 마지막에 한 번에 반환 (전체 페이지 보장).
  const parts: string[] = [];

  type Run = { text: string; x0: number; x1: number; h: number; b: boolean };
  type VLine = { y: number; h: number; runs: Run[] };

  for (let i = 1; i <= total; i++) {
    onProgress?.(`${total}페이지 중 ${i}페이지 변환 중...`);
    const page = await pdf.getPage(i);
    const pageW = page.getViewport({ scale: 1.0 }).width;

    // 1) 텍스트 아이템 수집 (x·y·폭·글자크기·굵기)
    //    굵기: getOperatorList 로 폰트가 로드된 뒤 commonObjs 에서 실제 폰트명(…-Bold 등) 조회
    try { await page.getOperatorList(); } catch { /* 폰트 로딩 실패는 무시 */ }
    const boldFontCache = new Map<string, boolean>();
    const isBoldFont = (fontName: string): boolean => {
      if (!fontName) return false;
      const hit = boldFontCache.get(fontName);
      if (hit !== undefined) return hit;
      let bold = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fontObj: any = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
        bold = /bold|black|heavy|extrab|semib/i.test(String(fontObj?.name || ""));
      } catch { /* 미해석 폰트는 일반 취급 */ }
      boldFontCache.set(fontName, bold);
      return bold;
    };
    const rawItems: { str: string; x: number; y: number; w: number; h: number; b: boolean }[] = [];
    try {
      const tc = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of tc.items as any[]) {
        if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
        const h = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
        rawItems.push({ str: it.str, x: it.transform[4] || 0, y: it.transform[5] || 0, w: it.width || 0, h, b: isBoldFont(it.fontName) });
      }
    } catch { /* 텍스트 레이어 없는 페이지 */ }

    // 2) y좌표로 시각적 줄 복원 → 줄 안에서 x 간격으로 run(연속 글자 덩어리) 분리
    rawItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const vlines: VLine[] = [];
    for (const it of rawItems) {
      const last = vlines[vlines.length - 1];
      if (last && Math.abs(last.y - it.y) <= Math.max(2.5, last.h * 0.5)) {
        last.runs.push({ text: it.str, x0: it.x, x1: it.x + it.w, h: it.h, b: it.b });
        last.h = Math.max(last.h, it.h);
      } else {
        vlines.push({ y: it.y, h: it.h, runs: [{ text: it.str, x0: it.x, x1: it.x + it.w, h: it.h, b: it.b }] });
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
          cur.text += (r.x0 - cur.x1 > em * 0.22 ? " " : "") + r.text;
          cur.x1 = Math.max(cur.x1, r.x1);
          cur.h = Math.max(cur.h, r.h);
        } else {
          merged.push({ ...r });
        }
      }
      ln.runs = merged.filter((r) => r.text.trim().length > 0);
    }
    const textLines = vlines.filter((l) => l.runs.length > 0);
    const totalChars = textLines.reduce((s, l) => s + l.runs.reduce((a, r) => a + r.text.length, 0), 0);

    const pxOf = (h: number) => Math.min(72, Math.max(6, Math.round((h * 4) / 3)));
    const spanOf = (r: Run) => {
      const inner = `<span style="font-size: ${pxOf(r.h)}px">${escapeHtml(r.text.trim())}</span>`;
      return r.b ? `<strong>${inner}</strong>` : inner;
    };
    const alignOf = (l: VLine): "left" | "center" | "right" => {
      const x0 = Math.min(...l.runs.map((r) => r.x0));
      const x1 = Math.max(...l.runs.map((r) => r.x1));
      const lm = x0, rm = pageW - x1;
      if (Math.abs(lm - rm) < pageW * 0.1 && lm > pageW * 0.15) return "center";
      if (rm < pageW * 0.08 && lm > pageW * 0.3) return "right";
      return "left";
    };

    // 3) 표 재구성 — 연속 2줄 이상이 다열(runs≥2)이면 표 밴드로 보고 열 좌표를 클러스터링
    let tablesBuilt = 0;
    const pageHtml: string[] = [];
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

    let li = 0;
    while (li < textLines.length) {
      const ln = textLines[li];
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

    // 4) 그래픽 판정 — 이미지 포함, 또는 괘선(벡터)이 많은데 표 재구성이 안 된 페이지만 PNG 보존
    let imageOps = 0;
    let vectorOps = 0;
    try {
      const ops = await page.getOperatorList();
      for (const fn of ops.fnArray as number[]) {
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject ||
            fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
          imageOps++;
        } else if (fn === OPS.constructPath || fn === OPS.stroke || fn === OPS.fill ||
                   fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
                   fn === OPS.rectangle) {
          vectorOps++;
        }
      }
    } catch { /* ignore */ }
    // 텍스트가 충분히 추출된 페이지(200자+)는 괘선만으로 PNG 를 덧붙이지 않는다 —
    //   본문+같은 내용의 그림이 중복돼 "두 번 나오는" 문제 (2026-07-29 검증에서 발견).
    //   실제 이미지(직인·로고)가 있거나 텍스트가 빈약한 형식 위주 페이지만 PNG 보존.
    const hasGraphic = imageOps > 0 || (vectorOps >= 5 && tablesBuilt === 0 && totalChars < 200);

    // 페이지 구분 헤더 (2페이지 이상일 때만)
    if (total > 1) parts.push(`<p><strong>— ${i} / ${total} 페이지 —</strong></p>`);

    // 5) 복원한 텍스트/표 삽입
    if (pageHtml.length > 0) parts.push(pageHtml.join(""));

    // 6) 이미지 페이지·표 재구성 실패 괘선 페이지 → 페이지 이미지도 삽입 (내용 유실 방지)
    if (hasGraphic || totalChars < 10) {
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
        let src: string;
        if (uploadImage) {
          const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
          src = blob
            ? await uploadImage(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-p${i}.png`, { type: "image/png" }))
            : canvas.toDataURL("image/png");
        } else {
          src = canvas.toDataURL("image/png");
        }
        parts.push(`<img src="${src}" alt="PDF ${i}페이지" />`);
      }
    }
  }

  return parts.join("");
}
