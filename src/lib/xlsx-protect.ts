// ── 비밀번호 걸린 엑셀 내려받기 (2026-10-14, 결정 108 숙제 '엑셀 파일 무보호') ──
//   주민등록번호가 들어가는 엑셀(지급명세서·4대보험 신고서)을 열 때 비밀번호를 묻게 한다. 사장님 결정: 엑셀 비밀번호.
//   SheetJS(무료판)는 암호화 쓰기를 못 해서, SheetJS 로 만든 파일을 xlsx-populate 로 다시 열어 암호화(표준 Agile, 엑셀·한셀이 연다)해 내려준다.
//   암호화는 브라우저 안에서만 — 파일·비밀번호를 서버로 보내지 않는다. 비밀번호는 어디에도 저장하지 않는다.
//   ⚠️ 건강보험·근로복지공단 EDI 에 그대로 올리는 파일(insurance-edi downloadInsuranceXlsx)에는 쓰지 않는다 — 암호화하면 업로드가 안 된다.

import * as XLSX from "xlsx";

export const MIN_XLSX_PASSWORD = 4;

export async function writeProtectedXlsx(wb: XLSX.WorkBook, fileName: string, password: string): Promise<void> {
  if (password.length < MIN_XLSX_PASSWORD) throw new Error(`비밀번호는 ${MIN_XLSX_PASSWORD}자 이상이어야 합니다`);
  const plain = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  //   main(lib/)은 Node crypto 를 require 해 브라우저 번들에서 깨진다 → 폴리필이 든 브라우저 판을 쓴다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("xlsx-populate/browser/xlsx-populate.min.js");
  const XlsxPopulate = mod.default || mod;
  const book = await XlsxPopulate.fromDataAsync(plain);
  const blob: Blob = await book.outputAsync({ type: "blob", password });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
