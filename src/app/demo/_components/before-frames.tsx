"use client";

// /demo — "처리 전" 상태 화면 (2026-07-28).
//   랜딩 주요 기능에서 각 탭이 "처리 전 → 처리 후" 로 이어지게 하려면 같은 화면의 앞 상태가 필요하다.
//   ⚠️ 지어낸 화면이 아니다. 전부 실제 앱에서 존재하는 이전 단계다:
//        · 집계·계산이 돌기 전(값이 아직 없음)
//        · AI 분류·국세청 수집이 끝나기 전(미분류·수집 중)
//        · 전자서명 회수 전(계약서 보관 0건)
//   ⚠️ "후" 화면과 골격(컬럼·카드 구성)이 반드시 같아야 크로스페이드가 자연스럽다.
//      후 화면을 고치면 여기도 같이 고칠 것. 후 화면은 pillar-frames / pillar-panels / menu-panels.

function PanelHead({ menu, title, sub, right }: { menu: string; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="pp-head">
      <div className="pp-head-l">
        <div className="pp-menu">{menu}</div>
        <div className="pp-title">{title}</div>
        <div className="pp-sub">{sub}</div>
      </div>
      {right}
    </div>
  );
}

const DASH = "—";

// ── 프로젝트 파이프라인 — 집계 전 ─────────────────────────────
export function ProjectsBeforePanel() {
  const rows = ["하늘건설 사옥 리뉴얼", "정우 엔지니어링 컨설팅", "메이커스랩 앱 개발", "블루윙 브랜딩", "한빛 소재 유지보수"];
  return (
    <section className="pp glass-card" id="pp-projects-b">
      <PanelHead
        menu="워크스페이스 › 프로젝트"
        title="지금 어디까지 왔는지 한눈에"
        sub="단계·금액·진행률이 한 화면에. 마진이 무너진 건은 따로 표시해요"
        right={<span className="pp-badge pp-badge-p">집계 중</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>수주 잔액</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>이번 달 매출</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>주의 필요</span><b>{DASH}</b></div>
      </div>
      <div className="pp-section-t">진행 중인 프로젝트</div>
      <table className="pp-table">
        <thead><tr><th>프로젝트</th><th>단계</th><th>진행률</th><th>수익성</th><th>계약금액</th></tr></thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n}>
              <td className="pp-strong">{n}</td>
              <td><span className="pp-tag pp-tag-n">불러오는 중</span></td>
              <td><span className="pp-bar" style={{ marginTop: 0, width: 72, display: "inline-block", verticalAlign: "middle" }} /> {DASH}</td>
              <td>{DASH}</td>
              <td className="pp-num">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">진행률과 수익성을 집계하고 있어요.</div>
    </section>
  );
}

// ── 급여 — 배치 계산 전 ───────────────────────────────────────
const MEMBERS_B = [
  { n: "김대표", d: "경영", r: "대표", j: "2023-01-02", s: "재직" },
  { n: "박서연", d: "디자인", r: "팀장", j: "2024-03-11", s: "재직" },
  { n: "이준호", d: "개발", r: "선임", j: "2024-07-01", s: "재직" },
  { n: "최민아", d: "경영지원", r: "매니저", j: "2025-02-17", s: "재직" },
  { n: "정우성", d: "개발", r: "주임", j: "2025-11-03", s: "수습" },
];

export function HrBeforePanel() {
  return (
    <section className="pp glass-card" id="pp-hr-b">
      <PanelHead
        menu="인사관리 › 구성원 · 근태 · 급여"
        title="입사부터 급여까지 한 흐름"
        sub="4대보험·원천세는 자동으로 계산되고, 승인만 하면 돼요"
        right={<span className="pp-badge pp-badge-p">계산 전</span>}
      />
      <div className="pp-grid2">
        <div className="pp-sub-card">
          <div className="pp-sub-t">이번 달 근태 요약</div>
          <div className="pp-stats">
            <div className="pp-stat"><b>{DASH}</b><span>정상 출근율</span></div>
            <div className="pp-stat"><b>{DASH}</b><span>지각</span></div>
            <div className="pp-stat"><b>{DASH}</b><span>사용 연차</span></div>
            <div className="pp-stat"><b>{DASH}</b><span>연장근무</span></div>
          </div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">7월 급여 배치</div>
          <div className="pp-payroll">
            <div className="pp-pay-row"><span>지급 총액</span><b>{DASH}</b></div>
            <div className="pp-pay-row"><span>4대보험 (회사부담)</span><b>{DASH}</b></div>
            <div className="pp-pay-row"><span>원천징수</span><b>{DASH}</b></div>
          </div>
          <div className="pp-pay-cta"><span className="pp-chip-ok">요율 적용 중</span><span className="pp-btn">배치 생성</span></div>
        </div>
      </div>
      <div className="pp-section-t">구성원</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>부서</th><th>직급</th><th>입사일</th><th>상태</th></tr></thead>
        <tbody>
          {MEMBERS_B.map((m) => (
            <tr key={m.n}>
              <td className="pp-strong">{m.n}</td><td>{m.d}</td><td>{m.r}</td><td>{m.j}</td>
              <td><span className={`pp-tag ${m.s === "수습" ? "pp-tag-w" : "pp-tag-s"}`}>{m.s}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 구성원 — 근로계약서 회수 전 ───────────────────────────────
export function MembersBeforePanel() {
  return (
    <section className="pp glass-card" id="pp-members-b">
      <PanelHead
        menu="인사관리 › 구성원"
        title="누가 언제 들어왔는지 다 남아요"
        sub="부서·직급·입사일·재직 상태가 정리되고, 근로계약서는 전자서명으로 보관돼요"
        right={<span className="pp-badge pp-badge-p">서명 대기</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>재직</span><b>12명</b></div>
        <div className="pp-mini"><span>평균 근속</span><b>2.1년</b></div>
        <div className="pp-mini"><span>계약서 보관</span><b>0/12</b></div>
      </div>
      <div className="pp-section-t">구성원</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>부서</th><th>직급</th><th>입사일</th><th>상태</th></tr></thead>
        <tbody>
          {MEMBERS_B.map((m) => (
            <tr key={m.n}>
              <td className="pp-strong">{m.n}</td><td>{m.d}</td><td>{m.r}</td><td>{m.j}</td>
              <td><span className={`pp-tag ${m.s === "수습" ? "pp-tag-w" : "pp-tag-s"}`}>{m.s}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">근로계약서 12건이 서명 대기 중이에요. 회수되면 자동으로 보관돼요.</div>
    </section>
  );
}

// ── 근태·연차 — 집계 전 ───────────────────────────────────────
export function LeaveBeforePanel() {
  const names = ["박서연", "이준호", "최민아", "정우성"];
  return (
    <section className="pp glass-card" id="pp-leave-b">
      <PanelHead
        menu="인사관리 › 근태 관리"
        title="연차는 직원이 직접 확인해요"
        sub="출근율·지각·사용 연차·연장근무가 자동으로 모여요"
        right={<span className="pp-badge pp-badge-p">집계 중</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>정상 출근율</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>사용 연차</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>연장근무</span><b>{DASH}</b></div>
      </div>
      <div className="pp-section-t">구성원별 근태</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>근무시간</th><th>사용 연차</th><th>연장근무</th><th>잔여 연차</th></tr></thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td className="pp-strong">{n}</td>
              <td>{DASH}</td><td>{DASH}</td><td>{DASH}</td>
              <td className="pp-num">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">출퇴근 기록을 모아 연차를 계산하고 있어요.</div>
    </section>
  );
}

// ── 회계 요약 — 분류 전 ───────────────────────────────────────
const LEDGER_B = [
  { d: "07-24", n: "(주)하늘건설 2차 기성금" },
  { d: "07-24", n: "사무실 월세" },
  { d: "07-23", n: "블루윙 스튜디오 외주비" },
  { d: "07-22", n: "메이커스랩 유지보수" },
  { d: "07-22", n: "네이버 광고" },
];

export function AcctBeforePanel() {
  return (
    <section className="pp glass-card" id="pp-acct-b">
      <PanelHead
        menu="파이낸스 › 수집·전표 · 세금·증빙"
        title="통장·카드가 자동으로 장부가 돼요"
        sub="실계좌를 연결하면 거래가 들어오고, AI가 계정과목까지 나눠줘요"
        right={<span className="pp-badge pp-badge-p">분류 전</span>}
      />
      <div className="pp-subtabs">
        <span className="pp-subtab pp-subtab-on">자동 분류</span>
        <span className="pp-subtab">입금 매칭</span>
      </div>
      <div className="pp-grid3">
        <div className="pp-mini"><span>이번 달 매출</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>이번 달 비용</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>순현금</span><b>{DASH}</b></div>
      </div>
      <div className="pp-section-t">수집·전표 — 계정 자동 추천</div>
      <table className="pp-table">
        <thead><tr><th>일자</th><th>내용</th><th>계정과목</th><th>금액</th></tr></thead>
        <tbody>
          {LEDGER_B.map((t) => (
            <tr key={t.n}>
              <td>{t.d}</td>
              <td className="pp-strong">{t.n}</td>
              <td><span className="pp-tag pp-tag-w">미분류</span></td>
              <td className="pp-num">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">계정과목을 아직 나누지 않았어요. AI 분류를 돌리면 한 번에 정리돼요.</div>
    </section>
  );
}

// ── 거래 장부(통장) — AI 분류 전 ──────────────────────────────
export function BankBeforePanel() {
  const tx = [
    { d: "07-24", desc: "(주)하늘건설 2차 기성금" },
    { d: "07-24", desc: "사무실 월세" },
    { d: "07-23", desc: "블루윙 스튜디오 외주비" },
    { d: "07-22", desc: "메이커스랩 유지보수" },
    { d: "07-22", desc: "4대보험료" },
  ];
  return (
    <section className="pp glass-card" id="pp-bank-b">
      <PanelHead
        menu="파이낸스 › 통장"
        title="계좌를 연결하면 알아서 들어와요"
        sub="잔액과 거래내역이 하루 2회 자동으로 동기화돼요"
        right={<span className="pp-badge pp-badge-p">동기화 중</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>국민은행 •••• 4821</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>기업은행 •••• 0317</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>카카오뱅크 •••• 9902</span><b>{DASH}</b></div>
      </div>
      <div className="pp-section-t">거래내역</div>
      <table className="pp-table">
        <thead><tr><th>날짜</th><th>적요</th><th>계정과목</th><th>금액</th></tr></thead>
        <tbody>
          {tx.map((t, i) => (
            <tr key={i}>
              <td>{t.d}</td>
              <td className="pp-strong">{t.desc}</td>
              <td><span className="pp-tag pp-tag-w">미분류</span></td>
              <td className="pp-num">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 세금·증빙 — 국세청 수집 전 ────────────────────────────────
export function TaxBeforePanel() {
  return (
    <section className="pp glass-card" id="pp-tax-b">
      <PanelHead
        menu="파이낸스 › 세금·증빙"
        title="세금계산서도 국세청에서 받아와요"
        sub="매출·매입 내역을 자동으로 수집하고 계약·입금과 대조해요"
        right={<span className="pp-badge pp-badge-p">수집 중</span>}
      />
      <div className="pp-subtabs">
        <span className="pp-subtab pp-subtab-on">세금계산서</span>
        <span className="pp-subtab">현금영수증</span>
      </div>
      <div className="pp-grid2 pp-mt">
        <div className="pp-mini"><span>조회기간 매출</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>조회기간 매입</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>딜 미연결 건수</span><b>{DASH}</b></div>
        <div className="pp-mini"><span>예상 부가세 납부액</span><b>{DASH}</b></div>
      </div>
      <div className="pp-section-t">세금계산서</div>
      <table className="pp-table">
        <thead><tr><th>거래처</th><th>발행일</th><th>프로젝트</th><th>상태</th><th>금액</th></tr></thead>
        <tbody>
          {[0, 1, 2, 3].map((i) => (
            <tr key={i}>
              <td className="pp-strong">{DASH}</td><td>{DASH}</td><td>{DASH}</td><td>{DASH}</td>
              <td className="pp-num">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">국세청에서 매출·매입 내역을 받아오고 있어요.</div>
    </section>
  );
}
