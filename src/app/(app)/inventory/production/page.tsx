"use client";
import { InventorySoon } from "../_components/Empty";

export default function Page() {
  return (
    <InventorySoon
      title="생산"
      phase="4단계"
      what="안에서 만드는 길 — 자재를 쓰고 완제품이 됩니다. 거래처도 계산서도 없습니다."
      willDo={["자재구성(BOM) — 완제품 하나에 자재가 몇 개 드는지", "작업지시 — 완성하면 자재가 빠지고 완제품이 한 번에 늡니다", "자재가 모자라면 그 자리에서 발주로", "생산원가 — 투입한 자재 원가의 합"]}
      
    />
  );
}
