// 리포트(분석) 공용 레이아웃 — 리포트 표준 상자 (2026-08-19 사장님: "분석 메뉴들에도 UI 개선").
//   qk-shell > qk-screen: 머리 = ReportsTabs(하위 갈래 파란 밑줄 + 설명 줄), 본문 = 상자 안 스크롤(report-body).
//   각 페이지는 내용(요약·지표·섹션)만 그린다 — 예전엔 페이지마다 <ReportsTabs/> 를 그렸다(중복 제거).
//   상자 끝선 = 사이드바, 갈래 탭은 상자 안, 카드 껍데기는 CSS(.report-body …)가 얇은 판/선으로 눕힌다.

import { ReportsTabs } from "./_components/ReportsTabs";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="qk-shell report-shell">
      <div className="qk-screen">
        <ReportsTabs />
        <div className="qk-body">
          <div className="report-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
