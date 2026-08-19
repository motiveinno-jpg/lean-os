"use client";

// 리포트 표준 상자 머리에 페이지가 끼워 넣는 것 (2026-08-19 리포트 표준 2차).
//   상자·탭·설명 줄은 reports/layout 이 그리고, 각 리포트는 [조회 줄(기간·비교 ‖ 엑셀·인쇄)] 과
//   [결과 요약(핵심 지표)] 만 이 부품으로 넘긴다 → layout 의 #report-head-slot 에 포털로 들어간다.
//   페이지 본문(스크롤)과 머리(고정)가 갈라지므로 기간을 바꿔도 조회 줄은 제자리.

import { type ReactNode } from "react";
import { SlotHead } from "@/components/slot-head";

export function ReportHead(props: {
  /** 조회 줄 왼쪽 — 기간·비교 칩 */
  bar?: ReactNode;
  /** 조회 줄 오른쪽 — 실행(엑셀·인쇄·새로고침) */
  right?: ReactNode;
  /** 결과 요약 — 핵심 지표(Stat) */
  stats?: ReactNode;
  statsRight?: ReactNode;
}) {
  //   2026-08-19 공용 SlotHead 로 — 같은 슬롯 방식이 정기 지출·통장·카드에도 쓰인다
  return <SlotHead slotId="report-head-slot" {...props} />;
}
