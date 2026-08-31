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
