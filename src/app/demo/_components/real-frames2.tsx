"use client";
import { Ico } from "@/components/ui-icon";

// /demo — 실화면 대조 후 재작성한 패널 2차 (2026-07-28).
//   ⚠️ 프로덕션 실계정으로 각 라우트를 직접 열어 상단 탭·필터·요약 카드·표 컬럼을 그대로 옮겼다.
//      값(거래처명·금액·직원명)만 데모용 가상 데이터다 — 실계정 값은 공개하면 안 된다.
//   ⚠️ 실화면이 바뀌면 여기도 같이 고칠 것. 근거 라우트는 각 컴포넌트 주석 참고.
//   ⚠️ before 프롭은 랜딩 "처리 전 → 처리 후" 크로스페이드용. 값이 없는 자리는 "—" 로 둔다.

function Head({ crumb, title, sub, tabs, active = 0 }: { crumb: string; title: string; sub: string; tabs: string[]; active?: number }) {
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-l">
          <div className="pp-menu">{crumb}</div>
          <div className="pp-title">{title}</div>
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="pp-subtabs">
          {tabs.map((t, i) => (
            <span key={t} className={`pp-subtab ${i === active ? "pp-subtab-on" : ""}`}>{t}</span>
          ))}
        </div>
      )}
      <div className="pp-sub pp-mt">{sub}</div>
    </>
  );
}

const D = "—";

// ── 워크스페이스 › 프로젝트 (/projecthub) ─────────────────────
//   실제: 내 담당|전체 · 정렬 · +프로젝트 생성 / 유형 필터(전체·수익형·목표형·실행형)
//         "지금 챙길 것" 4카드(위험·지연 / 이번 주 마감 / 진행중 / 내 미수금) / 회사 전체 미수금 / 목록
export function ProjectHubPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const rows = [
    { t: "수익형", st: "진행", n: "하늘건설 사옥 리뉴얼", c: "(주)하늘건설" },
    { t: "목표형", st: "진행", n: "26년 상반기 매출 목표", c: "사내" },
    { t: "✅ 실행형", st: "검토", n: "오너뷰 개발 프로젝트", c: "사내" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-hub-b" : "pp-hub"}>
      <Head
        crumb="워크스페이스 › 프로젝트"
        title="지금 챙길 것부터 보여줘요"
        sub="수익형·목표형·실행형으로 나눠 관리하고, 위험한 건은 위로 올려요."
        tabs={["내 담당", "전체"]}
      />
      <div className="pp-filter pp-mt">
        <span className="pp-chip-on">전체 {v("3")}</span>
        <span className="pp-chip-off"><Ico e="💰" /> 수익형 {v("1")}</span>
        <span className="pp-chip-off"><Ico e="🎯" /> 목표형 {v("1")}</span>
        <span className="pp-chip-off"><Ico e="✅" /> 실행형 {v("1")}</span>
        <span className="pp-btn pp-btn-ai">+ 프로젝트 생성</span>
      </div>

      <div className="pp-section-t">지금 챙길 것 <i className="pp-dim">누르면 아래 목록이 그 조건만 보여줘요</i></div>
      <div className="pp-grid4">
        <div className="pp-mini"><span>위험 · 지연</span><b>{v("1")}</b><i>기한 초과·마진 적자·태스크 지연</i></div>
        <div className="pp-mini"><span>이번 주 마감</span><b>{v("2")}</b><i>7일 내 마감 예정</i></div>
        <div className="pp-mini"><span>진행중</span><b>{v("3")}</b><i>완료·정산 전 진행 중</i></div>
        <div className="pp-mini"><span>내 미수금</span><b>{v("₩12,000,000")}</b><i>발행했지만 미입금 · 1건</i></div>
      </div>

      <div className="pp-notice">
        <span><Ico e="💸" /> <b>회사 전체 미수금</b> — 계산서는 발행했지만 아직 통장에 입금 안 된 금액 (매칭 기준)</span>
        <b>{v("₩44,002,200")}</b>
      </div>

      <table className="pp-table">
        <thead><tr><th>유형</th><th>프로젝트명</th><th>거래처</th><th>단계</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td><span className="pp-tag pp-tag-n">{r.t}</span></td>
              <td className="pp-strong">{r.n}</td>
              <td>{r.c}</td>
              <td>{before ? <span className="pp-tag pp-tag-n">불러오는 중</span> : <span className="pp-tag pp-tag-s">{r.st}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 워크스페이스 › 결재 허브 (/approvals) ─────────────────────
//   실제 탭: 내 결재함 | 내 요청 | 참조 | 새 요청 | 전체 현황 | 양식 관리 | 정책 관리
//           그 아래 대기중 | 내가 결재한 건
export function ApprovalsRealPanel({ before = false }: { before?: boolean }) {
  const rows = [
    { t: "외주 디자인비 지급", ty: "지출결의", by: "박서연", line: "팀장 → 대표", amt: "₩3,500,000" },
    { t: "7월 연차 사용 (2일)", ty: "휴가", by: "이준호", line: "팀장 → 대표", amt: D },
    { t: "출장 경비 정산", ty: "경비", by: "최민아", line: "팀장 → 대표", amt: "₩412,000" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-appr-b" : "pp-appr"}>
      <Head
        crumb="워크스페이스 › 결재 허브"
        title="요청이 한 결재함에 모여요"
        sub="경비·지출·휴가·구매 요청을 한곳에서 승인해요."
        tabs={["내 결재함", "내 요청", "참조", "새 요청", "전체 현황", "양식 관리", "정책 관리"]}
      />
      <div className="pp-inner-tabs pp-mt">
        <span className="pp-inner-tab pp-inner-tab-on">대기중 ({before ? "…" : "3"})</span>
        <span className="pp-inner-tab">내가 결재한 건</span>
      </div>
      <table className="pp-table">
        <thead><tr><th>제목</th><th>유형</th><th>요청자</th><th>결재선</th><th>금액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td className="pp-strong">{r.t}</td>
              <td>{r.ty}</td>
              <td>{before ? D : r.by}</td>
              <td>{before ? "결재선 지정 중" : r.line}</td>
              <td className="pp-num">{before ? D : r.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">₩100만 미만 경비는 자동승인 규칙이 켜져 있어요. 이번 달 {before ? D : "12건"}이 자동 처리됐어요.</div>
    </section>
  );
}

// ── 워크스페이스 › 전자계약 (/signatures) ─────────────────────
//   실제: 계약 요청 | 양식 관리 · +단체 일괄 발송 · +새 계약 요청
//         상태 카운터 바(전체·대기·발송·열람·서명완료·거부·만료) + 묶음 목록
export function SignRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const rows = [
    { n: "하늘건설 사옥 리뉴얼 계약서", who: "김상무", mail: "sangmu@skyc.co.kr", req: "2026-07-24", exp: "2026-08-07", st: "서명완료", tag: "s" },
    { n: "정우 엔지니어링 컨설팅 계약서", who: "이부장", mail: "lee@jw-eng.kr", req: "2026-07-23", exp: "2026-08-06", st: "발송", tag: "n" },
    { n: "블루윙 외주 용역계약서", who: "박대표", mail: "park@bluewing.kr", req: "2026-07-19", exp: "2026-08-02", st: "서명완료", tag: "s" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-sign-b" : "pp-sign"}>
      <Head
        crumb="워크스페이스 › 전자계약"
        title="계약서를 보내고 서명을 받아 보관까지"
        sub="직인은 자동으로 찍히고, 서명이 끝나면 잠겨서 보관함에 들어가요."
        tabs={["계약 요청", "양식 관리"]}
      />
      <div className="pp-statbar pp-mt">
        <span><i>전체</i><b>{v("747")}</b></span>
        <span><i>대기</i><b>{v("0")}</b></span>
        <span><i>발송</i><b>{v("178")}</b></span>
        <span><i>열람</i><b>{v("37")}</b></span>
        <span><i>서명완료</i><b>{v("485")}</b></span>
        <span><i>만료</i><b>{v("47")}</b></span>
      </div>
      <table className="pp-table">
        <thead><tr><th>계약서</th><th>수신자</th><th>요청일</th><th>만료일</th><th>상태</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td>{before ? D : `${r.who} · ${r.mail}`}</td>
              <td>{before ? D : r.req}</td>
              <td>{before ? D : r.exp}</td>
              <td><span className={`pp-tag ${before ? "pp-tag-n" : `pp-tag-${r.tag}`}`}>{before ? "발송 대기" : r.st}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 인사관리 › 구성원 (/employees) ────────────────────────────
//   실제 탭: 인력관리 N | 급여 | 증명서 발급
//   KPI: 재직 인원 / 연 인건비 / 퇴직충당금 / 미결 경비
//   디렉토리: 팀 필터 + 재직|전체|퇴사 + 카드|리스트, 구성원 카드(이름·재직·직급·팀·입사·근속)
export function EmployeesRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const rows = [
    { n: "김대표", r: "대표", t: "경영", j: "2023-01-02", y: "3년 6개월", s: "재직" },
    { n: "박서연", r: "팀장", t: "디자인팀", j: "2024-03-11", y: "2년 4개월", s: "재직" },
    { n: "이준호", r: "선임", t: "개발팀", j: "2024-07-01", y: "2년 0개월", s: "재직" },
    { n: "정우성", r: "주임", t: "개발팀", j: "2025-11-03", y: "8개월", s: "수습" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-emp-b" : "pp-emp"}>
      <Head
        crumb="인사관리 › 구성원"
        title="입사부터 급여까지 한곳에"
        sub="부서·직급·입사일이 정리되고, 급여는 4대보험·원천세까지 자동으로 계산돼요."
        tabs={["인력관리 12", "급여", "증명서 발급"]}
      />
      <div className="pp-grid4 pp-mt">
        <div className="pp-mini"><span>재직 인원</span><b>{v("12명")}</b></div>
        <div className="pp-mini"><span>연 인건비</span><b>{v("₩210,000,000")}</b><i>월 ₩17,500,000</i></div>
        <div className="pp-mini"><span>퇴직충당금</span><b>{v("₩38,400,000")}</b></div>
        <div className="pp-mini"><span>미결 경비</span><b>{v("0건")}</b></div>
      </div>
      <div className="pp-filter">
        <span className="pp-chip-on">팀 전체</span>
        <span className="pp-chip-off">디자인팀</span>
        <span className="pp-chip-off">개발팀</span>
        <span className="pp-chip-off">경영지원팀</span>
        <span className="pp-btn pp-btn-ai"><Ico e="⚙" /> 관리 · 추가/수정</span>
      </div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>직급 · 팀</th><th>입사일</th><th>근속</th><th>상태</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td>{r.r} · {r.t}</td>
              <td>{r.j}</td>
              <td>{before ? D : r.y}</td>
              <td><span className={`pp-tag ${r.s === "수습" ? "pp-tag-w" : "pp-tag-s"}`}>{r.s}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 인사관리 › 근태 관리 (/attendance) ────────────────────────
//   실제: 주간 그리드 — 구성원 | 월27 … 일2 | 주간 합계 / 52h
export function AttendanceRealPanel({ before = false }: { before?: boolean }) {
  const days = ["월 27", "화 28", "수 29", "목 30", "금 31", "토 1", "일 2"];
  const rows = [
    { n: "박서연", h: ["8h", "8h", "8h", "8h", "8h", "-", "-"], sum: "40h" },
    { n: "이준호", h: ["8h", "9h", "8h", "8h", "9h", "-", "-"], sum: "42h" },
    { n: "최민아", h: ["8h", "8h", "연차", "8h", "8h", "-", "-"], sum: "32h" },
    { n: "정우성", h: ["8h", "8h", "8h", "8h", "8h", "4h", "-"], sum: "44h" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-att-b" : "pp-att"}>
      <Head
        crumb="인사관리 › 근태 관리"
        title="출퇴근·연차·연장근무가 자동으로 모여요"
        sub="주 단위로 집계되고, 52시간을 넘으면 바로 표시돼요."
        tabs={["근무 현황", "연장근무", "기록 상세"]}
      />
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini pp-mini-ok"><span>정상 출근율</span><b>{before ? D : "96.4%"}</b></div>
        <div className="pp-mini"><span>사용 연차</span><b>{before ? D : "18일"}</b></div>
        <div className="pp-mini"><span>연장근무</span><b>{before ? D : "42h"}</b></div>
      </div>
      <table className="pp-table">
        <thead>
          <tr><th>구성원</th>{days.map((d) => <th key={d}>{d}</th>)}<th>주간 합계 / 52h</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              {r.h.map((h, i) => <td key={i}>{before ? D : h}</td>)}
              <td className="pp-num">{before ? D : r.sum}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 자산관리 › 통장 (/bank) ───────────────────────────────────
//   실제: 총 자산 / N개 계좌 / 이번 달 수익 카드 + 계좌별 섹션 목록
export function BankRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const accts = [
    { n: "운영계좌", b: "국민은행", no: "•••• 4821", amt: "₩148,200,000", chg: "+₩9,200,000", up: true },
    { n: "기업자유예금", b: "기업은행", no: "•••• 0317", amt: "₩62,400,000", chg: "+₩3,800,000", up: true },
    { n: "보조금 전용", b: "농협은행", no: "•••• 2210", amt: "₩19,800,000", chg: "변화 없음", up: false },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-bankr-b" : "pp-bankr"}>
      {/* ⚠️ 2026-07-30: 실제 /bank 과 어긋나 있었다(사장님: 둘러보기 통장 이미지가 예전 화면).
          실제는 탭 3개(개요·통장·거래내역) + KPI 4장(총 자산·이번 달 수익·이번 달 지출·분류 완료율)
          + 통장 "카드" 그리드(이름·잔액·증감칩)다. 표가 아니라 카드다. 그 구조로 맞춘다. */}
      <Head
        crumb="자산관리 › 통장"
        title="계좌를 연결하면 알아서 들어와요"
        sub="잔액과 거래내역이 하루 2회 자동으로 동기화돼요."
        tabs={["개요", "통장", "거래내역"]}
        active={1}
      />
      <div className="pp-grid4 pp-mt">
        <div className="pp-mini"><span>총 자산</span><b>{v("₩230,400,000")}</b><i>{before ? "" : "3개 계좌"}</i></div>
        <div className="pp-mini pp-mini-ok"><span>이번 달 수익</span><b>{v("+₩13,000,000")}</b></div>
        <div className="pp-mini"><span>이번 달 지출</span><b>{v("-₩8,420,000")}</b></div>
        <div className="pp-mini"><span>분류 완료율</span><b>{before ? D : "98%"}</b><i>{before ? "" : "412/420건"}</i></div>
      </div>
      <div className="pp-section-t">통장</div>
      <div className="pp-acctgrid">
        {accts.map((a) => (
          <div key={a.n} className="pp-acct">
            <div className="pp-acct-h"><b>{a.n}</b><span>{a.b} {a.no}</span></div>
            <div className="pp-acct-amt">{v(a.amt)}</div>
            <span className={`pp-acct-chip ${a.up ? "pp-acct-chip-up" : "pp-acct-chip-flat"}`}>{before ? "—" : a.chg}</span>
            <div className="pp-acct-hint">클릭 → 이 통장 거래내역</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 자산관리 › 카드 (/cards) ──────────────────────────────────
//   실제 탭: 카드 | 거래내역 | 분석 | 카드 연동 · 기간 필터 · 선택 카드 요약 · 내 카드 목록
export function CardsRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const cards = [
    { n: "대표님 사용카드", k: "신용", no: "•••• 2120", co: "롯데" },
    { n: "마케팅 체크카드", k: "체크", no: "•••• 5979", co: "BC" },
    { n: "해외광고비 충전카드", k: "신용", no: "•••• 6241", co: "롯데" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-cardr-b" : "pp-cardr"}>
      <Head
        crumb="자산관리 › 카드"
        title="법인카드 승인 내역이 자동으로 모여요"
        sub="누가 어디에 썼는지, 어떤 계정과목인지까지 같이 정리돼요."
        tabs={["카드", "거래내역", "분석", "카드 연동"]}
      />
      <div className="pp-grid3 pp-mt">
        <div className="pp-mini"><span>이번 달 사용</span><b>{v("₩11,600,000")}</b><i>{before ? "" : "· 68건"}</i></div>
        <div className="pp-mini"><span>등록 카드</span><b>{v("3장")}</b></div>
        <div className="pp-mini"><span>미분류</span><b>{before ? D : "0건"}</b></div>
      </div>
      <div className="pp-section-t">내 카드</div>
      <table className="pp-table">
        <thead><tr><th>카드명</th><th>종류</th><th>번호</th><th>발급사</th><th>이번 달</th></tr></thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.no}>
              <td className="pp-strong">{c.n}</td>
              <td><span className="pp-tag pp-tag-n">{c.k}</span></td>
              <td>{c.no}</td>
              <td>{c.co}</td>
              <td className="pp-num">{v("₩3,800,000")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 자산관리 › 정기 지출 (/payments) ──────────────────────────
//   실제 탭: 자동 추천 | 정기결제 | 구독 | 고정비 | 결제 내역
//   자동화 진행 현황: 반복설정 → 승인대기 → 결제대기 → 완료
export function PaymentsRealPanel({ before = false }: { before?: boolean }) {
  const v = (x: string) => (before ? D : x);
  const rows = [
    { c: "3회", n: "사무실 임차료", k: "고정비", amt: "₩1,800,000" },
    { c: "4회", n: "AWS 클라우드", k: "구독", amt: "₩1,240,000" },
    { c: "3회", n: "협업툴 구독", k: "구독", amt: "₩96,000" },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-payr-b" : "pp-payr"}>
      <Head
        crumb="자산관리 › 정기 지출"
        title="매달 나가는 돈을 놓치지 않아요"
        sub="이체내역에서 반복 결제를 찾아 등록을 추천하고, 결제일 전에 알려줘요."
        tabs={["자동 추천", "정기결제", "구독", "고정비", "결제 내역"]}
      />
      <div className="pp-section-t">자동화 진행 현황 <i className="pp-dim">설정 → 지출결의 → 승인 → 결제 → 세금계산서</i></div>
      <div className="pp-grid4">
        <div className="pp-mini"><span>반복설정</span><b>{v("14")}</b></div>
        <div className="pp-mini"><span>승인대기</span><b>{v("10")}</b></div>
        <div className="pp-mini"><span>결제대기</span><b>{v("6")}</b></div>
        <div className="pp-mini pp-mini-ok"><span>완료</span><b>{v("5")}</b></div>
      </div>
      <div className="pp-notice">
        <span>이체내역에서 {before ? "분석 중…" : "23건 신규 감지"} · 건별로 등록 여부를 선택하세요</span>
        <span className="pp-btn">전체 등록</span>
      </div>
      <table className="pp-table">
        <thead><tr><th>감지 횟수</th><th>상호</th><th>분류</th><th>금액</th><th>등록</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td>{before ? D : r.c}</td>
              <td className="pp-strong">{r.n}</td>
              <td><span className="pp-tag pp-tag-n">{r.k}</span></td>
              <td className="pp-num">{v(r.amt)}</td>
              <td><span className={`pp-tag ${before ? "pp-tag-w" : "pp-tag-s"}`}>{before ? "미등록" : "등록"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 홈 › AI 참모 (/copilot) ───────────────────────────────────
//   실제: ✦ AI 참모 / 부제 / AI 연결됨 · 기준 시각 · 대화 초기화
//         → 질문 → AI 분석 결과(모델·시각) → 한 줄 결론 → 본문 → "지금 해야 할 일" 액션(우선순위·바로가기)
export function CopilotRealPanel({ before = false }: { before?: boolean }) {
  const acts = [
    { p: "높음", t: "미수금 거래처별 연체 현황 즉시 확인", d: "연체 기간이 가장 긴 건부터 정렬하고, 60일 이상 거래처를 1순위로 분류하세요." },
    { p: "높음", t: "고액·장기 연체 거래처에 회수 연락", d: "기록이 남는 수단으로 납부 일정을 확약받고 약속일을 캘린더에 등록하세요." },
    { p: "보통", t: "결제 대기 6건 처리해 입금 가속화", d: "미수금 회수와 연계된 입금 처리 건을 우선 처리하세요." },
  ];
  return (
    <section className="pp glass-card" id={before ? "pp-cop-b" : "pp-cop"}>
      <Head
        crumb="홈 › AI 참모"
        title="✦ 회사 데이터를 읽고, 지금 해야 할 일을 정리합니다"
        sub={before ? "AI 연결됨 · 회사 데이터를 읽는 중" : "AI 연결됨 · 기준 7월 28일 오후 02:03"}
        tabs={[]}
      />
      <div className="pp-inner-tabs pp-mt">
        <span className="pp-inner-tab pp-inner-tab-on">미수금 회수 우선순위를 알려줘</span>
        <span className="pp-inner-tab">이번 달 매출 흐름을 봐줘</span>
      </div>
      <div className="pp-sub-card">
        <div className="pp-sub-t"><Ico e="✦" /> AI 분석 결과 <i className="pp-dim">Sonnet · 7월 28일 오후 02:03</i></div>
        <div className="pp-state-line">
          {before ? "분석 중이에요…" : "미수금 4,400만원 — 지금 회수 우선순위를 정해 행동하세요"}
        </div>
        <div className="pp-sub">
          {before
            ? "통장·세금계산서·프로젝트 데이터를 함께 읽고 있어요."
            : "세금계산서 기준 미수금이 현금 잔액 대비 높은 편이에요. 회수가 지연될수록 운영 자금 압박이 커질 수 있어요."}
        </div>
      </div>
      <div className="pp-section-t">지금 해야 할 일</div>
      <div className="pp-payroll">
        {acts.map((a) => (
          <div key={a.t} className="pp-pay-row">
            <span>
              <span className={`pp-tag ${a.p === "높음" ? "pp-tag-w" : "pp-tag-n"}`}>{a.p}</span>{" "}
              {before ? D : a.t}
            </span>
            <b className="pp-dim">{before ? "" : "바로가기 →"}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
