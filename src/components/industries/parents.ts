// 업종군 7 (2026-09-16 2차) — 세부 업종 23개가 이 아래에 붙는다.
import type { Parent } from "./model";

export const PARENTS: Parent[] = [
  { key: "manufacturing", name: "제조 · 생산", accent: "teal", shot: "/product/f-inv-status-v1.png",
    lead: "자재와 완제품을 나눠 세고, 작업지시 한 번으로 재고·원가·이익까지 이어 둡니다." },
  { key: "wholesale", name: "유통 · 판매", accent: "indigo", shot: "/product/f-inv-stock-v4.png",
    lead: "여러 창고 재고와 거래처 단가를 한 화면에서 보고, 받을 돈까지 이어 관리합니다." },
  { key: "ecommerce", name: "온라인 판매", accent: "blue", shot: "/product/f-inv-channels-v2.png",
    lead: "채널 주문을 한곳에 모아 출고·재고·전표·정산까지 한 줄로 처리합니다." },
  { key: "agency", name: "용역 · 프로젝트", accent: "violet", shot: "/product/f-projects-v6.png",
    lead: "견적·계약·진행·회차 청구를 프로젝트 하나에 담고 건별로 남는 돈을 봅니다." },
  { key: "construction", name: "건설 · 시공", accent: "amber", shot: "/product/f-contract-v5.png",
    lead: "현장마다 계약·자재·외주·인건비를 달아 두고 공정 중에 원가율을 확인합니다." },
  { key: "logistics", name: "물류 · 창고", accent: "slate", shot: "/product/f-inv-orders-v2.png",
    lead: "입고·이동·출고를 이력으로 남기고 납기 지난 주문을 먼저 띄웁니다." },
  { key: "professional", name: "전문 서비스", accent: "rose", shot: "/product/f-dashboard-v5.png",
    lead: "근태가 급여로, 계약이 청구로 이어지고 대표가 볼 숫자는 매일 갱신됩니다." },
];

export const PARENT_BY_KEY = new Map(PARENTS.map((p) => [p.key, p]));
