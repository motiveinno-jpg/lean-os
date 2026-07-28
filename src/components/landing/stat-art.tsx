"use client";

// 숫자 4개를 풀어 설명하는 카드의 일러스트 (2026-07-28).
//   ⚠️ 이건 "설명 그림"이지 앱 화면이 아니다. 브라우저 크롬·앱 셸을 씌워 실제 화면인 척하지 말 것.
//      (앞서 실제 화면 위에 가짜 UI 카드를 겹쳤다가 "실제 앱에 없는 레이아웃"이라고 반려된 적 있다.)
//   ⚠️ 여기 쓰는 메뉴명·계정과목·금액은 전부 제품과 요금제에 실재하는 값이다. 지어내지 말 것.
//      메뉴명: components/sidebar.tsx / 금액: content.ts PLANS·COMPETITORS

const MENUS = [
  "거래처", "세금·증빙", "거래 장부", "전표입력", "분석",
  "일정 / 할 일", "프로젝트", "결재 허브", "게시판", "메신저",
  "전자계약", "구성원", "근태 관리", "근로계약·서식", "파일보관함",
  "통장", "카드", "정기 지출",
];

const TX = [
  { d: "07-24", n: "(주)하늘건설 2차 기성금", a: "외상매출금", ai: true },
  { d: "07-23", n: "블루윙 스튜디오 외주비", a: "외주가공비", ai: true },
  { d: "07-22", n: "네이버 광고", a: "광고선전비", ai: true },
  { d: "07-22", n: "미확인 입금 ₩420,000", a: "확인 필요", ai: false },
];

const TOOLS = [
  { n: "전자결재", w: 46 },
  { n: "프로젝트 관리", w: 62 },
  { n: "전자계약", w: 38 },
  { n: "HR · 급여", w: 71 },
  { n: "팀 채팅", w: 33 },
  { n: "고객 DB", w: 44 },
  { n: "서류 보관", w: 29 },
];

const STEPS = [
  { n: "가입하기", d: "이메일로 1분" },
  { n: "계좌 연결", d: "은행·카드 선택" },
  { n: "바로 사용", d: "설치·교육 없이" },
];

const Check = () => (<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);

export function StatArt({ kind }: { kind: string }) {
  if (kind === "menus") {
    return (
      <div className="lp4-art lp4-art-menus" aria-hidden>
        <div className="lp4-art-chips">
          {MENUS.map((m, i) => (
            <span key={m} className={`lp4-art-chip ${i % 5 === 0 ? "lp4-art-chip-on" : ""}`}>{m}</span>
          ))}
        </div>
        <span className="lp4-art-fade" />
      </div>
    );
  }

  if (kind === "ai") {
    return (
      <div className="lp4-art lp4-art-ai" aria-hidden>
        {TX.map((t) => (
          <div key={t.n} className={`lp4-art-row ${t.ai ? "" : "lp4-art-row-warn"}`}>
            <span className="lp4-art-date">{t.d}</span>
            <span className="lp4-art-name">{t.n}</span>
            <span className={`lp4-art-tag ${t.ai ? "" : "lp4-art-tag-warn"}`}>{t.a}</span>
            {t.ai && <span className="lp4-art-aibadge">AI 분류</span>}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "save") {
    return (
      <div className="lp4-art lp4-art-save" aria-hidden>
        <div className="lp4-art-bars">
          {TOOLS.map((t) => (
            <div key={t.n} className="lp4-art-bar">
              <span className="lp4-art-bar-n">{t.n}</span>
              <span className="lp4-art-bar-track"><span className="lp4-art-bar-fill" style={{ width: `${t.w}%` }} /></span>
            </div>
          ))}
        </div>
        <div className="lp4-art-one">
          <span className="lp4-art-one-cap">오너뷰 하나로</span>
          <b className="lp4-art-one-v">₩79,500<i>/월</i></b>
          <span className="lp4-art-one-note">기본 5명 포함 · VAT 별도</span>
        </div>
      </div>
    );
  }

  return (
    <div className="lp4-art lp4-art-zero" aria-hidden>
      {STEPS.map((s, i) => (
        <div key={s.n} className="lp4-art-step">
          <span className="lp4-art-step-no"><Check /></span>
          <span className="lp4-art-step-t">
            <b>{s.n}</b>
            <i>{s.d}</i>
          </span>
          {i < STEPS.length - 1 && <span className="lp4-art-step-line" />}
        </div>
      ))}
      <div className="lp4-art-zero-tag">설치 파일 없음 · 초기 구축비 없음</div>
    </div>
  );
}
