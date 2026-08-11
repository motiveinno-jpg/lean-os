// 세무사 파트너 포털 — 독립 레이아웃 (앱 셸·사이드바 미사용, 2026-08-11)
export default function AdvisorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        THESIS: 세무사가 고객사의 돈 기록을 "펼쳐 보는" 열람 포털 — 대시보드 위젯 나열이라는
          카테고리 기본형을 거부하고, 통장을 펼친 경험(표지 → 인쇄 지면)으로 구성한다.
        OWN-WORLD: 통장(passbook) 인쇄 세계 — 네이비 잉크 표지(#17233f→#0f1830)와 금박 라벨,
          따뜻한 종이 지면(#f7f5f0) 위 괘선·줄무늬 인쇄 표, 입금 초록 잉크·출금 적색 잉크,
          tabular 숫자. 콘텐츠를 다 지워도 "통장"으로 알아볼 수 있는 문법.
        STORY: 세무사는 로그인하면 담당 고객사가 통장 표지 카드로 꽂혀 있고, 하나를 펼치면
          계좌·매출입·부가세·인건비가 인쇄된 지면으로 나온다 — 자료 요청 없이 바로 기장/신고.
        FIRST VIEWPORT: 좌 네이비 표지(브랜드·가치 3줄) / 우 종이 인증 카드. 로그인 후에는
          네이비 톱바 + 고객사 카드 그리드. 주 행동 = 고객사 카드 클릭.
        FORM: 통장 인쇄 세계 — 공명 순위 4위 (concept-seed key 00956257, assigned index 4).
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
          review, the verdict, and DESIGN.md
      */}
      <div className="adv-root">{children}</div>
    </>
  );
}
