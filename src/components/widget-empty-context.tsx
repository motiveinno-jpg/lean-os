"use client";

// 위젯 → 격자 "나 비었어요" 신호 (2026-09-03 대시보드 v2 결정 149·157)
//   격자는 위젯 안 데이터를 모르므로, 위젯이 빈 상태를 그릴 때 이 컨텍스트로 알린다.
//   격자는 빈 위젯을 한 줄(h:1) 로 접어 맨 아래로 내린다 — 첫 화면에서 빈 상자 3개가 223px 씩 차지하던 것의 해결.
//   컨텍스트가 없는 곳(마이페이지 등)에서 쓰이면 아무 일도 안 한다.

import { createContext, useContext, useEffect } from "react";

export const WidgetEmptyContext = createContext<{ id: string; report: (id: string, empty: boolean) => void } | null>(null);

/** 위젯 루트에서 호출 — empty 가 바뀔 때마다 격자에 알린다 */
export function useReportWidgetEmpty(empty: boolean) {
  const ctx = useContext(WidgetEmptyContext);
  const id = ctx?.id; const report = ctx?.report;
  //   의존성은 id·report(격자의 useCallback, 안정)·empty 만 — Provider value 객체는 렌더마다 새로 만들어지므로
  //   ctx 자체를 걸면 "report → setState → 렌더 → 새 ctx → effect" 무한 루프 (2026-09-03 실측 Maximum update depth).
  useEffect(() => {
    if (!id || !report) return;
    report(id, empty);
    return () => report(id, false);
  }, [id, report, empty]);
}
