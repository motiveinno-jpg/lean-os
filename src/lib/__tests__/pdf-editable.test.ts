import { describe, expect, it } from "vitest";
import {
  mergeEditableTextItems,
  type PdfEditableText,
} from "@/lib/pdf-editable";

const item = (
  t: string,
  x: number,
  y = 20,
  extra: Partial<PdfEditableText> = {},
): PdfEditableText => ({
  t,
  x,
  y,
  fs: 10,
  w: 10,
  f: "Arial",
  bg: "#ffffff",
  ...extra,
});

describe("mergeEditableTextItems", () => {
  it("한 글자씩 추출된 인접 한글을 하나의 편집 덩어리로 합친다", () => {
    const result = mergeEditableTextItems([
      item("홍", 10),
      item("길", 20),
      item("동", 30),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ t: "홍길동", x: 10, w: 30 });
  });

  it("단어 간 시각적 간격은 공백으로 복원한다", () => {
    const result = mergeEditableTextItems([
      item("오너뷰", 10, 20, { w: 24 }),
      item("테스트", 37, 20, { w: 24 }),
    ]);

    expect(result[0].t).toBe("오너뷰 테스트");
  });

  it("굵기나 줄이 다른 글자는 별도 편집 덩어리로 유지한다", () => {
    const result = mergeEditableTextItems([
      item("근로자:", 10, 20, { w: 35, b: true }),
      item("홍길동", 47, 20, { w: 30 }),
      item("계약일", 10, 40, { w: 30 }),
    ]);

    expect(result.map((value) => value.t)).toEqual(["근로자:", "홍길동", "계약일"]);
  });
});
