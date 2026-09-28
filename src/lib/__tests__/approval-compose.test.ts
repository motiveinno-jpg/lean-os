import { describe, expect, it } from "vitest";
import { composeFormRequest, joinLeaveReason, splitLeaveReason } from "@/lib/approval-compose";

const AD_FIELDS = [
  { key: "who", label: "부서-이름", type: "text" as const, required: true },
  { key: "v", label: "업체명", type: "text" as const, required: true },
  { key: "amt", label: "결제 총 금액", type: "amount" as const, required: false },
  { key: "fx", label: "관련프로젝트", type: "fixed" as const, required: true },
];

describe("composeFormRequest — 새 요청과 수정 저장이 같은 결과를 내야 한다", () => {
  const base = { formName: "광고비 지출결의서", fields: AD_FIELDS, title: "광고비 지출결의서", body: "<p>사유</p>" };

  it("제목·본문·금액을 만든다", () => {
    const r = composeFormRequest({ ...base, values: { who: "마케팅팀 - 유영규", v: "하봄", amt: "1,815,000" } });
    expect(r.title).toBe("광고비 지출결의서 — 하봄");
    expect(r.amount).toBe(1815000);
    expect(r.description).toBe("<p>부서-이름: 마케팅팀 - 유영규</p><p>업체명: 하봄</p><p>결제 총 금액: 1,815,000</p><p>관련프로젝트: </p><p>사유</p>");
    expect(r.missing).toEqual([]);
  });

  it("필수 칸이 비면 missing 에 담는다(고정값 칸은 제외)", () => {
    const r = composeFormRequest({ ...base, values: { who: "", v: " " } });
    expect(r.missing).toEqual(["부서-이름", "업체명"]);
  });

  it("경비 양식은 금액 0 을 막는다", () => {
    expect(composeFormRequest({ ...base, values: { who: "a", v: "b", amt: "0" }, isExpense: true }).missing).toEqual(["결제 총 금액"]);
    expect(composeFormRequest({ ...base, values: { who: "a", v: "b", amt: "10" }, isExpense: true }).missing).toEqual([]);
  });

  it("수정에서 업체명을 바꾸면 제목 꼬리도 바뀐다", () => {
    const r = composeFormRequest({ ...base, title: "광고비 지출결의서 — 트러스카", prevVendor: "트러스카", values: { who: "a", v: "하봄" } });
    expect(r.title).toBe("광고비 지출결의서 — 하봄");
  });

  it("금액 필드가 없는 양식은 amount 가 null(호출하는 쪽이 정함)", () => {
    expect(composeFormRequest({ formName: "품의서", fields: [], values: {}, title: "t", body: "" }).amount).toBeNull();
  });

  it("평문 본문은 HTML 로, 빈 본문은 버린다", () => {
    expect(composeFormRequest({ formName: "x", fields: [], values: {}, title: "t", body: "a\nb" }).description).toBe("<p>a</p><p>b</p>");
    expect(composeFormRequest({ formName: "x", fields: [], values: {}, title: "t", body: "<p></p>" }).description).toBe("");
  });
});

describe("휴가 수정 — 날짜 부분은 고정, 사유만 바꾼다", () => {
  const desc = "[휴가 신청서]\n\n- 신청자: 권순철\n- 휴가 기간: 2026.10.02 ~ 2026.10.02 (1일)\n\n사유:\n개인 사정";

  it("사유만 바꿔 다시 붙인다", () => {
    const p = splitLeaveReason(desc);
    expect(p.reason).toBe("개인 사정");
    expect(joinLeaveReason(p, "병원 진료")).toBe("[휴가 신청서]\n\n- 신청자: 권순철\n- 휴가 기간: 2026.10.02 ~ 2026.10.02 (1일)\n\n사유:\n병원 진료");
  });

  it("바꾸지 않으면 원문 그대로", () => {
    const p = splitLeaveReason(desc);
    expect(joinLeaveReason(p, p.reason)).toBe(desc);
  });

  it("사유 표시가 없는 옛 본문은 사유를 넣을 때만 붙인다", () => {
    const p = splitLeaveReason("옛 휴가 본문");
    expect(joinLeaveReason(p, "")).toBe("옛 휴가 본문");
    expect(joinLeaveReason(p, "추가")).toBe("옛 휴가 본문\n사유:\n추가");
  });
});
