import { describe, it, expect } from "vitest";
import { scopePrecheck } from "../scope";
import { parseEvidenceImport, parseEvidence } from "../validation";
import { notice, evidence } from "./fixtures";
import type { ProjectRecord } from "../types";
const project: ProjectRecord = {
  agency: "가상 기관",
  period: "2025.01~12",
  amount: 10000000,
  scopes: ["ads", "video", "program"],
  state: "reported-ended",
  attribution: "company-reported",
  duplicateGroup: null,
  issues: [],
};
const records = [{ ...evidence[1], project }];
const n = (text: string) => ({
  ...notice,
  documents: [{ ...notice.documents[0], text }],
});
describe("실적 기반 사전 분류", () => {
  it("홍보 제목만 있는 경우 확정 추천하지 않는다", () => {
    expect(
      scopePrecheck(
        { ...notice, title: "소상공인 검색광고 지원", documents: [] },
        records,
      ).status,
    ).toBe("confirm");
  });
  it("동일 업무 실적을 원문 위치와 연결하되 자격 충족으로 확정하지 않는다", () => {
    const result = scopePrecheck(
      n("소상공인 검색광고를 집행하고 영상 제작을 수행한다."),
      records,
    );
    expect(result.status).toBe("possible");
    expect(result.tasks[0].evidence[0].id).toBe(evidence[1].id);
    expect(result.tasks[0].hits[0].location).toBe(notice.documents[0].location);
    expect(result.caveat).toContain("입찰 자격");
  });
  it("홍보와 시스템 개발 혼합 요구를 분리한다", () => {
    expect(
      scopePrecheck(n("검색광고 집행. 정보시스템 개발 및 유지보수."), records)
        .status,
    ).toBe("difficult");
  });
  it("제외·발주처 제공 문맥을 불가능으로 단정하지 않는다", () => {
    expect(
      scopePrecheck(n("전기 공사는 과업에서 제외한다. 검색광고 집행."), records)
        .status,
    ).toBe("confirm");
  });
  it("직원 이전 회사 경력을 회사 유사실적으로 인정하지 않는다", () => {
    expect(
      scopePrecheck(n("검색광고 집행"), [
        {
          ...records[0],
          project: { ...project, attribution: "previous-employer" },
        },
      ]).status,
    ).toBe("confirm");
  });
  it("중복 의심 실적만으로 수행 가능 후보를 확정하지 않는다", () => {
    expect(
      scopePrecheck(n("검색광고 집행"), [
        { ...records[0], project: { ...project, duplicateGroup: "duplicate" } },
      ]).status,
    ).toBe("confirm");
  });
  it("관련 전시 실적이 있어도 현장 범위를 확인한다", () => {
    expect(
      scopePrecheck(n("해외 쇼룸 운영"), [
        { ...records[0], project: { ...project, scopes: ["showroom"] } },
      ]).status,
    ).toBe("confirm");
  });
  it("수행 중 기록을 완료로 변경하지 않는다", () => {
    const result = scopePrecheck(n("검색광고 집행"), [
      { ...records[0], project: { ...project, state: "ongoing" } },
    ]);
    expect(result.tasks[0].evidence[0].state).toBe("ongoing");
  });
  it("다른 사업자번호 자료 가져오기를 차단한다", () => {
    expect(() =>
      parseEvidenceImport(
        { companyBusinessNumber: "1111111111", items: records },
        "2222222222",
      ),
    ).toThrow("접속한 오너뷰 회사");
  });
  it("가져온 자료의 검증 플래그·파일·만료일을 신뢰하지 않는다", () => {
    const [item] = parseEvidenceImport(
      { companyBusinessNumber: "1111111111", items: records },
      "111-11-11111",
    );
    expect(item.verified).toBe(false);
    expect(item.verifiedAt).toBe(null);
    expect(item.documentFileId).toBe(null);
    expect(item.project).toEqual(project);
  });
  it("잘못된 금액·과업 태그를 거부한다", () => {
    expect(() =>
      parseEvidence({
        ...records[0],
        project: { ...project, amount: "10000" },
      }),
    ).toThrow("계약금액");
    expect(() =>
      parseEvidence({
        ...records[0],
        project: { ...project, scopes: ["unknown"] },
      }),
    ).toThrow("실적 업무 범위");
  });
});
