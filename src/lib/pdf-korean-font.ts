/**
 * Korean font loader for jsPDF
 * Fetches NanumGothic from Google Fonts CDN at runtime and caches in memory.
 * NanumGothic: ~1.1MB TTF, covers all modern Korean glyphs.
 */
import type jsPDF from 'jspdf';

let cachedFontBase64: string | null = null;

const FONT_URL = 'https://fonts.gstatic.com/s/nanumgothic/v23/PN_3Rfi-oW3hYwmKDpxS7F_z_tLfxno73g.ttf';

export async function loadKoreanFont(doc: jsPDF): Promise<void> {
  if (!cachedFontBase64) {
    try {
      const res = await fetch(FONT_URL);
      if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Convert to base64
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
      }
      cachedFontBase64 = btoa(binary);
    } catch (err) {
      console.warn('Korean font load failed, falling back to helvetica:', err);
      return;
    }
  }

  doc.addFileToVFS('NanumGothic-Regular.ttf', cachedFontBase64);
  doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
  // Also register as bold (same file, jsPDF will simulate bold)
  doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'bold');
}

export function setKoreanFont(doc: jsPDF, style: 'normal' | 'bold' = 'normal') {
  try {
    doc.setFont('NanumGothic', style);
  } catch {
    // Fallback if font not loaded
    doc.setFont('helvetica', style);
  }
}
