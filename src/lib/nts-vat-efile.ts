// ── 부가가치세 일반과세자 전자신고 파일 (2026-10-08 ERP 3차 D, docs/20261007_PLAN_erp_gap_audit3.md ⑪) ──
//
//   규격: 「부가가치세 전자신고 파일설명서 2026.6」(docs/nts-specs, 179쪽). 레이아웃은 문서 표를 **그대로** 옮겼고
//   누적 바이트 위치를 문서 값과 대조하는 시험이 있다(__tests__/nts-vat-efile.test.ts).
//   · 파일: LINE SEQUENTIAL(CR/LF) · ASCII + KSC-5601 2바이트 · 파일명 사업자번호 + 작성일자 + '.101'(정기·일반)
//   · 순서: 11 Head(600) → 17 일반신고서(1200) → 15 수입금액(150) → 세금계산서합계표 7 표지 → 3 → 5 → 4 → 6 (170)
//   · 음수: 신고서·수입금액 = 왼쪽 '-'(폭에 포함) / 세금계산서합계표 = Multi-Key — 서식마다 다르다(문서 §수록시 유의사항)
//
//   ★ 1차 범위(베타, 게이트 tax_efile_vat — 모티브 먼저): 일반과세자 · 정기(01) · 예정(C17)/확정(C07) · 전자세금계산서만.
//     부속서류가 따로 필요한 경우는 **파일을 만들지 않고 이유를 돌려준다**("되는 척 금지"):
//       종이 세금계산서(매출·매입자료 레코드 1·2 — 문서의 주류코드 칸이 표와 설명이 충돌), 카드·현금영수증 매출(발행금액 집계표),
//       카드·현금영수증 매입(수령명세서 + 공제감면 211), 영세율(첨부서류), 불공제(불공제명세서), 면세 매출(계산서합계표·수입금액 08).
//     면세 계산서 수취액은 신고서 (90)칸에만 적고 계산서합계표는 넣지 않는다 — 문서가 E 레코드 위치를 정하지 않았다(확인 필요로 화면에 적는다).
//   ★ 버린 안: 계산서합계표 E 레코드를 D 뒤에 추정 배치 — 문서에 없는 위치를 지어내는 일이라 홈택스 검증 전엔 안 한다.

import { buildNtsFile, bizNoValid, type NtsField, type NtsIssue } from "@/lib/nts-efile";

export type VatEfileRow = {
  /** 부가세 유형 코드 — lib/vat-voucher (11 과세매출 · 51 과세매입 …) */
  vatType: string;
  supply: number; vat: number;
  electronic: boolean;
  partnerBizno: string | null;
  partnerName: string | null;
};
/** 신고기간 — VatReturn 의 키와 같다. 확정(1c·2c)은 예정분을 뺀 3개월, 반기(1h·2h)는 예정 신고를 안 한 6개월 */
export type VatEfilePeriod = "1p" | "1c" | "1h" | "2p" | "2c" | "2h";
export type VatEfileInput = {
  bizNo: string; hometaxId: string; companyName: string; ceoName: string;
  address?: string; phone?: string; email?: string;
  bizType: string;      // 업태
  bizItem: string;      // 종목
  industryCode: string; // 주업종코드 6자리 (사업자등록 시 등록한 코드)
  year: number; period: VatEfilePeriod;
  /** 실제 집계 기간(합계표 거래기간) */
  from: string; to: string;
  madeOn: string;       // 작성일자 YYYY-MM-DD
  rows: VatEfileRow[];
};
export type VatEfileResult = { bytes: Uint8Array | null; fileName: string; issues: NtsIssue[]; notes: string[]; summary: VatEfileSummary };
export type VatEfileRecord = { fields: NtsField[]; len: number };
export type VatEfileSummary = { taxBase: number; salesVat: number; buySupply: number; buyVat: number; payable: number; billBuy: number; saleTi: number; buyTi: number };

const digits = (s: string) => String(s || "").replace(/[^0-9]/g, "");
const ymd = (s: string) => s.replace(/-/g, "").slice(0, 8);
const yymmdd = (s: string) => s.replace(/-/g, "").slice(2, 8);
const X = (name: string, len: number, value: string): NtsField => ({ name, len, type: "X", value });
const N = (name: string, len: number, value: number): NtsField => ({ name, len, type: "9", value, sign: "minus" });
const MK = (name: string, len: number, value: number): NtsField => ({ name, len, type: "9", value, sign: "multikey" });
const P = (name: string, len: number, value: number): NtsField => ({ name, len, type: "9", value });   // 양수만(건수·번호)

const PERIOD = {
  "1p": { kind: "03", form: "C17", half: "01", start: "0101", end: "0331" },
  "1c": { kind: "01", form: "C07", half: "01", start: "0101", end: "0630" },
  "1h": { kind: "01", form: "C07", half: "01", start: "0101", end: "0630" },
  "2p": { kind: "03", form: "C17", half: "02", start: "0701", end: "0930" },
  "2c": { kind: "01", form: "C07", half: "02", start: "0701", end: "1231" },
  "2h": { kind: "01", form: "C07", half: "02", start: "0701", end: "1231" },
} as const;

/** 집계 — 유형별 합 */
function sumOf(rows: VatEfileRow[], codes: string[]) {
  const r = rows.filter((x) => codes.includes(x.vatType));
  return { n: r.length, supply: r.reduce((s, x) => s + Math.round(x.supply), 0), vat: r.reduce((s, x) => s + Math.round(x.vat), 0) };
}

/** 세금계산서 전자분 합계 — 사업자번호(10)·주민번호(13) 발행분으로 가른다 */
function tiTotals(rows: VatEfileRow[]) {
  const part = (len: number) => {
    const r = rows.filter((x) => digits(x.partnerBizno || "").length === len);
    return { partners: new Set(r.map((x) => digits(x.partnerBizno || ""))).size, n: r.length, supply: r.reduce((s, x) => s + Math.round(x.supply), 0), vat: r.reduce((s, x) => s + Math.round(x.vat), 0) };
  };
  const biz = part(10), rrn = part(13);
  return { all: { partners: biz.partners + rrn.partners, n: biz.n + rrn.n, supply: biz.supply + rrn.supply, vat: biz.vat + rrn.vat }, biz, rrn };
}

/** 시험용 — 마지막으로 만든 레코드(필드 폭을 문서 누적 위치와 대조) */
let lastRecords: VatEfileRecord[] = [];
export const vatEfileLastRecords = () => lastRecords;

export function buildVatEfile(i: VatEfileInput): VatEfileResult {
  const issues: NtsIssue[] = [];
  const notes: string[] = [];
  const P0 = PERIOD[i.period];
  const bizNo = digits(i.bizNo);
  const fileName = `${bizNo}${ymd(i.madeOn)}.101`;

  // ── 입력 점검 ──
  if (!bizNoValid(bizNo)) issues.push({ field: "사업자번호", message: "사업자등록번호가 없거나 검증번호가 맞지 않습니다 · 회사설정에서 확인하세요" });
  if (!i.hometaxId.trim()) issues.push({ field: "사용자ID", message: "홈택스 사용자ID 를 넣어 주세요(Head 필수값)" });
  if (!i.companyName.trim()) issues.push({ field: "상호", message: "회사 이름이 비어 있습니다" });
  if (!i.ceoName.trim()) issues.push({ field: "대표자명", message: "대표자 이름이 비어 있습니다 · 회사설정에서 채우세요" });
  if (!(i.address || "").trim()) issues.push({ field: "사업장소재지", message: "사업장 주소가 비어 있습니다(세금계산서합계표 표지 필수값) · 회사설정에서 채우세요" });
  if (!i.bizType.trim()) issues.push({ field: "업태", message: "업태가 비어 있습니다 · 회사설정에서 채우세요" });
  if (!i.bizItem.trim()) issues.push({ field: "종목", message: "종목이 비어 있습니다 · 회사설정에서 채우세요" });
  if (!/^\d{6}$/.test(i.industryCode.trim())) issues.push({ field: "업종코드", message: "주업종코드 6자리를 넣어 주세요(사업자등록증·홈택스 사업자등록 정보)" });

  // ── 이번 베타가 못 만드는 경우 — 이유를 돌려준다 ──
  const s11 = sumOf(i.rows, ["11"]), s12 = sumOf(i.rows, ["12"]), s13 = sumOf(i.rows, ["13"]), s17 = sumOf(i.rows, ["17", "22"]);
  const p51 = sumOf(i.rows, ["51"]), p54 = sumOf(i.rows, ["54"]), p57 = sumOf(i.rows, ["57", "61"]), p53 = sumOf(i.rows, ["53"]);
  const unknown = i.rows.filter((x) => !["11", "12", "13", "17", "22", "51", "53", "54", "57", "58", "59", "61"].includes(x.vatType));
  const block = (cond: boolean, field: string, message: string) => { if (cond) issues.push({ field, message }); };
  block(unknown.length > 0, "부가세 유형", `유형이 비었거나 모르는 전표 ${unknown.length}건 · 매입매출전표에서 유형을 채우세요`);
  block(s17.supply !== 0 || s17.vat !== 0, "카드·현금영수증 매출", "신용카드매출전표등 발행금액 집계표가 필요한 기간입니다 · 이번 베타는 못 만듭니다(홈택스에서 직접)");
  block(s12.supply !== 0, "영세율 매출", "영세율 첨부서류가 필요한 기간입니다 · 이번 베타는 못 만듭니다(홈택스에서 직접)");
  block(s13.supply !== 0, "면세 매출", "계산서합계표·면세 수입금액이 필요한 기간입니다 · 이번 베타는 못 만듭니다(홈택스에서 직접)");
  block(p57.supply !== 0 || p57.vat !== 0, "카드·현금영수증 매입", "신용카드매출전표등 수령명세서가 필요한 기간입니다 · 이번 베타는 못 만듭니다(홈택스에서 직접)");
  block(p54.supply !== 0 || p54.vat !== 0, "불공제 매입", "공제받지 못할 매입세액 명세서가 필요한 기간입니다 · 이번 베타는 못 만듭니다(홈택스에서 직접)");
  const tiRows = i.rows.filter((x) => x.vatType === "11" || x.vatType === "51");
  const paper = tiRows.filter((x) => !x.electronic);
  block(paper.length > 0, "종이 세금계산서", `전자가 아닌 세금계산서 ${paper.length}건 · 거래처별 명세 레코드가 필요해 이번 베타는 못 만듭니다`);
  const noBiz = tiRows.filter((x) => ![10, 13].includes(digits(x.partnerBizno || "").length));
  block(noBiz.length > 0, "거래처 등록번호", `거래처 사업자번호가 없는 세금계산서 전표 ${noBiz.length}건 · 거래처에 사업자번호를 채우세요`);
  if (p53.supply) notes.push(`면세 계산서 수취 ₩${p53.supply.toLocaleString("ko-KR")} 를 신고서 (90)칸에 적었습니다. 계산서합계표는 이 파일에 넣지 않았습니다 — 홈택스 변환 검증에서 불일치 오류가 나면 알려 주세요(확인 필요).`);

  // ── 신고서 숫자 ──
  const taxBase = s11.supply;                  // (9) = (1)~(7) 금액 합 · 이번 범위는 (1)만
  const salesVat = s11.vat;                    // (가)
  const buy10 = p51;                           // (10) 세금계산서 수취분 일반매입
  const buy16 = { supply: buy10.supply, vat: buy10.vat };   // (16) = (10)+(12)+(13)+(14)+(15)
  const deduct = { supply: buy16.supply, vat: buy16.vat };  // (18)/(나) = (16)−(17), (17)=0
  const payable = salesVat - deduct.vat;       // (다)
  const due = payable;                         // (30) = (다)−(라)−(마)…+(타), 이번 범위는 경감·가산 0
  if (payable < 0) notes.push(`환급세액 ₩${Math.abs(payable).toLocaleString("ko-KR")} · 환급 계좌는 파일에 넣지 않았습니다. 홈택스 제출 화면에서 입력하세요.`);

  const head: NtsField[] = [
    X("자료구분", 2, "11"), X("서식코드", 7, "I103200"), X("납세자ID", 13, bizNo), X("세목코드", 2, "41"),
    X("신고구분코드", 2, P0.kind), X("신고구분상세코드", 2, "01"), X("과세기간_년기", 6, `${i.year}${P0.half}`), X("신고서종류코드", 3, P0.form),
    X("사용자ID", 20, i.hometaxId.trim()), X("납세자번호", 13, ""), X("세무대리인성명", 30, ""),
    X("세무대리인전화번호1", 4, ""), X("세무대리인전화번호2", 5, ""), X("세무대리인전화번호3", 5, ""),
    X("상호(법인명)", 30, i.companyName.trim()), X("성명(대표자명)", 30, i.ceoName.trim()),
    X("사업장소재지", 70, (i.address || "").trim()), X("사업장전화번호", 14, digits(i.phone || "")),
    X("사업자주소", 70, ""), X("사업자전화번호", 14, ""),
    X("업태명", 30, i.bizType.trim()), X("종목명", 50, i.bizItem.trim()), X("업종코드", 7, i.industryCode.trim()),
    X("과세기간시작일자", 8, `${i.year}${P0.start}`), X("과세기간종료일자", 8, `${i.year}${P0.end}`), X("작성일자", 8, ymd(i.madeOn)),
    X("보정신고구분", 1, "N"), X("사업자휴대전화", 14, ""), X("세무프로그램코드", 4, "9000"), X("세무대리인사업자번호", 13, ""),
    X("전자메일주소", 50, (i.email || "").trim()), X("세무대리인생년월일", 8, ""), X("세무대리인관리번호", 6, ""), X("공란", 51, ""),
  ];

  //   일반신고서 — 문서 필드 번호(1~90) 순서 그대로. 값이 있는 칸만 v 에 적고 나머지 금액은 0
  const v: Record<number, number> = {
    3: s11.supply, 4: s11.vat,                    // (1) 세금계산서 발급분
    24: taxBase, 25: salesVat,                    // (9) 과세표준 · (가) 산출세액
    26: buy10.supply, 27: buy10.vat,              // (10) 세금계산서 수취분 일반매입
    44: buy16.supply, 45: buy16.vat,              // (16) 합계
    56: deduct.supply, 57: deduct.vat,            // (18) 차감계 · (나)
    58: payable,                                  // (다) 납부(환급)세액
    67: due,                                      // (30) 차감·가감하여 납부할 세액
    69: taxBase,                                  // (35) 과세표준명세 합계 수입금액
    73: p53.supply,                               // (90) 계산서 수취금액
  };
  const G = (no: number, name: string, len: number): NtsField => N(name, len, v[no] || 0);
  const general: NtsField[] = [
    X("자료구분", 2, "17"), X("서식코드", 7, "I103200"),
    G(3, "매출과세세금계산서발급금액", 15), G(4, "매출과세세금계산서발급세액", 13), G(5, "매출과세매입자발행세금계산서금액", 13), G(6, "매출과세매입자발행세금계산서세액", 13),
    G(7, "매출과세카드현금발행금액", 15), G(8, "매출과세카드현금발행세액", 15), G(9, "매출과세기타금액", 13), G(10, "매출과세기타세액", 13),
    G(11, "매출영세율세금계산서발급금액", 13), G(12, "매출영세율기타금액", 15), G(13, "매출예정누락합계금액", 13), G(14, "매출예정누락합계세액", 13),
    G(15, "예정누락매출세금계산서금액", 13), G(16, "예정누락매출세금계산서세액", 13), G(17, "예정누락매출과세기타금액", 13), G(18, "예정누락매출과세기타세액", 13),
    G(19, "예정누락매출영세율세금계산서금액", 13), G(20, "예정누락매출영세율기타금액", 13), G(21, "예정누락매출명세합계금액", 13), G(22, "예정누락매출명세합계세액", 13),
    G(23, "매출대손세액가감세액", 13), G(24, "과세표준금액", 15), G(25, "산출세액", 15),
    G(26, "매입세금계산서수취일반금액", 15), G(27, "매입세금계산서수취일반세액", 13), G(28, "매입세금계산서수취고정자산금액", 13), G(29, "매입세금계산서수취고정자산세액", 13),
    G(30, "매입예정신고누락합계금액", 13), G(31, "매입예정신고누락합계세액", 13), G(32, "예정누락매입신고세금계산서금액", 13), G(33, "예정누락매입신고세금계산서세액", 13),
    G(34, "예정누락매입기타공제금액", 13), G(35, "예정누락매입기타공제세액", 13), G(36, "예정누락매입명세합계금액", 13), G(37, "예정누락매입명세합계세액", 13),
    G(38, "매입자발행세금계산서매입금액", 13), G(39, "매입자발행세금계산서매입세액", 13), G(40, "매입기타공제매입금액", 13), G(41, "매입기타공제매입세액", 13),
    G(42, "그밖의공제매입명세합계금액", 13), G(43, "그밖의공제매입명세합계세액", 13), G(44, "매입세액합계금액", 15), G(45, "매입세액합계세액", 13),
    G(46, "공제받지못할매입합계금액", 13), G(47, "공제받지못할매입합계세액", 13), G(48, "공제받지못할매입금액", 13), G(49, "공제받지못할매입세액", 13),
    G(50, "공제받지못할공통매입면세사업금액", 13), G(51, "공제받지못할공통매입면세사업세액", 13), G(52, "공제받지못할대손처분금액", 13), G(53, "공제받지못할대손처분세액", 13),
    G(54, "공제받지못할매입명세합계금액", 13), G(55, "공제받지못할매입명세합계세액", 13), G(56, "차감합계금액", 15), G(57, "차감합계세액", 13),
    G(58, "납부(환급)세액", 13), G(59, "그밖의경감공제세액", 15), G(60, "그밖의경감공제명세합계세액", 15), G(61, "경감공제합계세액", 13),
    G(62, "예정신고미환급세액", 13), G(63, "예정고지세액", 13), G(64, "사업양수자의대리납부기납부세액", 13), G(65, "매입자납부특례기납부세액", 13),
    G(66, "가산세액계", 13), G(67, "차감납부할세액", 15), G(68, "과세표준명세수입금액제외금액", 13), G(69, "과세표준명세합계수입금액", 15),
    G(70, "면세사업수입금액제외금액", 13), G(71, "면세사업합계수입금액", 15), G(72, "계산서교부금액", 15), G(73, "계산서수취금액", 15),
    X("환급구분코드", 2, payable < 0 ? "10" : "ZZ"),   // 환급이면 10 일반환급, 아니면 ZZ (문서 74번)
    X("은행코드(국세환급금)", 3, ""), X("계좌번호(국세환급금)", 20, ""), X("총괄납부승인번호", 9, ""), X("은행지점명", 30, ""),
    X("폐업일자", 8, ""), X("폐업사유", 3, ""), X("기한후(과세표준)여부", 1, "N"),
    G(82, "실차감납부할세액", 15),                     // 총괄납부 주사업자만 · 그 외 0 (문서 82번)
    X("일반과세자구분", 1, "0"), X("조기환급취소구분", 1, "0"),
    G(85, "수출기업 수입 납부유예", 15), G(86, "신용카드업자의 대리납부 기납부세액", 13), G(87, "소규모 개인사업자 부가가치세 감면세액", 13),
    X("영세율상호주의여부", 1, "N"), G(89, "수시부과세액", 13), X("공란", 88, ""),
  ];

  //   수입금액 — 무실적이어도 '01' 한 건 필수(문서 §수입금액). 02·04·07·08·14 는 금액이 없으면 만들지 않는다
  const income: NtsField[] = [
    X("자료구분", 2, "15"), X("서식코드", 7, "I103200"), X("수입금액종류구분코드", 2, "01"),
    X("업태명", 30, i.bizType.trim()), X("종목명", 50, i.bizItem.trim()), X("업종코드", 7, i.industryCode.trim()),
    N("수입금액", 15, taxBase), X("공란", 37, ""),
  ];

  //   세금계산서합계표 — 문서 Ⅲ 순서 7 → (1) → 3 → 5 → (2) → 4 → 6. 이번 범위는 전자분만이라 자료 레코드 1·2 는 없고
  //   전자외 합계(3·4)는 0 으로 쓴다(문서 예시가 늘 함께 수록). 세금계산서가 한 장도 없으면 합계표 자체를 넣지 않는다.
  const saleTi = tiTotals(i.rows.filter((x) => x.vatType === "11"));
  const buyTi = tiTotals(i.rows.filter((x) => x.vatType === "51"));
  const total = (code: string, t: ReturnType<typeof tiTotals> | null): NtsField[] => {
    const z = { partners: 0, n: 0, supply: 0, vat: 0 };
    const a = t?.all || z, b = t?.biz || z, r = t?.rrn || z;
    return [
      X("자료구분", 1, code), P("보고자등록번호", 10, Number(bizNo || 0)),
      P("거래처수(합계)", 7, a.partners), P("매수(합계)", 7, a.n), MK("공급가액(합계)", 15, a.supply), MK("세액(합계)", 14, a.vat),
      P("거래처수(사업자)", 7, b.partners), P("매수(사업자)", 7, b.n), MK("공급가액(사업자)", 15, b.supply), MK("세액(사업자)", 14, b.vat),
      P("거래처수(주민)", 7, r.partners), P("매수(주민)", 7, r.n), MK("공급가액(주민)", 15, r.supply), MK("세액(주민)", 14, r.vat),
      X("공란", 30, ""),
    ];
  };
  const tiRecords: NtsField[][] = (saleTi.all.n + buyTi.all.n) > 0 ? [
    [X("자료구분", 1, "7"), P("보고자등록번호", 10, Number(bizNo || 0)), X("보고자상호", 30, i.companyName.trim()), X("보고자성명", 15, i.ceoName.trim()),
      X("보고자사업장소재지", 45, (i.address || "").trim()), X("보고자업태", 17, ""), X("보고자종목", 25, ""),
      P("거래기간", 12, Number(`${yymmdd(i.from)}${yymmdd(i.to)}`)), P("작성일자", 6, Number(yymmdd(i.to))), X("공란", 9, "")],
    total("3", null), total("5", saleTi), total("4", null), total("6", buyTi),
  ] : [];

  const recs: VatEfileRecord[] = [
    { fields: head, len: 600 }, { fields: general, len: 1200 }, { fields: income, len: 150 },
    ...tiRecords.map((f) => ({ fields: f, len: 170 })),
  ];
  //   레코드 길이가 서식마다 달라 길이 점검은 레코드별로
  for (const [k, r] of recs.entries()) {
    const sum = r.fields.reduce((s, f) => s + f.len, 0);
    if (sum !== r.len) issues.push({ field: "(레이아웃)", message: `${k + 1}번째 레코드 폭 합 ${sum} ≠ 규격 ${r.len}` });
  }
  const built = buildNtsFile(recs.map((r) => r.fields), { lineBreak: "\r\n" });
  lastRecords = recs;
  issues.push(...built.issues);
  const summary: VatEfileSummary = { taxBase, salesVat, buySupply: deduct.supply, buyVat: deduct.vat, payable, billBuy: p53.supply, saleTi: saleTi.all.n, buyTi: buyTi.all.n };
  return { bytes: issues.length ? null : built.bytes, fileName, issues, notes, summary };
}
