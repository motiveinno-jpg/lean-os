"use client";

// /demo — 위젯식 대시보드 재현 (2026-07-27).
//   실제 앱의 대시보드는 react-grid-layout 기반 위젯 보드다(components/dashboard-grid.tsx).
//   기존 데모는 이 위젯 보드가 통째로 빠져 있어 "예전 화면"으로 보였다.
//   여기서는 실제 기본 배치(dashboard/page.tsx 의 DEFAULT_WIDGET_POS)와 위젯 이름·아이콘을
//   그대로 옮겨 12칼럼 · rowHeight 44 · gap 12 격자를 CSS Grid 로 재현한다.
//   ⚠️ 실제 배치가 바뀌면 여기와 랜딩 캡처(public/product/dashboard.png)도 같이 갱신할 것.

type W = { id: string; name: string; icon: string; x: number; y: number; w: number; h: number; body: React.ReactNode };

const won = (n: number) => "₩" + n.toLocaleString("ko-KR");

function Row({ l, r, tone }: { l: React.ReactNode; r: React.ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="wg-row">
      <span className="wg-row-l">{l}</span>
      <span className={`wg-row-r ${tone ? `wg-${tone}` : ""}`}>{r}</span>
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone?: "warn" | "ok" }) {
  return <div className="wg-bar"><div className={`wg-bar-fill ${tone ? `wg-bar-${tone}` : ""}`} style={{ width: `${pct}%` }} /></div>;
}

// 미니 달력 — 실제 일정·캘린더 위젯(h9)이 차지하는 자리
function MiniCalendar() {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const marked = new Set([4, 11, 15, 22, 25, 27]);
  return (
    <>
      <div className="wg-cal-head">2026년 7월</div>
      <div className="wg-cal-dow">{["일", "월", "화", "수", "목", "금", "토"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="wg-cal-grid">
        {Array.from({ length: 3 }, (_, i) => <span key={`e${i}`} />)}
        {days.map((d) => (
          <span key={d} className={`wg-cal-day ${d === 27 ? "wg-cal-today" : ""} ${marked.has(d) ? "wg-cal-mark" : ""}`}>{d}</span>
        ))}
      </div>
      <div className="wg-cal-list">
        <div className="wg-cal-item"><span className="wg-dot wg-dot-p" />10:00 B사 킥오프 미팅</div>
        <div className="wg-cal-item"><span className="wg-dot wg-dot-w" />14:00 부가세 예정신고 마감</div>
        <div className="wg-cal-item"><span className="wg-dot wg-dot-o" />18:00 급여 배치 검토</div>
      </div>
    </>
  );
}

const WIDGETS: W[] = [
  {
    id: "attendance", name: "내 근태", icon: "🕘", x: 0, y: 0, w: 4, h: 2,
    body: (
      <div className="wg-att">
        <div>
          <div className="wg-att-state">근무 중</div>
          <div className="wg-att-time">출근 09:02 · 경과 6시간 12분</div>
        </div>
        <button className="wg-btn">퇴근하기</button>
      </div>
    ),
  },
  { id: "calendar", name: "일정 · 캘린더", icon: "📅", x: 0, y: 2, w: 4, h: 9, body: <MiniCalendar /> },
  {
    id: "work-tasks", name: "내 담당 업무", icon: "✅", x: 0, y: 11, w: 4, h: 4,
    body: (
      <div className="wg-tasks">
        {[
          { t: "B사 디자인 시스템 컴포넌트 정리", d: "오늘", hot: true },
          { t: "C사 컨설팅 중간보고 초안", d: "D-2" },
          { t: "D사 견적서 단가 재확인", d: "D-5" },
          { t: "사내 위키 온보딩 문서 갱신", d: "D-9" },
        ].map((x) => (
          <div key={x.t} className="wg-task">
            <span className="wg-check" />
            <span className="wg-task-t">{x.t}</span>
            <span className={`wg-task-d ${x.hot ? "wg-warn" : ""}`}>{x.d}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "projects", name: "최근 프로젝트", icon: "💼", x: 4, y: 0, w: 4, h: 5,
    body: (
      <div className="wg-list">
        {[
          { n: "B사 UI/UX 리뉴얼", s: "진행중", a: 28_000_000, p: 65 },
          { n: "C사 전략 컨설팅", s: "계약완료", a: 15_000_000, p: 30 },
          { n: "D사 앱 개발", s: "견적발송", a: 42_000_000, p: 10 },
          { n: "E사 유지보수", s: "진행중", a: 6_000_000, p: 80 },
        ].map((x) => (
          <div key={x.n} className="wg-proj">
            <div className="wg-proj-top">
              <span className="wg-proj-n">{x.n}</span>
              <span className="wg-tag">{x.s}</span>
            </div>
            <div className="wg-proj-bot"><Bar pct={x.p} /><span className="wg-proj-a">{won(x.a)}</span></div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "revenue", name: "이번 달 매출", icon: "💰", x: 4, y: 5, w: 4, h: 5,
    body: (
      <>
        <div className="wg-big">{won(45_000_000)}<span className="wg-delta">+23%</span></div>
        <div className="wg-spark">{[38, 52, 44, 61, 57, 72, 68, 84].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div>
        <div className="wg-list wg-mt">
          <Row l="A사 2차 기성금" r={`+${won(12_000_000)}`} tone="ok" />
          <Row l="E사 유지보수 월정액" r={`+${won(6_000_000)}`} tone="ok" />
          <Row l="C사 컨설팅 착수금" r={`+${won(4_500_000)}`} tone="ok" />
        </div>
      </>
    ),
  },
  {
    id: "tax", name: "세금 일정", icon: "🧾", x: 4, y: 10, w: 4, h: 5,
    body: (
      <div className="wg-list">
        {[
          { n: "부가가치세 예정신고", d: "D-4", hot: true },
          { n: "원천세 신고·납부", d: "D-11" },
          { n: "4대보험 정산", d: "D-18" },
          { n: "법인세 중간예납", d: "D-42" },
        ].map((x) => (
          <div key={x.n} className="wg-tax">
            <span className={`wg-dday ${x.hot ? "wg-dday-hot" : ""}`}>{x.d}</span>
            <span className="wg-tax-n">{x.n}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "biz", name: "경영 요약", icon: "📊", x: 8, y: 0, w: 4, h: 4,
    body: (
      <div className="wg-kpis">
        <div className="wg-kpi"><span>통장 잔고</span><b>{won(230_000_000)}</b></div>
        <div className="wg-kpi"><span>이번 달 손익</span><b className="wg-ok">+{won(13_000_000)}</b></div>
        <div className="wg-kpi"><span>런웨이</span><b>8.2개월</b></div>
        <div className="wg-kpi"><span>번레이트</span><b>{won(32_000_000)}</b></div>
      </div>
    ),
  },
  {
    id: "receivables", name: "미수금", icon: "💸", x: 8, y: 4, w: 4, h: 5,
    body: (
      <>
        <div className="wg-big wg-warn">{won(12_000_000)}</div>
        <div className="wg-cap">30일 초과 1건 · 회수 필요</div>
        <div className="wg-list wg-mt">
          <Row l="(주)하늘건설" r="34일 경과" tone="warn" />
          <Row l="(주)미래테크" r="12일 경과" />
          <Row l="A사" r="4일 경과" />
        </div>
      </>
    ),
  },
  {
    id: "assets", name: "자산", icon: "🏦", x: 8, y: 9, w: 4, h: 3,
    body: (
      <div className="wg-list">
        <Row l="기업은행 주계좌" r={won(184_000_000)} />
        <Row l="국민은행 급여계좌" r={won(38_000_000)} />
        <Row l="법인 CMA" r={won(8_000_000)} />
      </div>
    ),
  },
  {
    id: "cards", name: "카드", icon: "💳", x: 8, y: 12, w: 4, h: 3,
    body: (
      <>
        <div className="wg-big">{won(7_420_000)}</div>
        <div className="wg-cap">이번 달 사용 · 한도 대비 37%</div>
        <Bar pct={37} />
      </>
    ),
  },
];

export function WidgetBoard() {
  return (
    <section className="wb" id="widget-board">
      <div className="wb-head">
        <div>
          <div className="wb-eyebrow">내 대시보드</div>
          <div className="wb-title">위젯을 원하는 위치·크기로 배치할 수 있습니다</div>
        </div>
        <div className="wb-actions">
          <span className="wb-btn">＋ 위젯 추가</span>
          <span className="wb-btn wb-btn-on">⠿ 위젯 편집</span>
        </div>
      </div>

      {/* 실제 앱과 동일한 12칼럼 · 44px 행 · 12px 간격 격자 */}
      <div className="wb-grid">
        {WIDGETS.map((w) => (
          <div
            key={w.id}
            className="wb-tile glass-card"
            style={{ gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` }}
          >
            <div className="wb-tile-head">
              <span className="wb-tile-icon">{w.icon}</span>
              <span className="wb-tile-name">{w.name}</span>
              <span className="wb-grip">⠿</span>
            </div>
            <div className="wb-tile-body">{w.body}</div>
          </div>
        ))}
      </div>

      {/* 모바일 — 실제 앱도 768px 미만에서는 1칼럼으로 떨어진다 */}
      <div className="wb-grid-m">
        {WIDGETS.map((w) => (
          <div key={w.id} className="wb-tile glass-card">
            <div className="wb-tile-head">
              <span className="wb-tile-icon">{w.icon}</span>
              <span className="wb-tile-name">{w.name}</span>
              <span className="wb-grip">⠿</span>
            </div>
            <div className="wb-tile-body">{w.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
