// 일괄 PDF 저장 헬퍼 (signatures 페이지에서 분리)
export function sanitizeFileName(s: string): string {
  return (s || "무명").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "무명";
}
export function uniquePdfName(used: Set<string>, company: string): string {
  const base = `소상공인 개별계약서_${sanitizeFileName(company)}`;
  let name = `${base}.pdf`;
  let n = 2;
  while (used.has(name)) name = `${base} (${n++}).pdf`;
  used.add(name);
  return name;
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
