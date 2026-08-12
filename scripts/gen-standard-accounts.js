// 계정과목.xlsx → src/lib/standard-accounts.ts 생성 (2026-08-12)
const XLSX = require("xlsx");
const fs = require("fs");

const wb = XLSX.readFile("C:/Users/연준호/Downloads/계정과목.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Table 1"], { header: 1, defval: "" });
const strip = (s) => String(s).replace(/\s+/g, "").trim();

const all = [];
for (const r of rows) {
  for (const off of [1, 6]) {
    const c = String(r[off]).trim();
    if (!/^[0-9]{3}$/.test(c)) continue;
    all.push({ code: c, name: strip(r[off + 1]), kind: strip(r[off + 2]) });
  }
}
const real = all.filter((o) => o.name && o.name !== "회사설정계정과목")
  .sort((a, b) => +a.code - +b.code);

//   코드 구간 → 계정 성격 (한국 표준 계정체계)
const OVERRIDE = { "400": "equity", "993": "revenue" };
function typeOf(code) {
  if (OVERRIDE[code]) return OVERRIDE[code];
  const n = +code;
  if (n <= 250) return "asset";
  if (n <= 330) return "liability";
  if (n <= 399) return "equity";
  if (n <= 450) return "revenue";
  if (n <= 799) return "expense";
  if (n <= 899) return "expense";
  if (n <= 930) return "revenue";
  if (n <= 960) return "expense";
  if (n <= 980) return "asset";
  if (n <= 986) return "equity";
  return "expense";
}
const out = real.map((o) => ({ ...o, type: typeOf(o.code) }));

const SECTIONS = [
  ["자산 — 당좌자산", 101, 145], ["자산 — 재고자산", 146, 175],
  ["자산 — 투자자산", 176, 200], ["자산 — 유형·무형·기타비유동자산", 201, 250],
  ["부채 — 유동부채", 251, 290], ["부채 — 비유동부채", 291, 330],
  ["자본", 331, 399],
  ["매출", 400, 450], ["매출원가", 451, 500],
  ["제조원가", 501, 599], ["도급원가", 601, 699], ["분양원가", 701, 799],
  ["판매비와관리비", 801, 899],
  ["영업외수익", 901, 930], ["영업외비용", 931, 960],
  ["자산 — 기타비유동자산", 961, 980],
  ["자본 — 기타포괄손익·자본조정", 981, 986],
  ["중단사업손익·법인세", 987, 999],
];

let body = "";
for (const [label, lo, hi] of SECTIONS) {
  const seg = out.filter((o) => +o.code >= lo && +o.code <= hi);
  if (!seg.length) continue;
  body += `  // ── ${label} (${lo}~${hi}) ──\n`;
  for (const o of seg) body += `  { code: "${o.code}", name: "${o.name}", type: "${o.type}" },\n`;
}

const header = `// 표준 계정과목표 — 사장님이 준 \`계정과목.xlsx\` 를 그대로 옮긴 것 (2026-08-12)
//
//   ★ 이 파일은 **손으로 고치지 않는다**. 원본 엑셀이 바뀌면 다시 뽑는다.
//     엑셀 839행 = 실계정 ${out.length}개 + '회사설정계정과목' 빈칸 ${all.length - out.length}개.
//     빈칸은 회사가 직접 채우는 자리라 넣지 않는다.
//   ★ 계정과목명에 **띄어쓰기를 넣지 않는다** (사장님 지시 2026-08-12).
//     원본 PDF 를 엑셀로 옮기며 생긴 자간 공백("대손    충    당금")을 전부 지웠다.
//   ★ type 은 **코드 구간**으로 정한다 — 한국 표준 계정체계 그대로.
//     101~250 자산 · 251~330 부채 · 331~399 자본 · 401~450 매출 · 451~799 원가
//     801~899 판관비 · 901~930 영업외수익 · 931~960 영업외비용
//     **961~980 은 9xx 인데 자산이다**(임차보증금·전세권·장기외상매출금 …) — 손익에 실리면 안 된다.
//     981~986 기타포괄손익(자본) · 991~999 중단사업손익·법인세.
//     예외 2개: 400 손익(집합계정)=자본 · 993 중단사업손상차환입=수익.
//
//   회사설정 > 계정과목 관리의 "표준 계정과목 채우기" + 신규 회사 시드가 이 목록을 쓴다.

import type { AccountType } from "@/lib/ledger";

export interface StandardAccount { code: string; name: string; type: AccountType }

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "자산", liability: "부채", equity: "자본", revenue: "수익", expense: "비용",
};
export const ACCOUNT_TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export const STANDARD_ACCOUNTS: StandardAccount[] = [
${body}];
`;
fs.writeFileSync("src/lib/standard-accounts.ts", header, "utf8");

const byType = {};
out.forEach((o) => (byType[o.type] = (byType[o.type] || 0) + 1));
console.log("생성:", out.length, "개", JSON.stringify(byType));
fs.writeFileSync(
  "C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/99aba45e-e8c5-4e4d-92b4-53d3c7a9ffbc/scratchpad/std474.json",
  JSON.stringify(out), "utf8");
