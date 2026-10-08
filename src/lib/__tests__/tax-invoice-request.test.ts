// 세금계산서 발행 요청 — 금액 계산·승인번호 검증·요청→발행 payload 변환
import { describe, it, expect } from "vitest";
import {
  calcRequestLine, sumRequestItems, requestRemark, requestItemsToTaxInvoiceItems,
  validateConfirmNo, normalizeConfirmNo, formatConfirmNo, validateWriteDate, formatBizNo, isRequestExpired,
} from "@/lib/tax-invoice-request";
import {
  buildIssuePayload, requestToIssueArgs, requestRemarkText, requestItemsToInvoiceItems,
} from "../../../supabase/functions/_shared/tax-invoice-payload";

describe("금액 계산", () => {
  it("과세는 공급가액의 10%, 영세율·면세는 0", () => {
    expect(calcRequestLine(3, 33333, "taxable")).toEqual({ supply: 99999, tax: 10000 });
    expect(calcRequestLine(2, 50000, "zero_rated")).toEqual({ supply: 100000, tax: 0 });
    expect(calcRequestLine(1, 7000, "exempt")).toEqual({ supply: 7000, tax: 0 });
  });
  it("소수 수량도 원 단위로 반올림", () => {
    expect(calcRequestLine(1.5, 1001, "taxable")).toEqual({ supply: 1502, tax: 150 });
  });
  it("합계는 줄마다 고친 값을 더하고 이름 없는 줄은 뺀다", () => {
    const s = sumRequestItems([
      { name: "광고비", supply_amount: 100000, tax_amount: 10000 },
      { name: "  ", supply_amount: 999, tax_amount: 99 },
      { name: "수수료", supply_amount: 5000, tax_amount: 499 },
    ]);
    expect(s).toEqual({ supply: 105000, tax: 10499, total: 115499 });
  });
});

describe("승인번호", () => {
  it("하이픈을 빼고 24자리", () => {
    expect(normalizeConfirmNo("20261001-10260930-81006865")).toBe("202610011026093081006865");
    expect(validateConfirmNo("20261001-1026093081006865", "2026-10-01")).toBeNull();
    expect(validateConfirmNo("2026100110260930", "2026-10-01")).toMatch(/24자리/);
    expect(validateConfirmNo("", "2026-10-01")).toMatch(/입력/);
  });
  it("영문이 섞인 승인번호도 받는다", () => {
    expect(validateConfirmNo("2026092041000021b0014872", "2026-09-20")).toBeNull();
  });
  it("앞 8자리가 작성일자와 다르면 거절", () => {
    expect(validateConfirmNo("202610021026093081006865", "2026-10-01")).toMatch(/작성일자/);
  });
  it("보기 좋게 8-8-8", () => {
    expect(formatConfirmNo("202610011026093081006865")).toBe("20261001-10260930-81006865");
  });
});

describe("작성일자·기타", () => {
  it("오늘보다 늦으면 거절", () => {
    expect(validateWriteDate("2026-10-09", "2026-10-08")).toMatch(/오늘/);
    expect(validateWriteDate("2026-10-08", "2026-10-08")).toBeNull();
    expect(validateWriteDate("", "2026-10-08")).toMatch(/입력/);
  });
  it("사업자번호 표기", () => {
    expect(formatBizNo("1234567890")).toBe("123-45-67890");
  });
  it("만료는 아직 발행 전인 요청에만", () => {
    const past = "2026-01-01T00:00:00Z";
    expect(isRequestExpired({ status: "sent", expires_at: past })).toBe(true);
    expect(isRequestExpired({ status: "issued", expires_at: past })).toBe(false);
  });
});

describe("비고·품목 — 화면과 엣지가 같은 규칙", () => {
  it("발주번호를 앞에 붙이고 150자로 자른다", () => {
    expect(requestRemark("PO-1", "10월분")).toBe("발주번호 PO-1 / 10월분");
    expect(requestRemark("", "메모")).toBe("메모");
    expect(requestRemark(null, null)).toBe("");
    const long = "가".repeat(200);
    expect(requestRemark("PO", long).length).toBe(150);
    for (const [po, memo] of [["PO-1", "10월분"], ["", "x"], [null, null], ["PO", long]] as const) {
      expect(requestRemarkText(po, memo)).toBe(requestRemark(po, memo));
    }
  });
  it("요청 품목 → 계산서 품목 (화면·엣지 동일)", () => {
    const items = [
      { name: "광고비", spec: "10월", qty: 2, unit_price: 50000, supply_amount: 100000, tax_amount: 10000 },
      { name: "", spec: "", qty: 1, unit_price: 1, supply_amount: 1, tax_amount: 0 },
    ];
    const a = requestItemsToTaxInvoiceItems(items);
    const b = requestItemsToInvoiceItems(items);
    expect(a).toEqual([{ name: "광고비", spec: "10월", qty: 2, unitCost: 50000, supplyAmount: 100000, remark: "" }]);
    expect(b).toEqual(a);
  });
});

describe("요청 → CODEF 발행 payload", () => {
  const request = {
    supplier_business_number: "2222222222",
    buyer_name: "구매사", buyer_business_number: "1234567890", buyer_representative: "김구매",
    buyer_address: "서울", buyer_business_type: "서비스", buyer_business_item: "소프트웨어", buyer_email: "buy@a.com",
    supply_amount: 105000, tax_amount: 10500, total_amount: 115500,
    tax_kind: "taxable", purpose: "청구", po_number: "PO-7", memo: "10월분", title: "광고 대행",
    items: [
      { name: "광고비", spec: "", qty: 1, unit_price: 100000, supply_amount: 100000, tax_amount: 10000 },
      { name: "수수료", spec: "", qty: 1, unit_price: 5000, supply_amount: 5000, tax_amount: 500 },
    ],
  };
  const profile = { corp_name: "공급사", ceo_name: "이공급", addr: "부산", biz_type: "도매", biz_class: "광고", tel: "0212345678", email: "s@b.com" };
  const p = buildIssuePayload(requestToIssueArgs(request, profile, "2026-10-05")) as Record<string, any>;

  it("공급자 = 요청에 적힌 사업자번호 + 공급자가 입력한 정보", () => {
    expect(p.corpNum).toBe("2222222222");
    expect(p.invoicerCorpNum).toBe("2222222222");
    expect(p.invoicerCorpName).toBe("공급사");
    expect(p.invoicerCEOName).toBe("이공급");
    expect(p.invoicerBizClass).toBe("광고");
    expect(p.invoicerEmail).toBe("s@b.com");
  });
  it("공급받는자 = 요청 회사", () => {
    expect(p.invoiceeCorpNum).toBe("1234567890");
    expect(p.invoiceeCorpName).toBe("구매사");
    expect(p.invoiceeType).toBe("사업자");
    expect(p.invoiceeEmail1).toBe("buy@a.com");
  });
  it("작성일·과세·영수/청구·합계·비고", () => {
    expect(p.writeDate).toBe("20261005");
    expect(p.issueType).toBe("정발행");
    expect(p.taxType).toBe("과세");
    expect(p.purposeType).toBe("청구");
    expect(p.sendToNtsYn).toBe("N");
    expect([p.supplyCostTotal, p.taxTotal, p.totalAmount]).toEqual(["105000", "10500", "115500"]);
    expect(p.remark1).toBe("발주번호 PO-7 / 10월분");
    expect(p.kwon).toBe("");
  });
  it("품목 줄 세액 합계 = 총세액", () => {
    expect(p.detailList).toHaveLength(2);
    const sum = p.detailList.reduce((s: number, l: any) => s + Number(l.tax), 0);
    expect(sum).toBe(10500);
    expect(p.detailList[0]).toMatchObject({ itemName: "광고비", supplyCost: "100000", purchaseDT: "20261005" });
  });
  it("면세는 면세·줄 세액 0", () => {
    const q = buildIssuePayload(requestToIssueArgs({ ...request, tax_kind: "exempt", tax_amount: 0, total_amount: 105000 }, profile, "2026-10-05")) as Record<string, any>;
    expect(q.taxType).toBe("면세");
    expect(q.detailList.every((l: any) => l.tax === "0")).toBe(true);
  });
});
