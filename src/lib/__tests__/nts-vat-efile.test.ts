// 부가세 전자신고 파일 — 문서(부가가치세 전자신고 파일설명서 2026.6)의 누적 바이트 위치와 대조한다 (2026-10-08 ERP 3차 D)
import { describe, it, expect } from "vitest";
import { buildVatEfile, vatEfileLastRecords, type VatEfileInput } from "@/lib/nts-vat-efile";

//   문서 표의 '누적' 칸 그대로 (scratchpad 추출본 → 레코드별)
const DOC_CUM: Record<string, number[]> = {
  head: [2, 9, 22, 24, 26, 28, 34, 37, 57, 70, 100, 104, 109, 114, 144, 174, 244, 258, 328, 342, 372, 422, 429, 437, 445, 453, 454, 468, 472, 485, 535, 543, 549, 600],
  general: [2, 9, 24, 37, 50, 63, 78, 93, 106, 119, 132, 147, 160, 173, 186, 199, 212, 225, 238, 251, 264, 277, 290, 305, 320, 335, 348, 361, 374, 387, 400, 413, 426, 439, 452, 465, 478, 491, 504, 517, 530, 543, 556, 571, 584, 597, 610, 623, 636, 649, 662, 675, 688, 701, 714, 729, 742, 755, 770, 785, 798, 811, 824, 837, 850, 863, 878, 891, 906, 919, 934, 949, 964, 966, 969, 989, 998, 1028, 1036, 1039, 1040, 1055, 1056, 1057, 1072, 1085, 1098, 1099, 1112, 1200],
  income: [2, 9, 11, 41, 91, 98, 113, 150],
  ti_cover: [1, 11, 41, 56, 101, 118, 143, 155, 161, 170],
  ti_total: [1, 11, 18, 25, 40, 54, 61, 68, 83, 97, 104, 111, 126, 140, 170],
};
const cum = (lens: number[]) => lens.reduce<number[]>((a, l) => [...a, (a.at(-1) || 0) + l], []);

const base = (rows: VatEfileInput["rows"]): VatEfileInput => ({
  bizNo: "155-88-02209", hometaxId: "testuser", companyName: "(주)테스트", ceoName: "홍길동",
  address: "서울특별시 중구 세종대로 110", phone: "02-123-4567", bizType: "서비스업", bizItem: "광고대행", industryCode: "743002",
  year: 2026, period: "2p", from: "2026-07-01", to: "2026-09-30", madeOn: "2026-10-20", rows,
});
const ok = base([
  { vatType: "11", supply: 1000000, vat: 100000, electronic: true, partnerBizno: "1234567890", partnerName: "가" },
  { vatType: "11", supply: 500000, vat: 50000, electronic: true, partnerBizno: "1234567890", partnerName: "가" },
  { vatType: "51", supply: 3000000, vat: 300000, electronic: true, partnerBizno: "2208162517", partnerName: "나" },
  { vatType: "53", supply: 30750, vat: 0, electronic: true, partnerBizno: "2208162517", partnerName: "나" },
]);
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

describe("레이아웃 — 문서 누적 위치와 한 바이트도 다르지 않다", () => {
  const r = buildVatEfile(ok);
  const recs = vatEfileLastRecords();
  it("파일이 만들어지고 이슈가 없다", () => { expect(r.issues).toEqual([]); expect(r.bytes).not.toBeNull(); });
  it("Head 600", () => expect(cum(recs[0].fields.map((f) => f.len))).toEqual(DOC_CUM.head));
  it("일반신고서 1200 · 90칸", () => expect(cum(recs[1].fields.map((f) => f.len))).toEqual(DOC_CUM.general));
  it("수입금액 150", () => expect(cum(recs[2].fields.map((f) => f.len))).toEqual(DOC_CUM.income));
  it("세금계산서합계표 표지 170", () => expect(cum(recs[3].fields.map((f) => f.len))).toEqual(DOC_CUM.ti_cover));
  it("합계 레코드 3·5·4·6 170", () => { for (const k of [4, 5, 6, 7]) expect(cum(recs[k].fields.map((f) => f.len))).toEqual(DOC_CUM.ti_total); });
});

describe("값 — 칸 위치에 맞는 숫자", () => {
  const r = buildVatEfile(ok);
  const lines = text(r.bytes!).split("\r\n");
  it("레코드 순서 11 → 17 → 15 → 7 → 3 → 5 → 4 → 6, 각 길이 600·1200·150·170", () => {
    expect(lines.slice(0, 8).map((l) => l.slice(0, 2))).toEqual(["11", "17", "15", "7"+lines[3][1], "3"+lines[4][1], "5"+lines[5][1], "4"+lines[6][1], "6"+lines[7][1]]);
    expect(lines.slice(0, 8).map((l) => l.length)).toEqual([600, 1200, 150, 170, 170, 170, 170, 170]);
  });
  it("Head — 예정(03)·C17·202602·0701~0930", () => {
    const h = lines[0];
    expect(h.slice(22, 24)).toBe("41"); expect(h.slice(24, 26)).toBe("03"); expect(h.slice(28, 34)).toBe("202602"); expect(h.slice(34, 37)).toBe("C17");
    expect(h.slice(429, 437)).toBe("20260701"); expect(h.slice(437, 445)).toBe("20260930");
  });
  it("(1) 1,500,000/150,000 · (10) 3,000,000/300,000 · (다) −150,000 은 '-' 부호 · 환급구분 10", () => {
    const g = lines[1];
    expect(g.slice(9, 24)).toBe("000000001500000"); expect(g.slice(24, 37)).toBe("0000000150000");
    expect(g.slice(320, 335)).toBe("000000003000000"); expect(g.slice(335, 348)).toBe("0000000300000");
    expect(g.slice(742, 755)).toBe("-000000150000");   // 58 납부(환급)세액
    expect(g.slice(863, 878)).toBe("-00000000150000"); // 67 차감납부할세액
    expect(g.slice(949, 964)).toBe("000000000030750"); // 73 계산서수취 (90)
    expect(g.slice(964, 966)).toBe("10");
  });
  it("전자 매출 합계 5 — 거래처 1·매수 2·1,500,000 / 매입 6 — 1·1·3,000,000", () => {
    const s5 = lines[5], s6 = lines[7];
    expect(s5.slice(11, 18)).toBe("0000001"); expect(s5.slice(18, 25)).toBe("0000002"); expect(s5.slice(25, 40)).toBe("000000001500000");
    expect(s6.slice(11, 18)).toBe("0000001"); expect(s6.slice(25, 40)).toBe("000000003000000");
  });
  it("파일명 = 사업자번호 + 작성일자 + .101", () => expect(r.fileName).toBe("155880220920261020.101"));
  it("계산서 수취는 확인 필요로 알린다", () => expect(r.notes.some((n) => n.includes("(90)"))).toBe(true));
});

describe("못 만드는 경우 — 파일 없이 이유", () => {
  it("카드 매입·종이 세금계산서·업종코드 없음", () => {
    const r = buildVatEfile({ ...base([
      { vatType: "57", supply: 10000, vat: 1000, electronic: false, partnerBizno: null, partnerName: null },
      { vatType: "51", supply: 10000, vat: 1000, electronic: false, partnerBizno: "2208162517", partnerName: "나" },
    ]), industryCode: "" });
    expect(r.bytes).toBeNull();
    const f = r.issues.map((x) => x.field);
    expect(f).toContain("카드·현금영수증 매입"); expect(f).toContain("종이 세금계산서"); expect(f).toContain("업종코드");
  });
  it("사업자번호 검증번호가 틀리면 막는다", () => {
    expect(buildVatEfile({ ...ok, bizNo: "1558802208" }).issues.some((x) => x.field === "사업자번호")).toBe(true);
  });
});
