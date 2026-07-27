"use client";

// /demo — 메뉴별 화면 재현 (2026-07-27).
//   랜딩 "오너뷰 둘러보기" 가 메뉴 20개를 각각 실제 화면으로 보여주려면 캡처 소스가 필요한데,
//   기존 데모에는 대시보드·프로젝트 흐름·3대 축밖에 없었다. 여기서 나머지 13개 메뉴를 채운다.
//   각 패널은 실제 라우트의 정보구조(탭·표 컬럼·상태값)를 그대로 옮긴 정적 사본이다:
//     partners  → /partners            vouchers  → /partners/reconciliation/voucher-entry
//     schedule  → /schedule            approvals → /approvals
//     board     → /board               chat      → /chat
//     templates → /hr-templates        documents → /documents
//     bank      → /bank                cards     → /cards
//     payments  → /payments            loans     → /loans
//     vault     → /vault
//   ⚠️ 실제 화면 구조가 바뀌면 여기와 랜딩 캡처(public/product/menu-*.png)를 함께 갱신할 것.
//   스타일은 pillar-panels 와 같은 pp- 클래스를 재사용한다(globals.css).

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

// ── 거래처 (/partners) ───────────────────────────────────────
export function PartnersPanel() {
  const rows = [
    { n: "(주)하늘건설", t: "고객사", b: "123-81-45678", last: "2026-07-24", amt: "₩1억 2,400만", tag: "s" },
    { n: "블루윙 스튜디오", t: "공급업체", b: "220-88-10293", last: "2026-07-21", amt: "₩3,180만", tag: "n" },
    { n: "정우 엔지니어링", t: "고객사", b: "514-86-77120", last: "2026-07-18", amt: "₩8,600만", tag: "s" },
    { n: "한빛 소재", t: "공급업체", b: "301-81-55014", last: "2026-05-02", amt: "₩1,240만", tag: "w" },
    { n: "메이커스랩", t: "고객사", b: "760-87-00931", last: "2026-07-09", amt: "₩4,720만", tag: "n" },
  ];
  return (
    <section className="pp glass-card" id="pp-partners">
      <PanelHead
        menu="파이낸스 › 거래처"
        title="거래처마다 기록이 쌓여요"
        sub="프로젝트·계약·매출 이력이 거래처에 자동으로 연결돼요"
        right={<span className="pp-badge pp-badge-p">전체 684곳</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>고객사</span><b>412</b></div>
        <div className="pp-mini"><span>공급업체</span><b>272</b></div>
        <div className="pp-mini"><span>90일 무거래</span><b>38</b></div>
      </div>
      <div className="pp-section-t">거래처 목록</div>
      <table className="pp-table">
        <thead><tr><th>거래처명</th><th>구분</th><th>사업자번호</th><th>최근 거래</th><th>누적 매출</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td><span className={`pp-tag pp-tag-${r.tag === "w" ? "w" : r.t === "고객사" ? "s" : "n"}`}>{r.t}</span></td>
              <td>{r.b}</td>
              <td>{r.last}{r.tag === "w" && <span className="pp-tag pp-tag-w" style={{ marginLeft: 6 }}>휴면</span>}</td>
              <td className="pp-num">{r.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">90일 넘게 거래가 없는 거래처 38곳을 찾았어요. 담당자에게 리마인더를 보낼 수 있어요.</div>
    </section>
  );
}

// ── 전표입력 (/partners/reconciliation/voucher-entry) ────────
export function VoucherPanel() {
  const lines = [
    { ac: "108 외상매출금", d: "₩12,000,000", c: "—", p: "(주)하늘건설" },
    { ac: "401 상품매출", d: "—", c: "₩10,909,091", p: "(주)하늘건설" },
    { ac: "255 부가세예수금", d: "—", c: "₩1,090,909", p: "(주)하늘건설" },
  ];
  return (
    <section className="pp glass-card" id="pp-voucher">
      <PanelHead
        menu="파이낸스 › 전표입력"
        title="필요할 땐 직접 입력해요"
        sub="계정과목 사전을 회사에 맞게 관리하고, 수기 전표도 그대로 기장돼요"
        right={<span className="pp-badge pp-badge-s">차·대변 일치</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>전표일자</span><b style={{ fontSize: 13 }}>2026-07-24</b></div>
        <div className="pp-mini"><span>유형</span><b style={{ fontSize: 13 }}>매출 (대체)</b></div>
        <div className="pp-mini pp-mini-ok"><span>차변 = 대변</span><b>₩12,000,000</b></div>
      </div>
      <div className="pp-section-t">전표 라인</div>
      <table className="pp-table">
        <thead><tr><th>계정과목</th><th>거래처</th><th>차변</th><th>대변</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.ac}>
              <td className="pp-strong">{l.ac}</td>
              <td>{l.p}</td>
              <td className="pp-num">{l.d}</td>
              <td className="pp-num">{l.c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-pay-cta">
        <span className="pp-chip-ok">계정과목 사전 92개 등록됨</span>
        <span className="pp-btn">전표 저장</span>
      </div>
    </section>
  );
}

// ── 일정 / 할 일 (/schedule) ─────────────────────────────────
export function SchedulePanel() {
  const days = ["월 21", "화 22", "수 23", "목 24", "금 25"];
  const ev: Record<string, { t: string; tone: string }[]> = {
    "월 21": [{ t: "주간 회의", tone: "p" }],
    "화 22": [{ t: "하늘건설 납품", tone: "s" }, { t: "세금계산서 발행", tone: "n" }],
    "수 23": [{ t: "면접 2건", tone: "n" }],
    "목 24": [{ t: "부가세 신고 D-4", tone: "w" }, { t: "정우 미팅", tone: "p" }],
    "금 25": [{ t: "급여 이체", tone: "s" }],
  };
  const todo = [
    { t: "블루윙 계약서 검토", d: "오늘", done: false },
    { t: "7월 급여 배치 승인", d: "내일", done: false },
    { t: "하늘건설 미수금 독촉", d: "D+2", done: false },
    { t: "6월 결산 마감", d: "완료", done: true },
  ];
  return (
    <section className="pp glass-card" id="pp-schedule">
      <PanelHead
        menu="워크스페이스 › 일정 / 할 일"
        title="회사 일정과 내 할 일을 한 화면에서"
        sub="전 구성원이 함께 보는 일정과 나만 보는 개인 일정을 같이 봐요"
        right={<span className="pp-badge pp-badge-p">이번 주 9건</span>}
      />
      <div className="pp-cal">
        {days.map((d) => (
          <div key={d} className="pp-cal-day">
            <div className="pp-cal-dh">{d}</div>
            {(ev[d] ?? []).map((e) => (
              <div key={e.t} className={`pp-tag pp-tag-${e.tone === "p" ? "n" : e.tone}`} style={{ display: "block", marginBottom: 4 }}>{e.t}</div>
            ))}
          </div>
        ))}
      </div>
      <div className="pp-section-t">내 할 일</div>
      <div className="pp-payroll">
        {todo.map((t) => (
          <div key={t.t} className="pp-pay-row">
            <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.t}</span>
            <b>{t.d}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 결재 허브 (/approvals) ───────────────────────────────────
export function ApprovalsPanel() {
  const rows = [
    { t: "외주 디자인비 지급", ty: "지출결의", amt: "₩3,500,000", by: "박서연", st: "대기", tag: "w" },
    { t: "7월 연차 사용 (2일)", ty: "휴가", amt: "—", by: "이준호", st: "대기", tag: "w" },
    { t: "출장 경비 정산", ty: "경비", amt: "₩412,000", by: "최민아", st: "승인", tag: "s" },
    { t: "노트북 구매", ty: "구매요청", amt: "₩2,180,000", by: "정우성", st: "승인", tag: "s" },
    { t: "광고 집행비", ty: "지출결의", amt: "₩1,200,000", by: "박서연", st: "반려", tag: "n" },
  ];
  return (
    <section className="pp glass-card" id="pp-approvals">
      <PanelHead
        menu="워크스페이스 › 결재 허브"
        title="요청이 한 결재함에 모여요"
        sub="경비·지출·휴가·구매 요청을 한곳에서 승인해요"
        right={<span className="pp-badge pp-badge-p">내 결재함 5건</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>대기 중</span><b>5</b></div>
        <div className="pp-mini"><span>이번 달 승인</span><b>34</b></div>
        <div className="pp-mini pp-mini-ok"><span>평균 처리</span><b>4.2h</b></div>
      </div>
      <div className="pp-section-t">내 결재함</div>
      <table className="pp-table">
        <thead><tr><th>제목</th><th>유형</th><th>요청자</th><th>결재선</th><th>금액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td className="pp-strong">{r.t} <span className={`pp-tag pp-tag-${r.tag}`}>{r.st}</span></td>
              <td>{r.ty}</td>
              <td>{r.by}</td>
              <td>팀장 → 대표</td>
              <td className="pp-num">{r.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">₩100만 미만 경비는 자동승인 규칙이 켜져 있어요. 이번 달 12건이 자동 처리됐어요.</div>
    </section>
  );
}

// ── 게시판 (/board) ──────────────────────────────────────────
export function BoardPanel() {
  const posts = [
    { t: "7월 급여 지급일 안내", by: "김대표", d: "07-24", c: 4, pin: true },
    { t: "하계 휴가 신청 받습니다", by: "최민아", d: "07-22", c: 12, pin: true },
    { t: "사무실 정기 방역 (7/27 토)", by: "최민아", d: "07-20", c: 1, pin: false },
    { t: "신규 입사자 소개 — 정우성 님", by: "김대표", d: "07-15", c: 8, pin: false },
    { t: "2분기 실적 공유", by: "김대표", d: "07-08", c: 3, pin: false },
  ];
  return (
    <section className="pp glass-card" id="pp-board">
      <PanelHead
        menu="워크스페이스 › 게시판"
        title="공지를 한곳에 남겨요"
        sub="전 구성원에게 가는 공지와 부서 게시글을 같은 시스템 안에서 관리해요"
        right={<span className="pp-badge pp-badge-p">읽지 않음 2</span>}
      />
      <table className="pp-table">
        <thead><tr><th>제목</th><th>작성자</th><th>댓글</th><th>작성일</th></tr></thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.t}>
              <td className="pp-strong">{p.pin && <span className="pp-tag pp-tag-s" style={{ marginRight: 6 }}>공지</span>}{p.t}</td>
              <td>{p.by}</td>
              <td>{p.c}</td>
              <td>{p.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-section-t">읽음 현황</div>
      <div className="pp-payroll">
        <div className="pp-pay-row"><span>7월 급여 지급일 안내</span><b>12명 중 10명 읽음</b></div>
        <div className="pp-pay-row"><span>하계 휴가 신청 받습니다</span><b>12명 중 12명 읽음</b></div>
      </div>
    </section>
  );
}

// ── 메신저 (/chat) ───────────────────────────────────────────
export function ChatPanel() {
  const chans = [
    { n: "# 전사 공지", c: 0 },
    { n: "# 하늘건설 리뉴얼", c: 3 },
    { n: "# 디자인팀", c: 0 },
    { n: "# 정우 엔지니어링", c: 1 },
    { n: "@ 박서연", c: 2 },
  ];
  const msgs = [
    { who: "박서연", me: false, t: "하늘건설 2차 시안 올렸어요. 확인 부탁드립니다!" },
    { who: "이준호", me: false, t: "견적서 금액 ₩2,800만으로 맞췄습니다." },
    { who: "김대표", me: true, t: "확인했어요. 계약서 초안까지 바로 넘기죠." },
  ];
  return (
    <section className="pp glass-card" id="pp-chat">
      <PanelHead
        menu="워크스페이스 › 메신저"
        title="일하는 자리에서 바로 이야기해요"
        sub="프로젝트마다 전용 채널이 열리고, 외부 파트너도 초대할 수 있어요"
        right={<span className="pp-badge pp-badge-p">안 읽음 6</span>}
      />
      <div className="pp-chatwrap">
        <div className="pp-chan">
          {chans.map((c) => (
            <div key={c.n} className="pp-chan-row">
              <span>{c.n}</span>
              {c.c > 0 && <b className="pp-chan-badge">{c.c}</b>}
            </div>
          ))}
        </div>
        <div className="pp-thread">
          <div className="pp-thread-h">＃ 하늘건설 리뉴얼 · 멤버 4명 (파트너 1)</div>
          {msgs.map((m, i) => (
            <div key={i} className={m.me ? "pp-msg pp-msg-me" : "pp-msg"}>
              <span className="pp-msg-who">{m.who}</span>
              <p>{m.t}</p>
            </div>
          ))}
          <div className="pp-msg-input">메시지를 입력하세요…</div>
        </div>
      </div>
    </section>
  );
}

// ── 근로계약·서식 (/hr-templates) ────────────────────────────
export function TemplatesPanel() {
  const tpls = [
    { n: "정규직 근로계약서", u: "12회 사용", st: "사용중" },
    { n: "수습 근로계약서", u: "3회 사용", st: "사용중" },
    { n: "비밀유지 서약서(NDA)", u: "9회 사용", st: "사용중" },
    { n: "프리랜서 용역계약서", u: "5회 사용", st: "사용중" },
  ];
  const sent = [
    { n: "정우성 — 수습 근로계약서", st: "서명 완료", tag: "s", d: "07-01" },
    { n: "최민아 — 연봉계약서(2026)", st: "서명 대기", tag: "w", d: "07-23" },
    { n: "블루윙 — NDA", st: "서명 완료", tag: "s", d: "06-28" },
  ];
  return (
    <section className="pp glass-card" id="pp-templates">
      <PanelHead
        menu="인사관리 › 근로계약·서식"
        title="계약서는 서식으로 만들고 서명으로 받아요"
        sub="한 번 만든 서식을 재사용하고, 직인은 자동으로 합성돼요"
        right={<span className="pp-badge pp-badge-p">서식 8종</span>}
      />
      <div className="pp-grid2">
        <div className="pp-sub-card">
          <div className="pp-sub-t">보유 서식</div>
          <div className="pp-payroll">
            {tpls.map((t) => (
              <div key={t.n} className="pp-pay-row"><span>{t.n}</span><b>{t.u}</b></div>
            ))}
          </div>
        </div>
        <div className="pp-sub-card">
          <div className="pp-sub-t">발송 현황</div>
          <div className="pp-payroll">
            {sent.map((s) => (
              <div key={s.n} className="pp-pay-row">
                <span>{s.n}</span>
                <b><span className={`pp-tag pp-tag-${s.tag}`}>{s.st}</span> {s.d}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="pp-alert">계약 만료 30일 전 자동 알림이 켜져 있어요. 다음 갱신 대상은 2건이에요.</div>
    </section>
  );
}

// ── 파일보관함 (/documents) ──────────────────────────────────
export function DocumentsPanel() {
  const folders = [
    { n: "계약서", c: 148 }, { n: "인사기록", c: 96 }, { n: "세금·증빙", c: 412 }, { n: "프로젝트 산출물", c: 233 },
  ];
  const files = [
    { n: "하늘건설_리뉴얼_계약서_v3.pdf", by: "김대표", d: "07-24", s: "2.1MB", v: "v3" },
    { n: "2026_정우성_근로계약서.pdf", by: "최민아", d: "07-01", s: "0.8MB", v: "v1" },
    { n: "블루윙_NDA_서명본.pdf", by: "이준호", d: "06-28", s: "0.6MB", v: "v1" },
    { n: "6월_결산자료.xlsx", by: "김대표", d: "07-05", s: "1.4MB", v: "v2" },
  ];
  return (
    <section className="pp glass-card" id="pp-documents">
      <PanelHead
        menu="인사관리 › 파일보관함"
        title="회사 서류를 안전하게 보관해요"
        sub="폴더별로 열람 권한을 나누고, 바뀐 파일은 버전으로 남아요"
        right={<span className="pp-badge pp-badge-p">총 889개</span>}
      />
      <div className="pp-grid2">
        {folders.map((f) => (
          <div key={f.n} className="pp-mini"><span>{f.n}</span><b>{f.c}개</b></div>
        ))}
      </div>
      <div className="pp-section-t">최근 파일</div>
      <table className="pp-table">
        <thead><tr><th>파일명</th><th>올린 사람</th><th>버전</th><th>크기</th><th>날짜</th></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.n}>
              <td className="pp-strong">{f.n}</td>
              <td>{f.by}</td>
              <td><span className="pp-tag pp-tag-n">{f.v}</span></td>
              <td>{f.s}</td>
              <td>{f.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 통장 (/bank) ─────────────────────────────────────────────
export function BankPanel() {
  const accts = [
    { b: "국민은행", n: "•••• 4821", v: "₩148,200,000", main: true },
    { b: "기업은행", n: "•••• 0317", v: "₩62,400,000", main: false },
    { b: "카카오뱅크", n: "•••• 9902", v: "₩19,800,000", main: false },
  ];
  const tx = [
    { d: "07-24", desc: "(주)하늘건설 2차 기성금", ac: "외상매출금", amt: "+₩12,000,000", io: "in" },
    { d: "07-24", desc: "사무실 월세", ac: "지급임차료", amt: "-₩1,800,000", io: "out" },
    { d: "07-23", desc: "블루윙 스튜디오 외주비", ac: "외주가공비", amt: "-₩3,500,000", io: "out" },
    { d: "07-22", desc: "메이커스랩 유지보수", ac: "상품매출", amt: "+₩6,000,000", io: "in" },
    { d: "07-22", desc: "4대보험료", ac: "복리후생비", amt: "-₩5,320,000", io: "out" },
  ];
  return (
    <section className="pp glass-card" id="pp-bank">
      <PanelHead
        menu="자산관리 › 통장"
        title="계좌를 연결하면 알아서 들어와요"
        sub="잔액과 거래내역이 하루 2회 자동으로 동기화돼요"
        right={<span className="pp-badge pp-badge-s">동기화 07-24 18:00</span>}
      />
      <div className="pp-grid3">
        {accts.map((a) => (
          <div key={a.n} className={a.main ? "pp-mini pp-mini-ok" : "pp-mini"}>
            <span>{a.b} {a.n}</span><b>{a.v}</b>
          </div>
        ))}
      </div>
      <div className="pp-section-t">거래내역 <span className="pp-ai">AI 분류</span></div>
      <table className="pp-table">
        <thead><tr><th>날짜</th><th>적요</th><th>계정과목</th><th>금액</th></tr></thead>
        <tbody>
          {tx.map((t, i) => (
            <tr key={i}>
              <td>{t.d}</td>
              <td className="pp-strong">{t.desc}</td>
              <td><span className="pp-tag pp-tag-n">{t.ac}</span></td>
              <td className={t.io === "in" ? "pp-num pp-in" : "pp-num pp-out"}>{t.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 카드 (/cards) ────────────────────────────────────────────
export function CardsPanel() {
  const cards = [
    { n: "법인 신한 •••• 3312", use: "₩8,420,000", lim: "한도 ₩20,000,000", pct: 42 },
    { n: "법인 현대 •••• 7708", use: "₩3,180,000", lim: "한도 ₩10,000,000", pct: 32 },
  ];
  const tx = [
    { d: "07-24", m: "쿠팡", ac: "소모품비", who: "최민아", amt: "₩184,000" },
    { d: "07-23", m: "AWS", ac: "지급수수료", who: "이준호", amt: "₩1,240,000" },
    { d: "07-23", m: "스타벅스 역삼점", ac: "복리후생비", who: "박서연", amt: "₩38,000" },
    { d: "07-22", m: "대한항공", ac: "여비교통비", who: "김대표", amt: "₩620,000" },
    { d: "07-21", m: "네이버 광고", ac: "광고선전비", who: "박서연", amt: "₩1,200,000" },
  ];
  return (
    <section className="pp glass-card" id="pp-cards">
      <PanelHead
        menu="자산관리 › 카드"
        title="법인카드 승인 내역이 자동으로 모여요"
        sub="누가 어디에 썼는지, 어떤 계정과목인지까지 같이 정리돼요"
        right={<span className="pp-badge pp-badge-p">이번 달 68건</span>}
      />
      <div className="pp-grid2">
        {cards.map((c) => (
          <div key={c.n} className="pp-sub-card">
            <div className="pp-sub-t">{c.n}</div>
            <div className="pp-stats">
              <div className="pp-stat"><b>{c.use}</b><span>이번 달 사용</span></div>
              <div className="pp-stat"><b>{c.pct}%</b><span>{c.lim}</span></div>
            </div>
            <div className="pp-bar"><div className="pp-bar-fill" style={{ width: `${c.pct}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="pp-section-t">승인 내역 <span className="pp-ai">AI 분류</span></div>
      <table className="pp-table">
        <thead><tr><th>날짜</th><th>가맹점</th><th>계정과목</th><th>사용자</th><th>금액</th></tr></thead>
        <tbody>
          {tx.map((t, i) => (
            <tr key={i}>
              <td>{t.d}</td>
              <td className="pp-strong">{t.m}</td>
              <td><span className="pp-tag pp-tag-n">{t.ac}</span></td>
              <td>{t.who}</td>
              <td className="pp-num">{t.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 정기 지출 (/payments) ────────────────────────────────────
export function PaymentsPanel() {
  const rows = [
    { n: "사무실 임차료", c: "고정비", amt: "₩1,800,000", d: "매월 25일", next: "07-25" },
    { n: "AWS 클라우드", c: "구독", amt: "₩1,240,000", d: "매월 23일", next: "08-23" },
    { n: "4대보험료", c: "인건비", amt: "₩5,320,000", d: "매월 10일", next: "08-10" },
    { n: "화재보험", c: "보험", amt: "₩180,000", d: "매월 5일", next: "08-05" },
    { n: "협업툴 구독", c: "구독", amt: "₩96,000", d: "매월 1일", next: "08-01" },
  ];
  return (
    <section className="pp glass-card" id="pp-payments">
      <PanelHead
        menu="자산관리 › 정기 지출"
        title="매달 나가는 돈을 놓치지 않아요"
        sub="반복 결제를 자동으로 찾아 등록을 추천하고, 결제일 전에 알려줘요"
        right={<span className="pp-badge pp-badge-p">월 ₩8,636,000</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>등록된 항목</span><b>14건</b></div>
        <div className="pp-mini"><span>고정비 비중</span><b>68%</b></div>
        <div className="pp-mini"><span>7일 내 결제</span><b>3건</b></div>
      </div>
      <div className="pp-section-t">정기 지출 목록</div>
      <table className="pp-table">
        <thead><tr><th>항목</th><th>분류</th><th>주기</th><th>다음 결제</th><th>금액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td><span className="pp-tag pp-tag-n">{r.c}</span></td>
              <td>{r.d}</td>
              <td>{r.next}</td>
              <td className="pp-num">{r.amt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">통장 거래에서 반복 결제 2건을 새로 찾았어요. 정기 지출로 등록할까요?</div>
    </section>
  );
}

// ── 대출 (/loans) ────────────────────────────────────────────
export function LoansPanel() {
  const rows = [
    { n: "기업운전자금", b: "기업은행", bal: "₩84,000,000", r: "4.8%", m: "₩1,420,000", st: "상환중" },
    { n: "정책자금 (창업)", b: "중소벤처진흥공단", bal: "₩38,500,000", r: "2.3%", m: "₩640,000", st: "상환중" },
    { n: "시설대출", b: "국민은행", bal: "₩0", r: "5.1%", m: "—", st: "완납" },
  ];
  return (
    <section className="pp glass-card" id="pp-loans">
      <PanelHead
        menu="자산관리 › 대출"
        title="상환 일정이 자금 예측에 반영돼요"
        sub="남은 원금과 월 납부액이 현금 흐름에 자동으로 들어가요"
        right={<span className="pp-badge pp-badge-p">잔액 ₩1억 2,250만</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>월 상환 합계</span><b>₩2,060,000</b></div>
        <div className="pp-mini"><span>평균 금리</span><b>3.9%</b></div>
        <div className="pp-mini"><span>연간 이자 추정</span><b>₩4,780,000</b></div>
      </div>
      <div className="pp-section-t">대출 목록</div>
      <table className="pp-table">
        <thead><tr><th>대출명</th><th>금융사</th><th>금리</th><th>월 납부액</th><th>잔액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n} <span className={`pp-tag pp-tag-${r.st === "완납" ? "s" : "n"}`}>{r.st}</span></td>
              <td>{r.b}</td>
              <td>{r.r}</td>
              <td className="pp-num">{r.m}</td>
              <td className="pp-num">{r.bal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">8월 10일 상환 ₩2,060,000이 예정돼 있어요. 자금 전망에 이미 반영했어요.</div>
    </section>
  );
}

// ── 자산 (/vault) ────────────────────────────────────────────
export function VaultPanel() {
  const rows = [
    { n: "노트북 (MacBook Pro 14)", t: "유형자산", who: "이준호", d: "2024-03-11", v: "₩2,890,000" },
    { n: "디자인 라이선스", t: "무형자산", who: "박서연", d: "2026-01-05", v: "₩720,000/년" },
    { n: "사무실 복합기", t: "유형자산", who: "공용", d: "2023-08-20", v: "₩1,240,000" },
    { n: "협업툴 계정 12석", t: "구독", who: "공용", d: "2026-02-01", v: "₩96,000/월" },
  ];
  return (
    <section className="pp glass-card" id="pp-vault">
      <PanelHead
        menu="자산관리 › 자산"
        title="회사 물건이 어디 있는지 알아요"
        sub="유형·무형 자산과 구독 계정을 담당자별로 관리해요"
        right={<span className="pp-badge pp-badge-p">총 64건</span>}
      />
      <div className="pp-grid3">
        <div className="pp-mini"><span>유형자산</span><b>31</b></div>
        <div className="pp-mini"><span>무형·라이선스</span><b>18</b></div>
        <div className="pp-mini"><span>미사용</span><b>4</b></div>
      </div>
      <div className="pp-section-t">자산 목록</div>
      <table className="pp-table">
        <thead><tr><th>자산명</th><th>구분</th><th>담당</th><th>취득일</th><th>가액</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td className="pp-strong">{r.n}</td>
              <td><span className="pp-tag pp-tag-n">{r.t}</span></td>
              <td>{r.who}</td>
              <td>{r.d}</td>
              <td className="pp-num">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pp-alert">30일 넘게 사용 기록이 없는 구독 4건을 찾았어요. 해지하면 월 ₩184,000을 아껴요.</div>
    </section>
  );
}
