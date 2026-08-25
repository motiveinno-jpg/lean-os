"use client";
import { InventorySoon } from "../_components/Empty";

export default function Page() {
  return (
    <InventorySoon
      title="판매"
      phase="2단계"
      what="나가는 길 — 주문을 받고, 출고하면 재고가 줄고, 매출계산서 발행을 권합니다."
      willDo={["주문 등록 — 품목 줄로. 받는 순간 판매가능수량이 줄어듭니다(예약)", "출고 — 주문에서 넘기거나, 주문 없이 '바로 출고'로도 됩니다", "반품 — 지우지 않고 음수 줄로 남기고 수정세금계산서를 권합니다", "기존 견적 문서에 품목을 골라 넣는 길"]}
      nowDo={{ label: "재고 › 재고에서 '출고'로 기록", href: "/inventory/stock" }}
    />
  );
}
