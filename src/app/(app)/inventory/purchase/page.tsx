"use client";
import { InventorySoon } from "../_components/Empty";

export default function Page() {
  return (
    <InventorySoon
      title="구매"
      phase="3단계"
      what="밖에서 사 오는 길 — 발주하고, 입고하면 재고가 늘고, 매입 전표를 제안합니다."
      willDo={["발주 등록·보내기 — 부족 품목에서 바로 만들 수 있습니다", "입고 — 부분입고까지. 발주 없이 '바로 입고'로도 됩니다", "입고하면 매입 전표를 제안합니다 (확정은 사람이)"]}
      nowDo={{ label: "재고 › 재고에서 '입고'로 기록", href: "/inventory/stock" }}
    />
  );
}
