// ── 간소화 PDF → 글자 줄 (브라우저 안에서만, 2026-10-14 연말정산 5단계) ──
//   파일은 서버·AI 로 보내지 않는다(사장님 결정). pdfjs 로 글자 조각을 뽑아 같은 높이(±2pt)끼리 한 줄, 왼→오른쪽 순서의 칸으로 묶는다.
//   해석은 lib/tax-forms/hometax-pdf(parseHometaxLines) 가 한다.

export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) { super(wrong ? "비밀번호가 맞지 않습니다" : "비밀번호가 걸린 PDF입니다"); }
}

export async function extractPdfLines(file: File, password?: string): Promise<string[][]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdf: any;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password: password || undefined, isEvalSupported: false }).promise;
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    if (err?.name === "PasswordException") throw new PdfPasswordError(err.code === 2);   // 1 = 필요, 2 = 틀림
    throw e;
  }
  const out: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows: { y: number; cells: { x: number; s: string }[] }[] = [];
    for (const it of tc.items as { str?: string; transform: number[] }[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      const row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (row) row.cells.push({ x, s: it.str.trim() }); else rows.push({ y, cells: [{ x, s: it.str.trim() }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.cells.sort((a, b) => a.x - b.x).map((c) => c.s));
  }
  await pdf.destroy?.();
  return out;
}
