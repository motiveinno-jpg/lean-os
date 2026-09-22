// 품목 바코드 라벨 PDF (2026-09-22 재고 점검 F, docs/20260922_PLAN_inventory_audit_v2.md)
//
//   기준 — 라벨의 바코드는 **품목에 적힌 바코드**(없으면 SKU)를 Code 128(B) 로 찍는다. 스캔 입력(A8·scanMode)이 같은 값을 읽으므로 짝이 맞는다.
//   라이브러리 없이 jsPDF 선으로 그린다. Code 128 부호표는 규격 그대로(모듈 11칸, 막대 3·공백 3) — 아래 self-check 가 표를 검증한다.
//   양식: A4 2열×8행(99×34mm, 폼텍 3110 류) · A4 3열×7행(63.5×38mm, 3108 류) · 롤 50×30mm 낱장. 여백·간격은 흔한 시판 라벨지 기준값.

import jsPDF from "jspdf";
import { loadKoreanFont, setKoreanFont } from "@/lib/pdf-korean-font";

// Code 128 — 값 0~105 데이터/시작 부호, 106 정지. 각 6자리는 [막대,공백,막대,공백,막대,공백] 너비(모듈).
const C128: string[] = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232",
];
const STOP = "2331112";
//   self-check — 부호 하나라도 틀리면 스캐너가 못 읽는데 화면에선 티가 안 난다. 모듈 합 11, 막대 모듈 짝수(규격의 짝수 패리티)를 확인한다.
(() => {
  C128.forEach((p, i) => {
    const w = p.split("").map(Number);
    const sum = w.reduce((s, x) => s + x, 0), bars = w[0] + w[2] + w[4];
    if (w.length !== 6 || sum !== 11 || bars % 2 !== 0) throw new Error(`Code128 표 오류: ${i} ${p}`);
  });
})();

/** Code Set B 로 부호화 — ASCII 32~126 만. 밖의 글자는 '?' 로 바꾼다 */
export function encodeCode128B(text: string): number[] {
  const vals: number[] = [104];   // Start B
  for (const ch of text) { const c = ch.charCodeAt(0); vals.push(c >= 32 && c <= 126 ? c - 32 : 31); }
  let sum = 104;
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103);            // 검사 부호
  return vals;
}

/** 부호 → 모듈 배열(막대=true) */
export function code128Modules(text: string): boolean[] {
  const out: boolean[] = [];
  const push = (p: string) => p.split("").forEach((w, i) => { for (let k = 0; k < Number(w); k++) out.push(i % 2 === 0); });
  for (const v of encodeCode128B(text)) push(C128[v]);
  push(STOP);
  return out;
}

export type LabelLayout = { key: string; label: string; page: "a4" | "roll"; cols: number; rows: number; w: number; h: number; left: number; top: number; gapX: number; gapY: number };
export const LABEL_LAYOUTS: LabelLayout[] = [
  { key: "a4-2x8", label: "A4 2열×8행 (99×34mm)", page: "a4", cols: 2, rows: 8, w: 99.1, h: 34, left: 4.5, top: 12.5, gapX: 2.5, gapY: 0 },
  { key: "a4-3x7", label: "A4 3열×7행 (63.5×38mm)", page: "a4", cols: 3, rows: 7, w: 63.5, h: 38.1, left: 7.2, top: 15.1, gapX: 2.5, gapY: 0 },
  { key: "roll-50x30", label: "롤 라벨 50×30mm (낱장)", page: "roll", cols: 1, rows: 1, w: 50, h: 30, left: 0, top: 0, gapX: 0, gapY: 0 },
];

export type LabelItem = { code: string; name: string; sub?: string | null; price?: number | null; copies: number };

/** 라벨 PDF — 항목마다 copies 장. 바코드 아래 코드 글자, 위에 품목명(·규격·가격) */
export async function buildLabelPdf(items: LabelItem[], layout: LabelLayout, opts: { showName: boolean; showSub: boolean; showPrice: boolean }): Promise<Blob> {
  const doc = layout.page === "a4" ? new jsPDF("p", "mm", "a4") : new jsPDF({ orientation: "l", unit: "mm", format: [layout.w, layout.h] });
  await loadKoreanFont(doc);
  const per = layout.cols * layout.rows;
  let n = 0;
  const all: LabelItem[] = [];
  for (const it of items) for (let k = 0; k < Math.max(1, it.copies); k++) all.push(it);
  for (const it of all) {
    if (n > 0 && n % per === 0) doc.addPage();
    const idx = n % per, col = idx % layout.cols, row = Math.floor(idx / layout.cols);
    const x = layout.left + col * (layout.w + layout.gapX), y = layout.top + row * (layout.h + layout.gapY);
    const pad = 2.5;
    let cy = y + pad;
    doc.setTextColor(20, 20, 20);
    if (opts.showName && it.name) { doc.setFontSize(layout.h >= 34 ? 9 : 8); setKoreanFont(doc, "bold"); doc.text(it.name, x + pad, cy + 3, { maxWidth: layout.w - pad * 2 }); cy += 4.5; }
    const subLine = [opts.showSub ? it.sub : null, opts.showPrice && it.price != null ? `₩${Math.round(it.price).toLocaleString("ko-KR")}` : null].filter(Boolean).join(" · ");
    if (subLine) { doc.setFontSize(7); setKoreanFont(doc, "normal"); doc.setTextColor(90, 90, 90); doc.text(subLine, x + pad, cy + 2.6, { maxWidth: layout.w - pad * 2 }); cy += 3.6; doc.setTextColor(20, 20, 20); }
    //   바코드 — 남은 높이에서 글자 줄(3.5mm)을 빼고 그린다. 모듈 폭은 라벨 폭에 맞춰 0.25~0.5mm
    const mods = code128Modules(it.code);
    const avail = layout.w - pad * 2;
    const mw = Math.max(0.2, Math.min(0.5, avail / mods.length));
    const bw = mods.length * mw;
    const bx = x + pad + (avail - bw) / 2;
    const bh = Math.max(6, y + layout.h - pad - 3.5 - cy);
    doc.setFillColor(0, 0, 0);
    let mx = bx;
    for (const bar of mods) { if (bar) doc.rect(mx, cy, mw, bh, "F"); mx += mw; }
    doc.setFontSize(7); setKoreanFont(doc, "normal");
    doc.text(it.code, x + layout.w / 2, cy + bh + 2.8, { align: "center" });
    n += 1;
  }
  return doc.output("blob");
}
