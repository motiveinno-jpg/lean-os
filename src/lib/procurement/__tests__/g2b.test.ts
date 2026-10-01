import { describe, it, expect, vi } from "vitest";
import {
  kstTimestamp,
  parseG2bResponse,
  normalizeG2b,
  fetchG2bNotices,
  queryTime,
} from "../g2b";
const item = {
  bidNtceNo: "TEST-1",
  bidNtceOrd: "000",
  bidNtceNm: "홍보 운영 용역",
  dminsttNm: "검증 기관",
  bidNtceDt: "2026-09-29 09:00:00",
  bidClseDt: "2026-10-20 18:00:00",
  asignBdgtAmt: "100,000,000",
};
const envelope = (items: unknown, total: number) => ({
  response: {
    header: { resultCode: "00" },
    body: { items, totalCount: total },
  },
});
describe("나라장터 수집 어댑터", () => {
  it("API 목록은 전체 원문으로 표시하지 않는다", () => {
    expect(normalizeG2b(item)).toMatchObject({
      budget: 100000000,
      documents: [],
      deadline: "2026-10-20T09:00:00.000Z",
    });
  });
  it("취소·첨부·누락 예산을 보존한다", () => {
    expect(
      normalizeG2b({
        ...item,
        asignBdgtAmt: "",
        bidNtceKindNm: "취소공고",
        ntceSpecDocUrl1: "https://www.g2b.go.kr/spec.pdf",
        ntceSpecFileNm1: "과업지시서.pdf",
      }),
    ).toMatchObject({
      status: "cancelled",
      budget: null,
      attachments: [
        { name: "과업지시서.pdf", url: "https://www.g2b.go.kr/spec.pdf" },
      ],
    });
  });
  it("잘못된 날짜나 문자열 금액을 추측해서 바꾸지 않는다", () => {
    expect(() => kstTimestamp("2026-02-30 09:00:00")).toThrow();
    expect(() =>
      normalizeG2b({ ...item, asignBdgtAmt: "금 일억원" }),
    ).toThrow();
    expect(queryTime(new Date("2026-09-29T23:00:00Z"))).toBe("202609300800");
  });
  it("배열·item 객체·빈 목록을 지원한다", () => {
    expect(parseG2bResponse(envelope({ item: [item] }, 1)).items).toHaveLength(
      1,
    );
    expect(parseG2bResponse(envelope({ item }, 1)).items).toHaveLength(1);
    expect(parseG2bResponse(envelope("", 0)).items).toEqual([]);
  });
  it("HTTP 성공이라도 API 실패나 총건수 누락이면 실패한다", () => {
    expect(() =>
      parseG2bResponse({ response: { header: { resultCode: "30" } } }),
    ).toThrow();
    expect(() =>
      parseG2bResponse({
        response: { header: { resultCode: "00" }, body: { items: [] } },
      }),
    ).toThrow();
  });
  it("다음 페이지까지 수집하고 검색어 중복은 합친다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(envelope([item], 2)))
      .mockResolvedValueOnce(
        Response.json(envelope([{ ...item, bidNtceNo: "TEST-2" }], 2)),
      )
      .mockResolvedValueOnce(Response.json(envelope([item], 1)));
    const result = await fetchG2bNotices(
      ["홍보", "콘텐츠"],
      "test-key",
      new Date("2026-09-30T00:00:00Z"),
      fetcher,
    );
    expect(result).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[1][0])).toContain("pageNo=2");
  });
  it("중간에 빈 페이지가 오면 일부 수집을 완료로 보고하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(envelope([], 2)));
    await expect(
      fetchG2bNotices(["홍보"], "key", new Date(), fetcher),
    ).rejects.toThrow("중간에 끊겼습니다");
  });
  it("키 없는 요청은 외부 API를 호출하지 않는다", async () => {
    const fetcher = vi.fn();
    await expect(
      fetchG2bNotices(["홍보"], "", new Date(), fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
