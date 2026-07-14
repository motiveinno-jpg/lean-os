// 리포트(분석) 공용 레이아웃 — 확정된 리포트형 디자인 셸을 전 리포트 화면에 일괄 적용(2026-07-14).
//   ReportShell(풀폭 리포트 컨테이너)로 감싸 모든 /reports/* 페이지가 동일한 셸을 공유한다.
//   상단 탭·헤더는 각 페이지가 <ReportsTabs/> 로 렌더(중복 방지).

import { ReportShell } from "@/components/report-kit";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <ReportShell>{children}</ReportShell>;
}
