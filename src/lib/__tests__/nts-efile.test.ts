// 국세청 전자신고 파일 엔진 — EUC-KR(CP949) 바이트 정확성이 전부다 (2026-08-31 세무 4차, 결정 106).
//   오프셋이 한 바이트 밀리면 숫자가 엉뚱한 칸으로 들어가므로, 패딩·길이·미지원 문자를 바이트 단위로 검증한다.
import { describe, it, expect } from "vitest";

import { encodeEucKr, eucKrLen, packField, packRecord, buildNtsFile } from "@/lib/nts-efile";

describe("encodeEucKr — 역테이블 인코딩", () => {
  it("'가' = B0A1 (KS X 1001 첫 음절)", () => {
    expect(encodeEucKr("가").bytes).toEqual([0xb0, 0xa1]);
  });
  it("ASCII 는 1바이트 그대로", () => {
    expect(encodeEucKr("A1 ").bytes).toEqual([0x41, 0x31, 0x20]);
  });
  it("확장 한글('똠') — 런타임에 따라 2바이트(브라우저=CP949) 또는 bad(Node=순수 EUC-KR). 조용한 누락은 없다", () => {
    const r = encodeEucKr("똠");
    if (r.bad.length === 0) expect(r.bytes.length).toBe(2);   // CP949 런타임
    else { expect(r.bad).toEqual(["똠"]); expect(r.bytes).toEqual([]); }   // 엄격 EUC-KR 런타임
  });
  it("표현 불가 문자(이모지)는 bad 로 — 바꿔치지 않는다", () => {
    const r = encodeEucKr("a😀b");
    expect(r.bad).toEqual(["😀"]);
    expect(r.bytes).toEqual([0x61, 0x62]);
  });
  it("eucKrLen 은 바이트 길이 — '가나' = 4, 'ab가' = 4", () => {
    expect(eucKrLen("가나")).toBe(4);
    expect(eucKrLen("ab가")).toBe(4);
  });
});

describe("packField — 규격 폭 채우기", () => {
  it("X: 좌측 정렬 + 공백 채움 ('AB', 폭 5 → 'AB   ')", () => {
    const r = packField({ name: "t", len: 5, type: "X", value: "AB" });
    expect(r.issues).toEqual([]);
    expect(r.bytes).toEqual([0x41, 0x42, 0x20, 0x20, 0x20]);
  });
  it("X: 한글은 2바이트로 세서 채움 ('가나', 폭 6 → 4바이트 + 공백 2)", () => {
    const r = packField({ name: "t", len: 6, type: "X", value: "가나" });
    expect(r.bytes.length).toBe(6);
    expect(r.bytes.slice(4)).toEqual([0x20, 0x20]);
  });
  it("9: 우측 정렬 + 0 채움 (1234, 폭 8 → '00001234')", () => {
    const r = packField({ name: "t", len: 8, type: "9", value: 1234 });
    expect(String.fromCharCode(...r.bytes)).toBe("00001234");
  });
  it("X 길이 초과 — 자르지 않고 이슈", () => {
    const r = packField({ name: "상호", len: 4, type: "X", value: "가나다" });
    expect(r.issues.length).toBe(1);
    expect(r.issues[0].message).toContain("길이 초과");
  });
  it("9 자릿수 초과·음수 — 이슈", () => {
    expect(packField({ name: "t", len: 3, type: "9", value: 12345 }).issues[0].message).toContain("자릿수 초과");
    expect(packField({ name: "t", len: 8, type: "9", value: -5 }).issues[0].message).toContain("음수");
  });
});

describe("packRecord / buildNtsFile — 레코드·파일", () => {
  it("레코드 길이가 규격과 다르면 이슈", () => {
    const r = packRecord([{ name: "a", len: 3, type: "X", value: "x" }], 10);
    expect(r.issues[0].message).toContain("레코드 길이 3");
  });
  it("CRLF 로 잇고 바이트가 정확히 이어진다", () => {
    const f = (v: string) => [{ name: "a", len: 2, type: "X" as const, value: v }];
    const r = buildNtsFile([f("A"), f("B")], { recordLen: 2, lineBreak: "\r\n" });
    expect(r.issues).toEqual([]);
    expect([...r.bytes]).toEqual([0x41, 0x20, 0x0d, 0x0a, 0x42, 0x20, 0x0d, 0x0a]);
  });
  it("이슈에 몇 번째 레코드인지 붙는다", () => {
    const r = buildNtsFile([[{ name: "a", len: 1, type: "X", value: "가" }]]);
    expect(r.issues[0].message).toContain("1번째 레코드");
  });
});
