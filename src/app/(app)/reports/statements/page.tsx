// 회계 자료 — 첫 화면은 첫 갈래(손익계산서)로 바로 간다 (2026-10-01 UI 점검 5순위).
//   History: 허브가 카드 7장(손익계산서·재무상태표·원장·현금흐름표·비용 분석·인원별 급여·3-Way 매칭)을 보여 줬는데,
//   같은 7개가 머리의 파란 밑줄 탭(ReportsTabs subs)에도 있어 두 번 고르게 했고 허브에선 켜진 탭이 없었다.
//   사이드바 「회계 자료」의 match 는 7개 주소를 다 포함하므로 넘어가도 켜짐이 유지된다. 외부 파트너 차단은 손익계산서 화면이 한다.
import { redirect } from "next/navigation";

export default function StatementsHub() {
  redirect("/reports/pnl");
}
