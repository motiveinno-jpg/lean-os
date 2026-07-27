"use client";

// /demo — 3대 축(경영흐름 · 인사관리 · 회계관리) 화면 재현 (2026-07-27).
//   랜딩이 메뉴별 강점을 소개하려면 각 메뉴의 실제 화면이 필요한데 데모에 없었다.
//   각 패널은 실제 라우트의 정보구조를 그대로 옮긴 정적 사본이다:
//     · FlowPanel      → /reports/flow  (미래 현금 예측 콕핏 + 6단계 흐름 + 흐름 경고)
//     · HrPanel        → /employees · /attendance  (구성원 · 근태 · 급여 배치)
//     · AccountPanel   → /transactions · /tax-invoices  (거래 장부 · 세금계산서 · 결산)
//   ⚠️ 실제 화면 구조가 바뀌면 여기와 랜딩 캡처(public/product/*-vN.png)를 함께 갱신할 것.

const won = (n: number) => "₩" + n.toLocaleString("ko-KR");

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

// ── 경영 흐름 (/reports/flow) ────────────────────────────────
const FORECAST = [
  { label: "현재", v: 230, tone: "ok" }, { label: "D+30", v: 198, tone: "ok" },
  { label: "D+60", v: 163, tone: "warn" }, { label: "D+90", v: 141, tone: "warn" },
];
const STEPS = [
  { no: 1, name: "영업", v: "₩1.2억", d: "진행 7건", tone: "p" },
  { no: 2, name: "매출", v: "₩4,500만", d: "확정 12건", tone: "i" },
  { no: 3, name: "수금", v: "₩3,300만", d: "미수 1,200만", tone: "s" },
  { no: 4, name: "비용", v: "₩3,200만", d: "고정비 68%", tone: "w" },
  { no: 5, name: "손익 · 세금", v: "+₩1,300만", d: "부가세 D-4", tone: "p" },
  { no: 6, name: "결산", v: "6월 마감", d: "7월 진행중", tone: "vi" },
];

export function FlowPanel() {
  const max = Math.max(...FORECAST.map((f) => f.v));
  return (
    <section className="pp glass-card" id="pp-flow">
      <PanelHead
        menu="분석 › 경영 흐름"
        title="미래 현금 예측 콕핏"
        sub="예정된 입출금을 반영해 90일 뒤 잔고까지 예측합니다"
        right={<span className="pp-badge pp-badge-p">기간 · 최근 90일</span>}
      />
      <div className="pp-forecast">
        {FORECAST.map((f) => (
          <div key={f.label} className="pp-fc">
            <div className="pp-fc-bar-wrap">
              <div className={`pp-fc-bar pp-fc-${f.tone}`} style={{ height: `${(f.v / max) * 100}%` }} />
            </div>
            <div className="pp-fc-v">{f.v}백만</div>
            <div className="pp-fc-l">{f.label}</div>
          </div>
        ))}
      </div>
      <div className="pp-alert">D+60 구간에서 잔고가 위험 기준(₩1.8억) 아래로 내려갑니다. 미수금 ₩1,200만 회수 시 해소됩니다.</div>

      <div className="pp-section-t">6단계 흐름 — 어디서 막혔는지 한 줄로</div>
      <div className="pp-steps">
        {STEPS.map((s, i) => (
          <div key={s.no} className="pp-step-wrap">
            <div className={`pp-step pp-step-${s.tone}`}>
              <div className="pp-step-no">{s.no}</div>
              <div className="pp-step-n">{s.name}</div>
              <div className="pp-step-v">{s.v}</div>
              <div className="pp-step-d">{s.d}</div>
            </div>
            {i < STEPS.length - 1 && <div className="pp-step-arrow">›</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 인사관리 (/employees · /attendance) ──────────────────────
const MEMBERS = [
  { n: "김대표", d: "경영", r: "대표", j: "2023-01-02", s: "재직" },
  { n: "박서연", d: "디자인", r: "팀장", j: "2024-03-11", s: "재직" },
  { n: "이준호", d: "개발", r: "선임", j: "2024-07-01", s: "재직" },
  { n: "최민아", d: "경영지원", r: "매니저", j: "2025-02-17", s: "재직" },
  { n: "정우성", d: "개발", r: "주임", j: "2025-11-03", s: "수습" },
];

export function HrPanel() {
  return (
    <section className="pp glass-card" id="pp-hr">
      <PanelHead
        menu="인사관리 › 구성원 · 근태 · 급여"
        title="입사부터 급여까지 한 흐름"
        sub="4대보험·원천세는 자동 계산되고, 대표는 승인만 하면 됩니다"
        right={<span className="pp-badge pp-badge-s">재직 12명 · 수습 1명</span>}
      />

      <div className="pp-grid2">
        <div className="pp-sub-card">
          <div className="pp-sub-t">이번 달 근태 요약</div>
          <div className="pp-stats">
            <div className="pp-stat"><b>96.4%</b><span>정상 출근율</span></div>
            <div className="pp-stat"><b>3건</b><span>지각</span></div>
            <div className="pp-stat"><b>18일</b><span>사용 연차</span></div>
            <div className="pp-stat"><b>42h</b><span>연장근무</span></div>
          </div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">7월 급여 배치</div>
          <div className="pp-payroll">
            <div className="pp-pay-row"><span>지급 총액</span><b>{won(58_400_000)}</b></div>
            <div className="pp-pay-row"><span>4대보험 (회사부담)</span><b>{won(5_320_000)}</b></div>
            <div className="pp-pay-row"><span>원천징수</span><b>{won(3_180_000)}</b></div>
          </div>
          <div className="pp-pay-cta"><span className="pp-chip-ok">자동 계산 완료</span><span className="pp-btn">명세서 12명 발송</span></div>
        </div>
      </div>

      <div className="pp-section-t">구성원</div>
      <table className="pp-table">
        <thead><tr><th>이름</th><th>부서</th><th>직급</th><th>입사일</th><th>상태</th></tr></thead>
        <tbody>
          {MEMBERS.map((m) => (
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

// ── 회계관리 (/transactions · /tax-invoices) ─────────────────
const LEDGER = [
  { d: "07-26", n: "A사 2차 기성금", c: "매출", a: 12_000_000, io: "in", ai: true },
  { d: "07-25", n: "사무실 월세", c: "지급임차료", a: -1_800_000, io: "out", ai: true },
  { d: "07-24", n: "외주비 (디자이너)", c: "외주용역비", a: -3_500_000, io: "out", ai: true },
  { d: "07-23", n: "E사 유지보수 월정액", c: "매출", a: 6_000_000, io: "in", ai: true },
  { d: "07-22", n: "법인카드 · 클라우드", c: "지급수수료", a: -742_000, io: "out", ai: false },
];

export function AccountPanel() {
  return (
    <section className="pp glass-card" id="pp-acct">
      <PanelHead
        menu="파이낸스 › 거래 장부 · 세금·증빙"
        title="통장·카드가 자동으로 장부가 됩니다"
        sub="실계좌를 연동하면 거래가 들어오고, AI가 계정과목까지 분류합니다"
        right={<span className="pp-badge pp-badge-p">AI 분류 94% 자동</span>}
      />

      <div className="pp-grid3">
        <div className="pp-mini"><span>이번 달 매출</span><b>{won(45_000_000)}</b></div>
        <div className="pp-mini"><span>이번 달 비용</span><b>{won(32_000_000)}</b></div>
        <div className="pp-mini pp-mini-ok"><span>순현금</span><b>+{won(13_000_000)}</b></div>
      </div>

      <div className="pp-section-t">거래 장부 — 자동 분류</div>
      <table className="pp-table">
        <thead><tr><th>일자</th><th>내용</th><th>계정과목</th><th>금액</th></tr></thead>
        <tbody>
          {LEDGER.map((t) => (
            <tr key={t.n}>
              <td>{t.d}</td>
              <td className="pp-strong">{t.n}</td>
              <td>
                <span className="pp-tag pp-tag-n">{t.c}</span>
                {t.ai ? <span className="pp-ai">AI</span> : <span className="pp-tag pp-tag-w">확인 필요</span>}
              </td>
              <td className={`pp-num ${t.io === "in" ? "pp-in" : "pp-out"}`}>{t.a > 0 ? "+" : ""}{won(t.a)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pp-grid2 pp-mt">
        <div className="pp-sub-card">
          <div className="pp-sub-t">세금계산서 — 국세청 연동</div>
          <div className="pp-pay-row"><span>매출 발행</span><b>894건</b></div>
          <div className="pp-pay-row"><span>매입 수취</span><b>911건</b></div>
          <div className="pp-pay-row"><span>3-Way 매칭</span><b className="pp-in">98.2% 일치</b></div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">월결산</div>
          <div className="pp-pay-row"><span>6월</span><b className="pp-in">마감 완료</b></div>
          <div className="pp-pay-row"><span>7월</span><b>진행중 · 미분류 6건</b></div>
          <div className="pp-pay-cta"><span className="pp-btn">재무제표 생성</span></div>
        </div>
      </div>
    </section>
  );
}
