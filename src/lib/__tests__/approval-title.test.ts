import { describe, expect, it } from "vitest";
import { titleWithAdVendor } from "@/lib/approval-forms";

const FIELDS = [{ key: "a", label: "부서-이름" }, { key: "v", label: "업체명" }];
const AD = "광고비 지출결의서";

describe("titleWithAdVendor", () => {
  it("광고비 지출결의서면 업체명을 제목 뒤에 붙인다", () => {
    expect(titleWithAdVendor(AD, FIELDS, { v: "하봄" }, "광고비 지출결의서")).toBe("광고비 지출결의서 — 하봄");
  });

  it("업체명을 비워 올렸다가 수정으로 채우면 붙는다", () => {
    expect(titleWithAdVendor(AD, FIELDS, { v: "하봄" }, "광고비 지출결의서", "")).toBe("광고비 지출결의서 — 하봄");
  });

  it("업체명을 바꾸면 옛 업체명을 새 것으로 갈아 끼운다", () => {
    expect(titleWithAdVendor(AD, FIELDS, { v: "하봄" }, "광고비 지출결의서 — 트러스카", "트러스카")).toBe("광고비 지출결의서 — 하봄");
  });

  it("업체명을 지우면 제목 끝의 옛 업체명도 뗀다", () => {
    expect(titleWithAdVendor(AD, FIELDS, { v: "" }, "광고비 지출결의서 — 트러스카", "트러스카")).toBe("광고비 지출결의서");
  });

  it("이미 제목에 있으면 두 번 붙이지 않는다", () => {
    expect(titleWithAdVendor(AD, FIELDS, { v: "하봄" }, "하봄 광고비 지출결의서")).toBe("하봄 광고비 지출결의서");
    expect(titleWithAdVendor(AD, FIELDS, { v: "하봄" }, "광고비 지출결의서 — 하봄", "하봄")).toBe("광고비 지출결의서 — 하봄");
  });

  it("다른 양식은 건드리지 않는다", () => {
    expect(titleWithAdVendor("경비 청구서", FIELDS, { v: "하봄" }, "경비 청구서")).toBe("경비 청구서");
  });
});
