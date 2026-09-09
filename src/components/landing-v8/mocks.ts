// 랜딩 v8 — 제품 화면 모형.
//   ⛔ 실제 캡처가 아니다. **전부 가상 회사 자료**로 손으로 그린 화면이다 (결정 220).
//      실제 거래처명·계좌번호·직원 이름은 여기에 들어오면 안 된다.
//   ▸ 색은 앱과 같은 값(--app-*)을 쓴다. 그 값은 landing-v8.css 의 .lp8 에 있다.
//   ▸ 문자열(HTML)로 만드는 이유: 목업(landing-v11.html)에서 그대로 옮겨 와
//     화면이 한 픽셀도 달라지지 않게 하기 위해서다. 사람 입력을 받지 않으므로 안전하다.

/* ══ 아이콘 — 여기서 그린 선 글리프 ══ */
export const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M17 8.5a3 3 0 010 5"/>',
  down: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
  receipt: '<path d="M5 3h14v18l-2.3-1.6L14.4 21l-2.4-1.6L9.6 21l-2.3-1.6L5 21z"/><path d="M9 8h6M9 12h6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l3 12h11l2-8H6"/>',
  link: '<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1"/><path d="M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>',
  check: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 12l3 3 5-6"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  book: '<path d="M4 4h10a3 3 0 013 3v13H7a3 3 0 01-3-3z"/><path d="M8 9h6"/>',
  folder: '<path d="M3 7h6l2 3h10v10H3z"/>',
  sign: '<path d="M3 18c4-1 6-12 10-12s3 8 8 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  spark: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
  bell: '<path d="M6 16V10a6 6 0 1112 0v6l2 3H4z"/><path d="M10 22h4"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
};

export const ic = (k: string, s = 22, w = 1.7) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

/* 표 한 줄 — [내용, 클래스, 너비] */
type Cell = [string, string?, string?];
const row = (cells: Cell[], cls = "") =>
  `<div class="ui-row ${cls}" style="grid-template-columns:${cells.map((c) => c[2] || "1fr").join(" ")}">${cells
    .map((c) => `<div class="${c[1] || ""}">${c[0]}</div>`)
    .join("")}</div>`;

/* ══ 수집·전표 ══ */
export const COLLECT = () => `<div class="ui" style="padding:12px 14px 14px">
  <div class="ui-bar"><span class="ui-chip on">채울 것 24</span><span class="ui-chip off">확정한 것</span><span class="ui-chip off">장부 제외</span>
    <span style="margin-left:auto;color:var(--app-ink-3)">고른 줄 <b style="color:var(--app-ink)">3건</b> · 합계 <b class="num" style="color:var(--app-ink)">₩4,182,000</b></span></div>
  ${row([["일자", "", "62px"], ["적요"], ["상대", "", "74px"], ["금액", "r", "80px"], ["계정과목 · 근거", "", "94px"], ["상태", "", "58px"]], "ui-head")}
  ${[
    ["09-07", "카드승인 그린식스", "신한 1234", "1,980,000", "매출채권", "장부 대조", "확인 대기", "st-b"],
    ["09-07", "입금 (주)하늘건설", "국민 5678", "2,450,000", "매출채권", "장부 대조", "확인 대기", "st-b"],
    ["09-06", "네이버클라우드", "신한 1234", "132,000", "지급수수료", "내가 배운 규칙", "확인 대기", "st-b"],
    ["09-06", "스마트스토어 정산", "국민 5678", "504,000", "상품매출", "국세청 조회", "확정", "st-c"],
    ["09-05", "온샘 디자인 세금계산서", "—", "3,850,000", "용역매출", "장부 대조", "확정", "st-c"],
    ["09-05", "사무실 임차료", "신한 1234", "1,200,000", "지급임차료", "내가 배운 규칙", "확정", "st-c"],
    ["09-04", "쿠팡 정산", "국민 5678", "303,000", "상품매출", "국세청 조회", "확정", "st-c"],
    ["09-04", "법인카드 주유", "법인카드", "88,000", "차량유지비", "AI 추천", "확인 대기", "st-b"],
  ]
    .map((r) =>
      row([
        [r[0], "num", "62px"],
        [`<b style="color:var(--app-ink)">${r[1]}</b>`],
        [r[2], "", "74px"],
        [r[3], "num r", "80px"],
        [`<span style="color:#4f46e5;font-weight:600">${r[4]}</span><div style="color:var(--app-ink-4);font-size:9px;line-height:1.3">${r[5]}</div>`, "", "94px"],
        [`<span class="st ${r[7]}">${r[6]}</span>`, "", "58px"],
      ]),
    )
    .join("")}
  <div style="margin-top:10px;display:flex;align-items:center;gap:10px;background:var(--app-bg-2);border-radius:8px;padding:9px 11px">
    <span style="color:var(--app-ink-3)">선택한 3건을 전표로 생성합니다</span>
    <span style="margin-left:auto;background:#4f46e5;color:#fff;border-radius:6px;padding:6px 14px;font-weight:700">확인</span></div>
</div>`;

/* ══ 부가세 신고서 ══ */
export const VAT = () => `<div class="ui" style="padding:10px 11px 11px">
  <div class="ui-bar"><span class="ui-chip on">부가세</span><span class="ui-chip off">원천세</span></div>
  <div style="font-weight:700;color:var(--app-ink);margin-bottom:6px">2기 예정 (7–9월)</div>
  ${[["① 세금계산서 발급분", "333,180,000"], ["매출세액", "33,318,000"], ["⑩ 세금계산서 수취분", "13,980,000"], ["공제 매입세액", "1,398,000"]]
    .map(([a, b]) => `<div style="display:grid;grid-template-columns:1fr 84px;gap:4px;padding:5px 0;border-bottom:1px solid var(--app-line-2)"><span>${a}</span><span class="num r">${b}</span></div>`)
    .join("")}
  <div style="display:grid;grid-template-columns:1fr 84px;gap:4px;padding-top:8px;font-weight:700;color:var(--app-ink)"><span>납부 예상</span><span class="num r" style="color:#dc2626">31,920,000</span></div>
  <div style="margin-top:11px;font-weight:700;color:var(--app-ink);margin-bottom:5px">신고 일정</div>
  ${[["부가세 2기 예정", "10월 25일", "D-46", "st-a"], ["원천세 (9월분)", "10월 10일", "D-31", "st-b"], ["법인세 중간예납", "10월 31일", "D-52", "st-a"]]
    .map(([a, b, c, st]) => `<div style="display:grid;grid-template-columns:1fr 64px 46px;gap:4px;padding:5px 0;border-bottom:1px solid var(--app-line-2);align-items:center"><span>${a}</span><span class="num r">${b}</span><span class="r"><span class="st ${st}">${c}</span></span></div>`)
    .join("")}
  <div style="margin-top:10px;background:var(--app-bg-2);border-radius:7px;padding:8px 10px;color:var(--app-ink-3);font-size:10px">확정한 전표에서 자동으로 반영되었습니다. 수정할 항목을 누르면 원본 전표로 이동합니다.</div>
</div>`;

/* ══ 이커머스 — 채널 주문 ══ */
export const CHANNELS = () => `<div class="ui">
  <div class="ui-bar"><span class="ui-chip on">현황</span><span class="ui-chip off">주문 가져오기</span><span class="ui-chip off">출고 처리</span></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
    ${[["기간 주문", "12건", ""], ["주문 금액", "807,000", ""], ["출고 대기", "4건", "#b45309"], ["배송 완료율", "33%", "#0f9d58"]]
      .map(([k, v, c]) => `<div style="border:1px solid var(--app-line);border-radius:9px;padding:9px 11px"><div style="color:var(--app-ink-4);font-size:10px">${k}</div><div class="num" style="font-size:17px;font-weight:700;color:${c || "var(--app-ink)"}">${v}</div></div>`)
      .join("")}
  </div>
  ${row([["채널"], ["주문", "r", "52px"], ["금액", "r", "76px"], ["평균", "r", "66px"], ["출고 대기", "r", "62px"]], "ui-head")}
  ${[["스마트스토어", "7", "504,000", "72,000", "2"], ["쿠팡", "5", "303,000", "60,600", "2"]]
    .map((r) => row([[r[0]], [r[1], "num r", "52px"], [r[2], "num r", "76px"], [r[3], "num r", "66px"], [r[4], "num r", "62px"]]))
    .join("")}
  <div style="margin-top:10px;font-weight:700;color:var(--app-ink);margin-bottom:4px">최근 주문</div>
  ${row([["주문번호", "", "118px"], ["채널", "", "86px"], ["품목"], ["수량", "r", "48px"], ["금액", "r", "76px"], ["상태", "", "58px"]], "ui-head")}
  ${[
    ["2026090701", "스마트스토어", "업무용 선물세트", "2", "98,000", "출고 대기", "st-b"],
    ["2026090702", "쿠팡", "모니터 받침대", "1", "27,000", "출고 대기", "st-b"],
    ["2026090601", "스마트스토어", "노트북 파우치", "3", "35,400", "배송중", "st-a"],
    ["2026090602", "쿠팡", "케이블 정리함", "5", "21,000", "배송완료", "st-c"],
    ["2026090501", "스마트스토어", "데스크 매트", "2", "33,000", "배송완료", "st-c"],
  ]
    .map((r) =>
      row([
        [r[0], "num", "118px"],
        [r[1], "", "86px"],
        [`<b style="color:var(--app-ink)">${r[2]}</b>`],
        [r[3], "num r", "48px"],
        [r[4], "num r", "76px"],
        [`<span class="st ${r[6]}">${r[5]}</span>`, "", "58px"],
      ]),
    )
    .join("")}
  <div style="margin-top:10px;background:var(--app-bg-2);border-radius:8px;padding:9px 11px;color:var(--app-ink-3)">주문을 수집하면 재고가 함께 반영되고, 정산 금액은 전표로 연결됩니다</div>
</div>`;

/* ══ 이익관리 ══ */
export const PROFIT = () => `<div class="ui">
  <div class="ui-bar"><span class="ui-chip on">종합</span><span class="ui-chip off">품목별</span><span class="ui-chip off">거래처·채널별</span></div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;padding:4px 2px 10px;border-bottom:1px solid var(--app-line)">
    <span>매출 <b class="num" style="color:var(--app-ink)">₩2,021,000</b></span>
    <span>매출원가 <b class="num" style="color:var(--app-ink)">₩1,092,700</b></span>
    <span>매출총이익 <b class="num" style="color:#0f9d58">₩928,300</b></span>
    <span>이익률 <b class="num" style="color:var(--app-ink)">45.9%</b></span></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-top:10px">
    <div><div style="font-weight:700;color:var(--app-ink);margin-bottom:6px">품목별 이익</div>
    ${[["업무용 선물세트", 100, "#4f46e5", "360,000"], ["입사 웰컴키트", 34, "#b45309", "122,500"], ["모니터 받침대", 29, "#0f9d8f", "105,000"], ["노트북 파우치", 28, "#c2410c", "102,000"], ["데스크 매트", 28, "#65a30d", "100,000"]]
      .map(([n, w, c, v]) => `<div style="display:grid;grid-template-columns:96px 1fr 62px;gap:6px;align-items:center;margin-bottom:7px"><span>${n}</span><span style="height:7px;border-radius:4px;background:#eef0f5;display:block"><i style="display:block;height:7px;width:${w}%;border-radius:4px;background:${c}"></i></span><span class="num r">${v}원</span></div>`)
      .join("")}
    </div>
    <div><div style="font-weight:700;color:var(--app-ink);margin-bottom:6px">일별 매출 · 원가 · 이익</div>
      <svg viewBox="0 0 230 108" style="width:100%;height:auto">
        <polyline points="8,30 44,50 80,41 116,46 152,25 188,92 224,23" fill="none" stroke="#4f46e5" stroke-width="2.4"/>
        <polyline points="8,66 44,75 80,70 116,73 152,63 188,92 224,61" fill="none" stroke="#b45309" stroke-width="2.4"/>
        <polyline points="8,71 44,80 80,75 116,78 152,68 188,92 224,66" fill="none" stroke="#0f9d8f" stroke-width="2.4"/>
        <line x1="6" y1="92" x2="226" y2="92" stroke="#e6e8f0" stroke-width="1"/></svg>
      <div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:var(--app-ink-4)">
        <span><i style="display:inline-block;width:8px;height:2px;background:#4f46e5;vertical-align:middle"></i> 매출</span>
        <span><i style="display:inline-block;width:8px;height:2px;background:#b45309;vertical-align:middle"></i> 원가</span>
        <span><i style="display:inline-block;width:8px;height:2px;background:#0f9d8f;vertical-align:middle"></i> 이익</span></div>
    </div>
  </div>
  <div style="margin-top:12px;background:var(--app-bg-2);border-radius:8px;padding:9px 11px;color:var(--app-ink-3)">품목별 이익을 바로 확인합니다. 항목을 누르면 해당 품목의 판매 내역이 열립니다.</div>
  </div>`;

/* ══ 매출 현황판 ══ */
export const BOARD = () => `<div class="ui" style="padding:12px 14px 14px">
  <div class="ui-bar"><span class="ui-chip on">이번 달</span><span class="ui-chip off">분기</span><span class="ui-chip off">올해</span><span style="margin-left:auto;color:var(--app-ink-4)">칸 편집 ＋</span></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
    ${[["매출", "₩40,880,000", "▲1%", "#0f9d58"], ["영업이익", "₩30,620,000", "이익률 74.9%", "#0f9d58"], ["채널 주문", "12건", "스마트스토어·쿠팡", ""], ["미수금", "₩8,240,000", "2건 연체", "#dc2626"]]
      .map(([k, v, s, c]) => `<div style="border:1px solid var(--app-line);border-radius:9px;padding:9px 11px">
        <div style="color:var(--app-ink-4);font-size:10px">${k}</div>
        <div class="num" style="font-size:16px;font-weight:700;color:var(--app-ink);margin-top:2px">${v}</div>
        <div style="font-size:10px;color:${c || "var(--app-ink-4)"};margin-top:2px">${s}</div></div>`)
      .join("")}
  </div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:10px">
    <div style="border:1px solid var(--app-line);border-radius:9px;padding:10px 11px">
      <div style="font-weight:700;color:var(--app-ink);margin-bottom:8px">월별 매출 · 목표</div>
      <svg viewBox="0 0 260 100" style="width:100%;height:auto">
        ${[54, 62, 48, 70, 58, 76, 66, 84, 72, 90, 80, 96].map((h, i) => `<rect x="${6 + i * 21}" y="${94 - h * 0.86}" width="12" height="${h * 0.86}" rx="2" fill="${i > 8 ? "#4f46e5" : "#c7cbf5"}"/>`).join("")}
        <line x1="4" y1="32" x2="256" y2="32" stroke="#b45309" stroke-width="1.4" stroke-dasharray="4 4"/>
        <text x="254" y="28" text-anchor="end" font-size="8" fill="#b45309">목표</text>
        <line x1="4" y1="94" x2="256" y2="94" stroke="#e6e8f0" stroke-width="1"/></svg></div>
    <div style="border:1px solid var(--app-line);border-radius:9px;padding:10px 11px">
      <div style="font-weight:700;color:var(--app-ink);margin-bottom:8px">미수금 오래된 순</div>
      ${[["(주)하늘건설", "2,450,000", "62일", "#dc2626"], ["누리클라우드", "2,300,000", "41일", "#b45309"], ["그린식스", "1,980,000", "18일", ""], ["온샘 디자인", "1,510,000", "9일", ""]]
        .map(([n, v, d, c]) => `<div style="display:grid;grid-template-columns:1fr 74px 40px;gap:6px;padding:5px 0;border-bottom:1px solid var(--app-line-2)"><span>${n}</span><span class="num r">${v}</span><span class="r" style="color:${c || "var(--app-ink-4)"}">${d}</span></div>`)
        .join("")}
    </div>
  </div></div>`;

/* ══ AI 가 계정과목을 채워 나가는 장면 — 줄이 위에서부터 하나씩 정리된다 ══ */
const SORT_ROWS = [
  ["09-07", "카드승인 그린식스", "신한 1234", "1,980,000", "매출채권", "장부 대조"],
  ["09-07", "입금 (주)하늘건설", "국민 5678", "2,450,000", "매출채권", "장부 대조"],
  ["09-06", "네이버클라우드", "신한 1234", "132,000", "지급수수료", "내가 배운 규칙"],
  ["09-06", "스마트스토어 정산", "국민 5678", "504,000", "상품매출", "국세청 조회"],
  ["09-05", "온샘 디자인 세금계산서", "—", "3,850,000", "용역매출", "장부 대조"],
  ["09-05", "사무실 임차료", "신한 1234", "1,200,000", "지급임차료", "내가 배운 규칙"],
  ["09-04", "쿠팡 정산", "국민 5678", "303,000", "상품매출", "국세청 조회"],
  ["09-04", "법인카드 주유", "법인카드", "88,000", "차량유지비", "AI 추천"],
];

export const SORTDEMO = () => `<div class="ui" style="padding:12px 14px 14px">
  <div class="ui-bar"><span class="ui-chip on">채울 것 ${SORT_ROWS.length}</span><span class="ui-chip off">확정한 것</span><span class="ui-chip off">장부 제외</span>
    <span style="margin-left:auto;color:var(--app-ink-3)">합계 <b class="num" style="color:var(--app-ink)">₩10,507,000</b></span></div>
  ${row([["일자", "", "64px"], ["적요"], ["상대", "", "86px"], ["금액", "r", "92px"], ["계정과목 · 근거", "", "108px"], ["상태", "", "62px"]], "ui-head")}
  ${SORT_ROWS.map(
    (r) => `<div class="ui-row sd-row" style="grid-template-columns:64px 1fr 86px 92px 108px 62px">
      <div class="num">${r[0]}</div>
      <div><b style="color:var(--app-ink)">${r[1]}</b></div>
      <div>${r[2]}</div>
      <div class="num r">${r[3]}</div>
      <div class="sd-acct"><span class="ph"></span><span class="val"><b>${r[4]}</b><i>${r[5]}</i></span></div>
      <div class="sd-st"><span class="st st-w">대기</span><span class="st st-b">확인 대기</span></div>
    </div>`,
  ).join("")}
  <div class="sd-bar" data-sd-bar><span>계정과목이 채워졌습니다. 확인하시면 전표가 됩니다</span><span class="go">확인</span></div>
</div>`;

/* ══ 영상 자리 — 앱 전체 화면이 넘어간다 (720×545 ≒ 오두 738×560) ══ */
const NAVS = ["대시보드", "통장", "수집·전표", "세금·증빙", "품목", "이커머스", "프로젝트", "결재 허브", "메신저", "구성원", "근태 관리"];

const SHELL = (menu: string, title: string, sub: string, inner: string) => `
<div style="display:grid;grid-template-columns:138px 1fr;height:545px;background:var(--app-bg-2);font-size:11px;color:var(--app-ink-3)">
  <aside style="background:#fff;border-right:1px solid var(--app-line);padding:10px 8px">
    <div style="display:flex;align-items:center;gap:6px;padding:2px 6px 12px;font-weight:800;color:var(--app-ink);font-size:12.5px">
      <i style="width:16px;height:16px;border-radius:5px;background:#4f46e5;display:block"></i>오너뷰</div>
    ${NAVS.map((n) => `<div style="padding:6px 8px;border-radius:6px;margin-bottom:1px;${n === menu ? "background:#eef0ff;color:#4f46e5;font-weight:700" : ""}">${n}</div>`).join("")}
  </aside>
  <div style="display:flex;flex-direction:column;min-width:0">
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#fff;border-bottom:1px solid var(--app-line)">
      <b style="color:var(--app-ink);font-size:13px">${title}</b><span style="color:var(--app-ink-4)">· ${sub}</span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:6px"><span style="color:var(--app-ink-4)">김대표</span>
        <i style="width:20px;height:20px;border-radius:50%;background:var(--app-bg-2);display:block"></i></span></div>
    <div style="flex:1;padding:10px;min-width:0;overflow:hidden">
      <div style="background:#fff;border:1px solid var(--app-line);border-radius:10px;height:100%;overflow:hidden">${inner}</div></div>
  </div></div>`;

export const CUTS: { cap: string; build: () => string }[] = [
  { cap: "통장·카드 내역 자동 수집", build: () => SHELL("수집·전표", "수집·전표", "채울 것 24건", COLLECT()) },
  { cap: "계정과목까지 자동 분류", build: () => SHELL("세금·증빙", "세금·증빙", "발행 대기 32건", PROFIT()) },
  { cap: "주문 수집과 동시에 재고 반영", build: () => SHELL("이커머스", "이커머스", "스마트스토어 · 쿠팡", CHANNELS()) },
  { cap: "신고서에 금액까지 자동 반영", build: () => SHELL("세금·증빙", "세무 신고", "2기 예정", VAT()) },
];
