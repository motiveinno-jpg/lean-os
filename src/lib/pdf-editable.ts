// PDF → "원본 그대로 + 글자 수정 가능" HTML 변환 (2026-07-29)
//   사장님: "이미지로 정확하게 불러오고 그 이미지가 불러와지면 우리가 수정이 가능하게".
//   ① 각 페이지를 고해상도로 렌더한 뒤 글자 영역만 흰색으로 지운 배경 이미지 생성
//   ② 글자들은 원좌표(페이지 폭 794px 기준)대로 span 으로 얹음
//   결과 HTML 은 RichEditor 의 PdfPage 노드(div[data-pdf-page])가 파싱해
//   글자 클릭 수정이 가능하고, 서명/출력 화면에서도 그대로 렌더된다.
//   브라우저 전용 (pdfjs + canvas).

export type PdfEditableText = { t: string; x: number; y: number; fs: number; b?: boolean };

const PAGE_W = 794; // A4 @96dpi

export async function pdfToEditableHtml(
  file: File,
  uploadImage?: (f: File) => Promise<string>,
): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const Util = pdfjs.Util;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const total = pdf.numPages;

  const container = document.createElement("div");

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1.0 });
    const factor = PAGE_W / vp1.width;
    const S = 2.5;
    const vpImg = page.getViewport({ scale: S });

    const canvas = document.createElement("canvas");
    canvas.width = vpImg.width;
    canvas.height = vpImg.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport: vpImg }).promise;

    // 글자 수집 + 배경에서 글자 지우기
    const texts: PdfEditableText[] = [];
    try {
      try { await page.getOperatorList(); } catch { /* 폰트 로딩 실패 무시 */ }
      const boldCache = new Map<string, boolean>();
      const isBold = (fn: string): boolean => {
        if (!fn) return false;
        if (boldCache.has(fn)) return boldCache.get(fn)!;
        let b = false;
        try {
          const fo: any = page.commonObjs.has(fn) ? page.commonObjs.get(fn) : null;
          b = /bold|black|heavy|extrab|semib/i.test(String(fo?.name || ""));
        } catch { /* ignore */ }
        boldCache.set(fn, b);
        return b;
      };
      const tc = await page.getTextContent();
      for (const it of tc.items as any[]) {
        if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
        const fh = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
        const [dx, dy] = Util.applyTransform([it.transform[4], it.transform[5]], vp1.transform);
        const fs = Math.max(6, Math.round(fh * factor * 10) / 10);
        if (it.str.trim().length > 0) {
          texts.push({ t: it.str, x: Math.round(dx * factor), y: Math.round(dy * factor - fs * 0.83), fs, b: isBold(it.fontName) || undefined });
        }
        const ex = dx * S, ey = dy * S;
        const ew = (it.width || 0) * S, eh = fh * S;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(ex - 1, ey - eh * 1.06, Math.max(0, ew + 2), eh * 1.32);
      }
    } catch { /* 텍스트 레이어 없으면 이미지만 */ }

    let src: string;
    if (uploadImage) {
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
      try {
        src = blob
          ? await uploadImage(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-p${i}.png`, { type: "image/png" }))
          : canvas.toDataURL("image/png");
      } catch {
        src = canvas.toDataURL("image/png");
      }
    } else {
      src = canvas.toDataURL("image/png");
    }

    // DOM 으로 조립 — 속성/텍스트 이스케이프를 브라우저에 맡긴다
    const pageDiv = document.createElement("div");
    pageDiv.setAttribute("data-pdf-page", "1");
    pageDiv.setAttribute("data-texts", JSON.stringify(texts));
    pageDiv.setAttribute("data-h", String(Math.round(vp1.height * factor)));
    pageDiv.style.cssText = `position:relative;width:${PAGE_W}px;max-width:100%;margin:12px auto;background:#fff;container-type:inline-size;`;
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "width:100%;display:block;";
    pageDiv.appendChild(img);
    for (const t of texts) {
      const sp = document.createElement("span");
      sp.textContent = t.t;
      const pageHpx = Math.round(vp1.height * factor);
      sp.style.cssText = `position:absolute;left:${((t.x / PAGE_W) * 100).toFixed(3)}%;top:${pageHpx > 0 ? ((t.y / pageHpx) * 100).toFixed(3) : 0}%;font-size:${((t.fs / PAGE_W) * 100).toFixed(3)}cqw;${t.b ? "font-weight:700;" : ""}white-space:pre;line-height:1.15;color:#111;`;
      pageDiv.appendChild(sp);
    }
    container.appendChild(pageDiv);
  }

  return container.innerHTML;
}
