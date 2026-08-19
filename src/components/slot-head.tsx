"use client";

// 상자 머리 슬롯 — 갈래(탭)를 그리는 껍데기와, 갈래마다 다른 [조회 줄 ‖ 실행] · [결과 요약] 을 가르는 부품 (2026-08-19).
//   껍데기가 `<div id={slotId} />` 를 QueryHead 안에 두고, 갈래 본문은 <SlotHead slotId=…> 로 조회 줄·결과 요약을 거기 포털로 넣는다.
//   분석 리포트(ReportHead)가 먼저 쓰던 방식을 정기 지출·통장·카드처럼 탭이 여럿인 화면에도 쓰려고 뺐다.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { QueryBar, ResultStrip } from "@/components/query-kit";

export function SlotHead({ slotId, bar, right, stats, statsRight, below }: {
  slotId: string;
  /** 조회 줄 왼쪽 — 기간·검색조건·빠른검색·보기 칩 */
  bar?: ReactNode;
  /** 조회 줄 오른쪽 — 실행(엑셀·인쇄·추가) */
  right?: ReactNode;
  /** 결과 요약 — 핵심 지표(Stat) */
  stats?: ReactNode;
  statsRight?: ReactNode;
  /** 결과 요약 아래 한 줄(걸린 조건 칩·안내) */
  below?: ReactNode;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById(slotId)); }, [slotId]);
  if (!el) return null;
  return createPortal(
    <>
      {(bar || right) && <QueryBar right={right}>{bar}</QueryBar>}
      {stats && <ResultStrip right={statsRight}>{stats}</ResultStrip>}
      {below}
    </>,
    el,
  );
}
