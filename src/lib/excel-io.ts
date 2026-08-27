// ── 엑셀 일괄 올리기·양식 (2026-08-27 사장님 지시) ─────────────────────────────────────────
//   "재고 쪽 입력은 전부 엑셀로 올릴 수 있어야 한다. 오너뷰가 양식을 먼저 주고, 거기에 맞춰 채운 파일을 올리면 등록되는 식으로."
//   · 양식 = 첫 줄 머리(표시 이름) + 예시 줄 + '안내' 시트(칸마다 필수·형식·설명). 사람이 채운 파일을 그대로 다시 읽는다.
//   · 읽기: 첫 시트, 첫 줄을 머리로 본다. 머리는 표시 이름 또는 key 로 맞춘다(띄어쓰기·괄호 무시). 날짜 셀은 YYYY-MM-DD 로.
//   · 화면은 여기서 읽은 줄을 검사(필수·품목 존재·수량)하고 미리 보인 뒤 사람이 '등록'을 눌러야 저장한다 — 제안은 자동, 확정은 사람.

import * as XLSX from "xlsx";

export type ExcelKind = "text" | "number" | "date" | "bool";
export type ExcelColumn = {
  key: string;
  label: string;
  required?: boolean;
  kind?: ExcelKind;
  /** 안내 시트에 적는 설명 */
  hint?: string;
  /** 예시 줄 값 */
  example?: string | number;
};

const norm = (s: string) => String(s || "").replace(/[\s()（）*·\-_/]/g, "").toLowerCase();

/** 양식 내려받기 — 머리줄 + 예시 + 안내 시트 */
export function downloadTemplate(fileName: string, sheetName: string, cols: ExcelColumn[], guide: string[] = []) {
  const header = cols.map((c) => (c.required ? `${c.label}*` : c.label));
  const example = cols.map((c) => c.example ?? "");
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  ws["!cols"] = cols.map((c) => ({ wch: Math.max(10, c.label.length * 2 + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const g = XLSX.utils.aoa_to_sheet([
    ["오너뷰 엑셀 양식 안내"],
    ["· 첫 시트의 첫 줄(머리)은 지우지 마세요. 두 번째 줄은 예시라 지우고 채워도 됩니다."],
    ["· * 가 붙은 칸은 꼭 채워야 합니다. 날짜는 2026-08-27 처럼, 예/아니오 칸은 예·아니오(또는 Y/N)."],
    ["· 올리면 오너뷰가 먼저 읽어 보여 주고, 등록 버튼을 눌러야 저장됩니다."],
    ...guide.map((x) => [`· ${x}`]),
    [""],
    ["칸", "필수", "형식", "설명"],
    ...cols.map((c) => [c.label, c.required ? "필수" : "", c.kind === "number" ? "숫자" : c.kind === "date" ? "날짜(YYYY-MM-DD)" : c.kind === "bool" ? "예/아니오" : "글자", c.hint || ""]),
  ]);
  g["!cols"] = [{ wch: 18 }, { wch: 6 }, { wch: 16 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, g, "안내");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export type ExcelRow = Record<string, string>;

/** 파일을 읽어 머리 기준 레코드로. 머리를 못 맞춘 칸은 무시하고, 못 맞춘 필수 칸 이름을 돌려준다. */
export async function readExcelFile(file: File, cols: ExcelColumn[]): Promise<{ rows: ExcelRow[]; missing: string[]; sheet: string; total: number }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  if (!aoa.length) return { rows: [], missing: cols.filter((c) => c.required).map((c) => c.label), sheet, total: 0 };
  const head = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
  const idx = new Map<string, number>();
  for (const c of cols) {
    const i = head.findIndex((h) => h && (h === norm(c.label) || h === norm(c.key) || h === norm(c.label + "*")));
    if (i >= 0) idx.set(c.key, i);
  }
  const missing = cols.filter((c) => c.required && !idx.has(c.key)).map((c) => c.label);
  const rows: ExcelRow[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const line = aoa[r] as unknown[];
    if (!line || line.every((v) => v === "" || v == null)) continue;
    const rec: ExcelRow = {};
    for (const c of cols) {
      const i = idx.get(c.key);
      rec[c.key] = i == null ? "" : cellText(line[i], c.kind);
    }
    //   예시 줄(양식에 같이 내려간 것)은 사람이 안 지웠어도 넘긴다
    if (cols.length && cols.every((c) => c.example == null || rec[c.key] === String(c.example) || rec[c.key] === "")) {
      if (cols.some((c) => c.example != null && rec[c.key] === String(c.example))) continue;
    }
    rows.push(rec);
  }
  return { rows, missing, sheet, total: aoa.length - 1 };
}

function cellText(v: unknown, kind?: ExcelKind): string {
  if (v == null) return "";
  if (v instanceof Date) return fmtDate(v);
  if (kind === "date") {
    if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : ""; }
    const s = String(v).trim().replace(/[./]/g, "-");
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s;
  }
  return String(v).trim();
}
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const xNum = (s: string | undefined | null): number | null => {
  if (s == null || String(s).trim() === "") return null;
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? null : n;
};
export const xBool = (s: string | undefined | null, dflt = true): boolean => {
  const t = String(s ?? "").trim();
  if (!t) return dflt;
  return !/^(아니오|아니요|n|no|false|0|x|否)$/i.test(t);
};
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 붙여넣기 팝업용 — 첫 시트를 탭으로 이은 글자로. 첫 줄이 머리(글자만)면 뺀다. 날짜 셀은 YYYY-MM-DD. */
export async function excelFileToTsv(file: File, cols?: ExcelColumn[]): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  const lines: string[] = [];
  aoa.forEach((row, i) => {
    const cells = (row as unknown[]).map((v, j) => cellText(v, cols?.[j]?.kind));
    if (cells.every((c) => c === "")) return;
    if (i === 0 && cols && cells.some((c) => cols.some((k) => norm(c) === norm(k.label) || norm(c) === norm(k.label + "*")))) return;   // 머리줄
    if (i === 1 && cols && cols.length && cells.every((c, j) => cols[j]?.example == null || c === "" || c === String(cols[j].example))) return;   // 예시줄
    lines.push(cells.join("\t"));
  });
  return lines.join("\n");
}
