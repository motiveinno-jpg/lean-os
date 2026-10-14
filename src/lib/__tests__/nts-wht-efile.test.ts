// C103900 원천징수이행상황신고서 전자신고 파일 — 규격 문서의 누적 바이트 위치와 대조 검증 (2026-08-31 세무 4차).
//   「원천신고 전산매체 제출요령 V2(2020.04.22)」 테이블 형식 표의 누적값이 기준이다.
import { describe, it, expect } from "vitest";

import { buildWhtEfile, type WhtEfileInput } from "@/lib/nts-wht-efile";

const asc = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

const BASE: WhtEfileInput = {
  bizNo: "123-45-67890",
  hometaxId: "motive_hometax",
  companyName: "MOTIVE",           // ASCII 로 두면 바이트 위치 검증이 쉽다(한글 케이스는 별도)
  ceoName: "HONG",
  yearMonth: "2026-08",
  submitYm: "2026-09",
  madeOn: "2026-09-10",
  rows: [
    { code: "A01", n: 2, pay: 5_000_000, tax: 64_000 },
    { code: "A10", n: 2, pay: 5_000_000, tax: 64_000 },
    { code: "A99", n: 2, pay: 5_000_000, tax: 64_000 },
  ],
};

describe("buildWhtEfile — C103900 규격 바이트 대조", () => {
  it("파일명 = 작성일자 + C103900.01", () => {
    const r = buildWhtEfile(BASE);
    expect(r.issues).toEqual([]);
    expect(r.fileName).toBe("20260910C103900.01");
  });

  it("전체 구조 — Header 400 + 조정 200 + 명세 150×3, 각 레코드 뒤 CRLF", () => {
    const r = buildWhtEfile(BASE);
    const b = r.bytes!;
    expect(b.length).toBe(400 + 2 + 200 + 2 + (150 + 2) * 3);
    expect(asc(b, 400, 402)).toBe("\r\n");
  });

  it("Header — 문서 누적 위치 그대로 (자료구분2 · 서식9 · 납세자ID22 · 귀속37 · 지급43 · 제출49 · 작성일자369 · 프로그램코드373)", () => {
    const b = buildWhtEfile(BASE).bytes!;
    expect(asc(b, 0, 2)).toBe("21");
    expect(asc(b, 2, 9)).toBe("C103900");
    expect(asc(b, 9, 22)).toBe("1234567890   ");   // 사업자번호 10 + 공백 3
    expect(asc(b, 22, 24)).toBe("14");
    expect(asc(b, 24, 26)).toBe("01");
    expect(asc(b, 26, 28)).toBe("01");
    expect(asc(b, 28, 31)).toBe("F01");
    expect(asc(b, 31, 37)).toBe("202608");          // 귀속연월
    expect(asc(b, 37, 43)).toBe("202608");          // 지급연월
    expect(asc(b, 43, 49)).toBe("202609");          // 제출연월
    expect(asc(b, 49, 69).trimEnd()).toBe("motive_hometax");
    expect(asc(b, 69, 74)).toBe("FF001");
    expect(asc(b, 134, 164).trimEnd()).toBe("MOTIVE");   // 법인명 (누적 164)
    expect(asc(b, 298, 328).trimEnd()).toBe("HONG");     // 대표자명 (누적 328)
    expect(asc(b, 328, 330)).toBe("01");            // 원천신고구분 매월
    expect(asc(b, 330, 338)).toBe("NNNNNNNN");      // 여부 플래그 8개 전부 N
    expect(asc(b, 361, 369)).toBe("20260910");      // 작성일자 (누적 369)
    expect(asc(b, 369, 373)).toBe("9000");          // 세무프로그램코드
    expect(asc(b, 373, 400)).toBe(" ".repeat(27)); // 공란
  });

  it("'22' 환급조정 — 전부 0, 길이 200", () => {
    const b = buildWhtEfile(BASE).bytes!;
    const rec = b.slice(402, 602);
    expect(asc(rec, 0, 2)).toBe("22");
    expect(asc(rec, 9, 24)).toBe("0".repeat(15));   // (12)전월미환급세액
    expect(asc(rec, 189, 200)).toBe(" ".repeat(11));
  });

  it("'23' 명세 — 소득코드·인원·총지급액·세액이 누적 12/27/42/57 위치에", () => {
    const b = buildWhtEfile(BASE).bytes!;
    const rec = b.slice(604, 754);                  // 첫 명세(A01)
    expect(asc(rec, 0, 2)).toBe("23");
    expect(asc(rec, 9, 12)).toBe("A01");
    expect(asc(rec, 12, 27)).toBe("000000000000002");
    expect(asc(rec, 27, 42)).toBe("000000005000000");
    expect(asc(rec, 42, 57)).toBe("000000000064000");
    expect(asc(rec, 102, 117)).toBe("000000000064000"); // (10)납부세액 = 징수세액
    expect(asc(rec, 132, 150)).toBe(" ".repeat(18));
  });

  it("퇴직소득 A22·A20 — 근로 다음에 같은 150바이트 레코드 (2026-10-07)", () => {
    const b = buildWhtEfile({ ...BASE, rows: [
      ...BASE.rows.slice(0, 2),
      { code: "A22", n: 1, pay: 30_000_000, tax: 100_000 },
      { code: "A20", n: 1, pay: 30_000_000, tax: 100_000 },
      { code: "A99", n: 3, pay: 35_000_000, tax: 164_000 },
    ] }).bytes!;
    expect(b.length).toBe(400 + 2 + 200 + 2 + (150 + 2) * 5);
    const rec = b.slice(604 + 152 * 2, 604 + 152 * 2 + 150);
    expect(asc(rec, 9, 12)).toBe("A22");
    expect(asc(rec, 27, 42)).toBe("000000030000000");
    expect(asc(rec, 42, 57)).toBe("000000000100000");
  });

  it("한글 상호는 2바이트로 세도 전체 길이 400 유지", () => {
    const r = buildWhtEfile({ ...BASE, companyName: "모티브이노베이션", ceoName: "홍길동" });
    expect(r.issues).toEqual([]);
    expect(r.bytes!.slice(0, 400).length).toBe(400);
    //   법인명 필드(134~164) 안: 한글 8자 = 16바이트 + 공백 14
    expect(r.bytes![134 + 16]).toBe(0x20);
  });

  it("막는 것 — 홈택스ID 없음·사업자번호 자릿수·0 금액 전부·음수 세액", () => {
    expect(buildWhtEfile({ ...BASE, hometaxId: "" }).issues.some((i) => i.field === "홈택스 사용자ID")).toBe(true);
    expect(buildWhtEfile({ ...BASE, bizNo: "123" }).issues.some((i) => i.field === "사업자등록번호")).toBe(true);
    expect(buildWhtEfile({ ...BASE, rows: [] }).issues.some((i) => i.message.includes("무실적"))).toBe(true);
    expect(buildWhtEfile({ ...BASE, rows: [{ code: "A01", n: 1, pay: 100, tax: -5 }] }).issues.some((i) => i.message.includes("음수"))).toBe(true);
  });
});

// 연말정산 4단계 (2026-10-14) — A04 합계 + A06 납부금액, 연말정산여부 Y, 음수(환급)는 A04·A06 만
describe("buildWhtEfile — 연말정산 A04·A06", () => {
  const FEB: WhtEfileInput = {
    ...BASE, yearMonth: "2027-02", submitYm: "2027-03",
    rows: [
      { code: "A01", n: 2, pay: 5_000_000, tax: 64_000 },
      { code: "A04", n: 2, pay: 60_000_000, tax: -30_000 },
      { code: "A06", n: 0, pay: 0, tax: -30_000 },
      { code: "A10", n: 4, pay: 65_000_000, tax: 34_000 },
      { code: "A99", n: 4, pay: 65_000_000, tax: 34_000 },
    ],
  };
  it("Header 23번 연말정산여부 = Y (누적 331), 없으면 N", () => {
    const b = buildWhtEfile(FEB).bytes!;
    expect(asc(b, 330, 331)).toBe("Y");
    expect(asc(buildWhtEfile(BASE).bytes!, 330, 331)).toBe("N");
  });
  it("A04 음수 세액은 '-' 부호가 폭 안에 (규격 '-00100'), 납부세액(10)은 0", () => {
    const b = buildWhtEfile(FEB).bytes!;
    const at = 400 + 2 + 200 + 2 + (150 + 2) * 1;   // 두 번째 명세 = A04
    expect(asc(b, at + 9, at + 12)).toBe("A04");
    expect(asc(b, at + 42, at + 57)).toBe("-00000000030000");
    expect(asc(b, at + 102, at + 117)).toBe("000000000000000");
  });
  it("가감계(A10) 음수는 막는다 — 규격상 음수 허용 코드가 아님", () => {
    const rows = FEB.rows.map((r) => (r.code === "A10" || r.code === "A99" ? { ...r, tax: r.code === "A10" ? -10_000 : 0 } : r));
    expect(buildWhtEfile({ ...FEB, rows }).issues.some((i) => i.field === "A10")).toBe(true);
  });
  it("A04 인원·지급액은 2월 지급분에만", () => {
    expect(buildWhtEfile({ ...FEB, yearMonth: "2027-03", submitYm: "2027-04" }).issues.some((i) => i.field === "A04")).toBe(true);
  });
});

describe("buildWhtEfile — A02 중도퇴사", () => {
  it("A02 음수 허용, 연말정산여부는 N(A04·A05·A06·A26·A46 만 Y), 아무 달이나", () => {
    const r = buildWhtEfile({ ...BASE, yearMonth: "2026-09", submitYm: "2026-10", rows: [
      { code: "A01", n: 3, pay: 9_000_000, tax: 150_000 },
      { code: "A02", n: 1, pay: 27_000_000, tax: -80_000 },
      { code: "A10", n: 4, pay: 36_000_000, tax: 70_000 },
      { code: "A99", n: 4, pay: 36_000_000, tax: 70_000 },
    ] });
    expect(r.issues).toEqual([]);
    expect(asc(r.bytes!, 330, 331)).toBe("N");
    const at = 400 + 2 + 200 + 2 + (150 + 2) * 1;
    expect(asc(r.bytes!, at + 9, at + 12)).toBe("A02");
    expect(asc(r.bytes!, at + 42, at + 57)).toBe("-00000000080000");
  });
});
