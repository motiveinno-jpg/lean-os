import { describe, expect, it } from "vitest";
import { findFlowImageRegions } from "@/lib/pdf-flow";

const ops = {
  save: 10,
  restore: 11,
  transform: 12,
  paintImageXObject: 85,
  paintJpegXObject: 86,
  paintInlineImageXObject: 87,
};

const util = {
  transform(a: number[], b: number[]) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  },
  applyTransform(point: number[], matrix: number[]) {
    return [
      point[0] * matrix[0] + point[1] * matrix[2] + matrix[4],
      point[0] * matrix[1] + point[1] * matrix[3] + matrix[5],
    ];
  },
};

describe("findFlowImageRegions", () => {
  it("페이지 배경이 아닌 개별 이미지의 변환 좌표만 반환한다", () => {
    const result = findFlowImageRegions(
      [ops.save, ops.transform, ops.paintImageXObject, ops.restore],
      [[], [100, 0, 0, 50, 10, 20], ["img"], []],
      ops,
      [1, 0, 0, 1, 0, 0],
      200,
      100,
      util,
    );

    expect(result.skippedBackgroundImages).toBe(0);
    expect(result.regions).toEqual([{ x: 10, y: 20, w: 100, h: 50 }]);
  });

  it("페이지 대부분을 덮는 이미지는 배경으로 제외한다", () => {
    const result = findFlowImageRegions(
      [ops.transform, ops.paintImageXObject],
      [[200, 0, 0, 100, 0, 0], ["background"]],
      ops,
      [1, 0, 0, 1, 0, 0],
      200,
      100,
      util,
    );

    expect(result.regions).toEqual([]);
    expect(result.skippedBackgroundImages).toBe(1);
  });

  it("동일 위치에 중복 렌더된 이미지 연산자는 한 번만 가져온다", () => {
    const result = findFlowImageRegions(
      [
        ops.save, ops.transform, ops.paintImageXObject, ops.restore,
        ops.save, ops.transform, ops.paintImageXObject, ops.restore,
      ],
      [
        [], [40, 0, 0, 40, 20, 20], ["first"], [],
        [], [40, 0, 0, 40, 20, 20], ["duplicate"], [],
      ],
      ops,
      [1, 0, 0, 1, 0, 0],
      200,
      100,
      util,
    );

    expect(result.regions).toHaveLength(1);
  });
});
