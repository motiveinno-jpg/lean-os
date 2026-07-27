"use client";

// /demo — 3대 축(주요 기능 둘러보기) 탭에 쓰는 화면 (2026-07-27).
//   기존 pillar 이미지는 880px 폭 DPR1 캡처라 확대되며 픽셀이 깨졌고, 높이가 103~705px 로 제각각이라
//   탭을 옮길 때마다 이미지 크기가 튀었다. → 여기 패널들을 pp- 규격으로 새로 만들고
//   캡처 시 .pp 높이를 고정해 전부 같은 비율(984x600 CSS, DPR2 → 1968x1200)로 찍는다.
//   실제 라우트 대응: /projecthub · /quote · /signatures · /partners/reconciliation ·
//                    /employees · /attendance · /tax-invoices
//   스타일은 pillar-panels 와 같은 pp- 클래스 재사용(globals.css).

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

// ── 프로젝트 파이프라인 (/projecthub) ────────────────────────
export function ProjectsPanel() {
  const rows = [
    { n: "하늘건설 사옥 리뉴얼", st: "진행중", amt: "₩280,000,000", p: 65, m: "마진 32%", tag: "s" },
    { n: "정우 엔지니어링 컨설팅", st: "계약완료", amt: "₩150,000,000", p: 30, m: "마진 28%", tag: "n" },
    { n: "메이커스랩 앱 개발", st: "견적발송", amt: "₩420,000,000", p: 10, m: "검토중", tag: "n" },
    { n: "블루윙 브랜딩", st: "진행중", amt: "₩90,000,000", p: 80, m: "마진 14%", tag: "w" },
    { n: "한빛 소재 유지보수", st: "정산대기", amt: "₩60,000,000", p: 95, m: "미수 1,200만", tag: "w" },
  ];
  return (
    <section className="pp glass-card" id="pp-projects">
      <PanelHead
        menu="워크스페이스 › 프로젝트"
        title="지금 어디까지 왔는지 한눈에"
        sub="단계·금액·진행률이 한 화면에. 마진이 무너진 건은 따로 표시해요"
        right={<span className="pp-badge pp-badge-p">진행 37건</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>수주 잔액</span><b>₩10억</b></div>
        <div className="pp-mini pp-mini-ok"><span>이번 달 매출</span><b>₩4,500만</b></div>
        <div className="pp-mini"><span>주의 필요</span><b>2건</b></div>
      </div>
      <div className="pp-section-t">진행 중인 프로젝트</div>
      <table className="pp-table">
        <thead><tr><th>프로젝트</th><th>단계</th><th>진행률</th><th>수익성</th><th>계약금액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td><span className={`pp-tag pp-tag-${r.tag === "w" ? "w" : "n"}`}>{r.st}</span></td>
              <td><span className="pp-bar" style={{ marginTop: 0, width: 72, display: "inline-block", verticalAlign: "middle" }}><span className="pp-bar-fill" style={{ display: "block", width: `${r.p}%` }} /></span> {r.p}%</td>
              <td>{r.m}</td>
              <td className="pp-num">{r.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">블루윙 브랜딩은 외주비가 늘어 마진이 14%까지 내려갔어요. 한빛 소재는 미수금 30일이 지났어요.</div>
    </section>
  );
}

// ── 견적서 (/quote) ──────────────────────────────────────────
export function EstimatePanel() {
  const items = [
    { n: "기획 · 설계", q: "1식", u: "₩38,000,000", a: "₩38,000,000" },
    { n: "디자인 (메인 + 서브 12p)", q: "1식", u: "₩24,000,000", a: "₩24,000,000" },
    { n: "퍼블리싱 · 개발", q: "1식", u: "₩142,000,000", a: "₩142,000,000" },
    { n: "유지보수 (6개월)", q: "6개월", u: "₩8,000,000", a: "₩48,000,000" },
  ];
  return (
    <section className="pp glass-card" id="pp-estimate">
      <PanelHead
        menu="프로젝트 › 견적서"
        title="품목만 넣으면 견적서가 완성돼요"
        sub="수량·단가만 넣으면 공급가와 부가세가 자동으로 계산돼요"
        right={<span className="pp-badge pp-badge-s">자동 계산</span>}
      />
      <table className="pp-table">
        <thead><tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.n}>
              <td className="pp-strong">{i.n}</td>
              <td>{i.q}</td>
              <td className="pp-num">{i.u}</td>
              <td className="pp-num">{i.a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-grid3">
        <div className="pp-mini"><span>공급가액</span><b>₩252,000,000</b></div>
        <div className="pp-mini"><span>부가세 10%</span><b>₩25,200,000</b></div>
        <div className="pp-mini pp-mini-ok"><span>합계</span><b>₩277,200,000</b></div>
      </div>
      <div className="pp-section-t">결제 조건</div>
      <div className="pp-grid3">
        <div className="pp-sub-card"><div className="pp-sub-t">선금 30%</div><div className="pp-stat"><b>₩83,160,000</b><span>계약 시</span></div></div>
        <div className="pp-sub-card"><div className="pp-sub-t">중도금 40%</div><div className="pp-stat"><b>₩110,880,000</b><span>중간 검수</span></div></div>
        <div className="pp-sub-card"><div className="pp-sub-t">잔금 30%</div><div className="pp-stat"><b>₩83,160,000</b><span>납품 완료</span></div></div>
      </div>
      <div className="pp-pay-cta">
        <span className="pp-chip-ok">승인하면 계약서 초안이 만들어져요</span>
        <span className="pp-btn">견적서 발송</span>
      </div>
    </section>
  );
}

// ── 계약서 (/signatures) ─────────────────────────────────────
export function ContractPanel() {
  const rows = [
    { n: "하늘건설 사옥 리뉴얼 계약서", who: "(주)하늘건설 · 김상무", st: "서명 완료", tag: "s", d: "07-24" },
    { n: "정우 엔지니어링 컨설팅 계약서", who: "정우 엔지니어링 · 이부장", st: "서명 대기", tag: "w", d: "07-23" },
    { n: "블루윙 외주 용역계약서", who: "블루윙 스튜디오 · 박대표", st: "서명 완료", tag: "s", d: "07-19" },
    { n: "메이커스랩 NDA", who: "메이커스랩 · 최팀장", st: "발송 전", tag: "n", d: "—" },
  ];
  return (
    <section className="pp glass-card" id="pp-contract">
      <PanelHead
        menu="워크스페이스 › 전자계약"
        title="직인까지 찍힌 계약서가 만들어져요"
        sub="견적이 승인되면 초안이 생기고, 전자서명으로 받아 그대로 보관돼요"
        right={<span className="pp-badge pp-badge-p">이번 달 12건</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini pp-mini-ok"><span>서명 완료</span><b>9</b></div>
        <div className="pp-mini"><span>서명 대기</span><b>2</b></div>
        <div className="pp-mini"><span>평균 회수</span><b>1.4일</b></div>
      </div>
      <div className="pp-section-t">계약 현황</div>
      <table className="pp-table">
        <thead><tr><th>계약서</th><th>상대방</th><th>상태</th><th>완료일</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td>{r.who}</td>
              <td><span className={`pp-tag pp-tag-${r.tag}`}>{r.st}</span></td>
              <td>{r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">직인은 서식에 등록해 두면 자동으로 합성돼요. 서명이 끝나면 계약서가 잠기고 보관함에 들어가요.</div>
    </section>
  );
}

// ── 정산 · 3-Way 매칭 (/partners/reconciliation) ─────────────
export function SettlementPanel() {
  return (
    <section className="pp glass-card" id="pp-settlement">
      <PanelHead
        menu="프로젝트 › 정산 확인"
        title="계약·세금계산서·입금을 맞춰봐요"
        sub="세 금액이 맞는지 알아서 대조하고, 맞으면 전표까지 만들어요"
        right={<span className="pp-badge pp-badge-s">매칭 일치</span>}
      />
      <div className="pp-grid3">
        <div className="pp-sub-card"><div className="pp-sub-t">① 계약 금액</div><div className="pp-stat"><b>₩277,200,000</b><span>하늘건설 사옥 리뉴얼</span></div></div>
        <div className="pp-sub-card"><div className="pp-sub-t">② 세금계산서</div><div className="pp-stat"><b>₩277,200,000</b><span>국세청 승인 07-24</span></div></div>
        <div className="pp-sub-card"><div className="pp-sub-t">③ 입금</div><div className="pp-stat"><b>₩277,200,000</b><span>국민 •••• 4821</span></div></div>
      </div>
      <div className="pp-section-t">자동 생성된 전표</div>
      <table className="pp-table">
        <thead><tr><th>계정과목</th><th>거래처</th><th>차변</th><th>대변</th></tr></thead>
        <tbody>
          <tr><td className="pp-strong">103 보통예금</td><td>(주)하늘건설</td><td className="pp-num">₩277,200,000</td><td className="pp-num">—</td></tr>
          <tr><td className="pp-strong">108 외상매출금</td><td>(주)하늘건설</td><td className="pp-num">—</td><td className="pp-num">₩277,200,000</td></tr>
        </tbody>
      </table>
      <div className="pp-pay-cta">
        <span className="pp-chip-ok">세 금액이 모두 일치해요 <span className="pp-ai">AI 매칭</span></span>
        <span className="pp-btn">정산 승인</span>
      </div>
    </section>
  );
}

// ── 구성원 (/employees) ──────────────────────────────────────
export function MembersPanel() {
  const rows = [
    { n: "김대표", d: "경영", r: "대표", j: "2023-01-02", st: "재직" },
    { n: "박서연", d: "디자인", r: "팀장", j: "2024-03-11", st: "재직" },
    { n: "이준호", d: "개발", r: "선임", j: "2024-07-01", st: "재직" },
    { n: "최민아", d: "경영지원", r: "매니저", j: "2025-02-17", st: "재직" },
    { n: "정우성", d: "개발", r: "주임", j: "2025-11-03", st: "수습" },
  ];
  return (
    <section className="pp glass-card" id="pp-members">
      <PanelHead
        menu="인사관리 › 구성원"
        title="누가 언제 들어왔는지 다 남아요"
        sub="부서·직급·입사일·재직 상태가 정리되고, 근로계약서는 전자서명으로 보관돼요"
        right={<span className="pp-badge pp-badge-p">재직 12 · 수습 1</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>재직</span><b>12명</b></div>
        <div className="pp-mini"><span>평균 근속</span><b>2.1년</b></div>
        <div className="pp-mini pp-mini-ok"><span>계약서 보관</span><b>12/12</b></div>
      </div>
      <div className="pp-section-t">구성원</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>부서</th><th>직급</th><th>입사일</th><th>상태</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td>{r.d}</td>
              <td>{r.r}</td>
              <td>{r.j}</td>
              <td><span className={`pp-tag pp-tag-${r.st === "재직" ? "s" : "w"}`}>{r.st}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">정우성 님 수습 종료가 D-14 예요. 정규직 근로계약서를 미리 준비할 수 있어요.</div>
    </section>
  );
}

// ── 근태 · 연차 (/attendance) ────────────────────────────────
export function LeavePanel() {
  const rows = [
    { n: "박서연", w: "168h", l: "3.5일", o: "12h", r: "11.5일" },
    { n: "이준호", w: "172h", l: "1.0일", o: "18h", r: "14.0일" },
    { n: "최민아", w: "160h", l: "5.0일", o: "4h", r: "10.0일" },
    { n: "정우성", w: "164h", l: "0.0일", o: "8h", r: "6.0일" },
  ];
  return (
    <section className="pp glass-card" id="pp-leave">
      <PanelHead
        menu="인사관리 › 근태 관리"
        title="연차는 직원이 직접 확인해요"
        sub="출근율·지각·사용 연차·연장근무가 자동으로 모여요"
        right={<span className="pp-badge pp-badge-s">7월 집계 완료</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini pp-mini-ok"><span>정상 출근율</span><b>96.4%</b></div>
        <div className="pp-mini"><span>사용 연차</span><b>18일</b></div>
        <div className="pp-mini"><span>연장근무</span><b>42h</b></div>
      </div>
      <div className="pp-section-t">구성원별 근태</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>근무시간</th><th>사용 연차</th><th>연장근무</th><th>잔여 연차</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td>{r.w}</td>
              <td>{r.l}</td>
              <td>{r.o}</td>
              <td className="pp-num">{r.r}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">연차는 발생 이력으로 관리돼요. 직원이 마이페이지에서 남은 연차를 직접 확인해요.</div>
    </section>
  );
}

// ── 세금·증빙 (/tax-invoices) ────────────────────────────────
export function TaxPanel() {
  const rows = [
    { d: "07-24", p: "(주)하늘건설", t: "매출", s: "₩252,000,000", v: "₩25,200,000", st: "승인", tag: "s" },
    { d: "07-22", p: "블루윙 스튜디오", t: "매입", s: "₩31,800,000", v: "₩3,180,000", st: "승인", tag: "s" },
    { d: "07-20", p: "메이커스랩", t: "매출", s: "₩60,000,000", v: "₩6,000,000", st: "승인", tag: "s" },
    { d: "07-18", p: "한빛 소재", t: "매입", s: "₩12,400,000", v: "₩1,240,000", st: "수집", tag: "n" },
  ];
  return (
    <section className="pp glass-card" id="pp-tax">
      <PanelHead
        menu="파이낸스 › 세금·증빙"
        title="세금계산서도 국세청에서 받아와요"
        sub="매출·매입 내역을 자동으로 수집하고 계약·입금과 대조해요"
        right={<span className="pp-badge pp-badge-p">이번 달 62건</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>매출세액</span><b>₩31,200,000</b></div>
        <div className="pp-mini"><span>매입세액</span><b>₩4,420,000</b></div>
        <div className="pp-mini pp-mini-ok"><span>납부 예상</span><b>₩26,780,000</b></div>
      </div>
      <div className="pp-section-t">세금계산서 <span className="pp-ai">자동 수집</span></div>
      <table className="pp-table">
        <thead><tr><th>발행일</th><th>거래처</th><th>구분</th><th>공급가액</th><th>세액</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.d}</td>
              <td className="pp-strong">{r.p} <span className={`pp-tag pp-tag-${r.tag}`}>{r.st}</span></td>
              <td>{r.t}</td>
              <td className="pp-num">{r.s}</td>
              <td className="pp-num">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">부가세 신고가 D-4 예요. 지금까지 수집된 내역으로 계산한 납부 예상액은 ₩26,780,000 이에요.</div>
    </section>
  );
}
