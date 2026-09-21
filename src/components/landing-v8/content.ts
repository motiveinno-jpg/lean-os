// 랜딩 v8 — 문구·데이터 단일 출처.
//   화면(landing-v8.tsx)과 구조화 데이터(app/page.tsx)가 **같은 값**을 읽는다.
//   여기 없는 문구를 화면에 직접 적지 않는다 — 적으면 검색엔진에 보이는 값과 화면이 어긋난다.
//
//   ⚠️ 요금 문구는 DB(subscription_plans)와 맞춘다. 2026-09-09 확인:
//      free 0원 · 5석 고정(최대 5) / standard 39,000원 · 포함 5석 · 추가 1석 5,000원(상한 없음).
//      ultra 는 is_active=false 라 화면에 쓰지 않는다.
//      ⛔ "인원당 과금이 아닙니다" 라고 쓰지 않는다 — 6명째부터 1명당 5,000원이 실제로 붙는다.

import { CATALOG, MENU_COUNT, menuHref } from "./catalog";

export const HERO = {
  h1a: "회사 운영의 모든 것",
  h1b: "올인원 AI ERP, 오너뷰",
  lead: "회계, 재고, 인사, 업무를 한 체계로 묶었습니다. 업종을 가리지 않습니다.",
  ctaPrimary: "지금 무료로 시작하세요",
  ctaSecondary: "전문 상담 예약",
};

/* §1 메뉴 벽 — 32개(8×4). [그룹 key, 메뉴 key, 아이콘(mocks ic)] — 이름·주소는 catalog(앱 사이드바)에서 읽는다.
   2026-09-14 전에는 이름을 직접 적어 사이드바에 없는 이름이 4개 있었다
   (참모→AI 참모 · 분석·리포트→경영 요약 · 보안·감사→보안·시스템 · 회사 설정→회사 기초정보). 칸을 누르면 /features 그 메뉴로 간다. */
const WALL: [string, string, string][] = [
  ["home", "dashboard", "grid"], ["home", "copilot", "spark"], ["home", "notifications", "bell"], ["analysis", "summary", "chart"],
  ["finance", "bank", "swap"], ["finance", "cards", "card"], ["finance", "partners", "users"], ["finance", "collect", "down"],
  ["finance", "tax-invoices", "receipt"], ["finance", "voucher-entry", "edit"], ["finance", "sale-purchase", "file"], ["finance", "tax-filing", "receipt"],
  ["finance", "payments", "clock"], ["inventory", "products", "box"], ["inventory", "stock", "layers"], ["inventory", "orders", "clip"],
  ["inventory", "sales", "cart"], ["inventory", "purchase", "down"], ["inventory", "channels", "link"], ["inventory", "profit", "trend"],
  ["workspace", "projecthub", "brief"], ["workspace", "schedule", "cal"], ["workspace", "approvals", "check"], ["workspace", "chat", "msg"],
  ["workspace", "board", "book"], ["workspace", "signatures", "sign"], ["workspace", "documents", "folder"], ["hr", "employees", "users"],
  ["hr", "attendance", "clock"], ["hr", "hr-templates", "file"], ["company", "system", "shield"], ["company", "company", "gear"],
];
export const MENUS: { name: string; href: string; icon: string }[] = WALL.map(([g, m, icon]) => {
  const menu = CATALOG.find((x) => x.key === g)?.menus.find((x) => x.key === m);
  if (!menu) throw new Error(`landing-v8 MENUS: catalog 에 없는 메뉴 ${g}/${m}`); // 빌드에서 바로 드러나게
  return { name: menu.name, href: menuHref(g, m), icon };
});

/* 업종별 메가메뉴 — [세부 업종, 그 업종의 활용 페이지] (2026-09-16 2차)
   9/16 1차에서는 24항목이 업종군 7개 페이지로 모였다. 대표: 업종마다 각각 만들어라 →
   세부 업종 23곳이 각자 페이지를 갖고(내용·히어로 그림·본문 구성이 다르다) 여기서 바로 간다.
   세무·회계 사무소만 따로 만든 제휴 페이지(/tax-partners)가 있어 그대로 둔다. */
const I = (slug: string) => `/industries/${slug}`;
export const MEGA: [string, [string, string][]][] = [
  ["유통 · 판매", [
    ["온라인 판매(스마트스토어·쿠팡)", I("online-sales")], ["도소매", I("wholesale-retail")],
    ["무역·수입", I("import-trade")], ["매장 판매", I("store-retail")],
  ]],
  ["제조 · 생산", [
    ["소규모 제조", I("small-manufacturing")], ["식품 제조", I("food-manufacturing")],
    ["의류·패션 생산", I("apparel-manufacturing")], ["금속·부품 가공", I("metal-manufacturing")],
  ]],
  ["용역 · 프로젝트", [
    ["디자인 스튜디오", I("design-studio")], ["개발·SI", I("software-dev")],
    ["광고·마케팅 대행", I("marketing-agency")], ["컨설팅", I("consulting")],
  ]],
  ["건설 · 시공", [
    ["종합건설", I("general-construction")], ["인테리어 시공", I("interior-construction")],
    ["설비·전기", I("mep-construction")], ["조경", I("landscape-construction")],
  ]],
  ["전문 서비스", [["세무·회계 사무소", "/tax-partners"], ["노무·법무", I("hr-law-firm")],
    ["교육·학원", I("academy")], ["병의원", I("clinic")]]],
  ["그 밖에", [["프랜차이즈 본부", I("franchise")], ["비영리·협회", I("nonprofit")],
    ["물류·창고", I("warehouse-logistics")], ["렌탈·구독", I("rental-subscription")]]],
];

/* §7 대표 기능 아홉 — 도입 문의로 가장 많이 받은 것 */
export const FEATS: [string, string, string, string][] = [
  ["chart", "매출 대시보드 · 경영 현황판", "전표·판매채널·목표를 한 화면에. 배치는 사람마다 저장됩니다.", "재고 › 이익관리 › KPI 현황판"],  // 2026-09-14 「분석 › KPI 현황판」은 없는 자리였다
  // 2026-09-14 「회사 API 키로 주문을 직접 받아」 → 실제 회사 키로 검증 전(lib/channel-api.ts)이라 되는 것만 적는다
  ["cart", "스마트스토어·쿠팡 재고 연동", "채널 주문을 엑셀로 가져와 판매 출고와 재고까지 이어서 처리합니다.", "재고 › 이커머스"],
  ["brief", "프로젝트 관리 · 업무 협업툴", "표·칸반·캘린더·간트 네 가지 보기. 진행 단계는 직접 정합니다.", "업무 › 프로젝트"],
  ["cal", "회사 일정 관리 · 캘린더", "회사 전체 일정을 관리합니다. 반복 일정과 아침 알림을 지원합니다.", "업무 › 일정 / 할 일"],
  ["folder", "사내 문서보관함 · 파일 서버", "파일당 500MB, 이어올리기. 폴더 공개 범위 4단계와 버전 관리.", "업무 › 파일보관함"],
  ["clock", "근태관리 · 급여 프로그램 · 연차 관리", "출퇴근·연장·연차가 급여명세서에 그대로 반영됩니다.", "인사 › 근태 관리"],
  ["receipt", "회계 프로그램 · 부가세 신고", "수집한 거래가 전표로 생성되고, 월결산과 신고서까지 넘어갑니다.", "재무 › 세무 신고"],
  ["book", "사내 게시판 · 업무 매뉴얼", "공지·매뉴얼·교육자료·자유 게시판으로 분류합니다.", "업무 › 게시판"],
  ["msg", "사내 메신저 · 그룹웨어", "1:1·그룹·멘션·파일 첨부. 대화가 자료와 함께 기록됩니다.", "업무 › 메신저"],
];

/* §6 AI가 먼저 해 두는 일 — 옛 /ai 페이지(AI_AUTOMATION 7가지)를 메인으로 옮겼다 (2026-09-14, 결정 233 · /ai → /#ai 308)
   [아이콘, 이름, 판단 근거, 설명, 그룹 key, 메뉴 key]
   ▸ 전부 동작 중인 기능만(옛 목록 머리주석 — 08-25 「계약 갱신 알림」은 미동작이라 뺐다).
   ▸ 판단 근거를 적는다 — 전부 "AI"라고 뭉뚱그리면 틀렸을 때 원인을 엉뚱한 데서 찾는다(조회 화면 표준의 출처 규칙).
   ▸ 휴면 감지는 거래처만 — 프로젝트 쪽은 v3 에 없다. 옛 「4개 엔진」 묶음(옛 보험 요율·"CFO 대체" 문구)은 옮기지 않았다. */
export const AI_TASKS: [string, string, string, string, string, string][] = [
  ["spark", "AI 참모", "AI 답변", "회사 실데이터를 근거로 지금 무엇을 먼저 할지 결론과 할 일로 답합니다.", "home", "copilot"],
  ["edit", "계정과목 추천", "AI 추천 · 배운 규칙", "통장·카드·세금계산서를 읽고 계정과목을 추천합니다. 고친 내용은 규칙으로 학습합니다.", "finance", "collect"],
  ["bell", "AI 브리핑", "AI 요약", "매일 아침 잔액·미수금·마감 일정을 분석해 오늘의 우선순위 업무를 정리합니다.", "home", "dashboard"],
  ["swap", "매칭 제안", "장부 대조", "세금계산서와 통장 입금을 거래처·금액으로 맞춰 후보를 제안합니다. 확정하면 전표와 미수금이 함께 갱신됩니다.", "finance", "collect"],
  ["check", "중복 의심 감지", "장부 대조", "같은 거래가 두 번 기표된 것 같으면 표시합니다. 확인한 뒤 지우면 됩니다.", "finance", "voucher-entry"],
  ["trend", "자금 부족 예측", "예정 입출금 계산", "날짜가 정해진 예정 입출금으로 잔액 곡선을 그리고, 가장 낮아지는 날을 미리 알려 드립니다.", "analysis", "outlook"],
  ["users", "휴면 거래처 감지", "거래 기록", "한동안 거래가 없는 거래처를 찾아 리마인더를 보낼 수 있게 합니다.", "finance", "partners"],
];

/* §8 기존 ERP와 다른 점 — [항목, 흔한 ERP, 오너뷰(HTML 강조 허용)] */
export const COMPARE: [string, string, string][] = [
  ["요금제", "기능별로 요금제를 나누어 판매하는 경우가 많습니다", "유료 플랜은 하나입니다. <b>모든 기능을 그대로</b> 사용하실 수 있습니다"],
  ["시작", "도입비와 약정이 붙는 경우가 많습니다", "<b>신용카드 없이 바로 시작</b>합니다. 무료 플랜은 계속 무료로 사용하실 수 있습니다"],
  ["회계 · 세무", "회계 프로그램을 별도로 구매해야 합니다", "수집부터 전표, 월결산, <b>부가세·원천세 신고 자료까지</b> 한 곳에서 처리합니다"],
  ["세무사 협업", "원장이나 전표를 메일로 주고받아야 합니다", "제휴 세무사가 <b>같은 화면</b>을 봅니다"],
  ["자료 내려받기", "해지 후 자료 접근이 제한되는 경우가 있습니다", "거래·거래처·전표를 <b>언제든 엑셀로</b> 내려받습니다. 해지 후에도 동일합니다"],
];

/* §9 숫자 */
export const FIGURES: [string, string][] = [
  [String(MENU_COUNT), "메뉴가 하나의 자료를 공유합니다"],  // 2026-09-14 「32」 고정값 → catalog 에서 셈(사이드바 기준 51)
  ["39,000원", "정상가 80,000원 → 51% 할인 중 · 기본 5명 포함 · 추가 1명당 5,000원"],
  ["0원", "무료 플랜은 카드 등록 없이 계속"],
  ["월 100건", "세금계산서·현금영수증 발행 (유료 플랜)"],
];

/* 관련 검색어 — [검색어, 그 일을 다루는 공개 페이지] (2026-09-14 링크 복구)
   ▸ 계산기·요금·세무사·블로그 글이 있는 주제는 그 페이지로, 나머지는 /features 의 해당 메뉴.
   ▸ 메뉴 주소는 catalog 의 메뉴 key 로 만든다(같은 날 3단계 — 순번을 적던 것을 key 로. catalog 에 없는 key 면 첫 메뉴로 열린다). */
export const TOPICS: [string, string][] = [
  ["중소기업 ERP", "/blog/smb-erp-guide"],
  ["올인원 ERP", "/features"],
  ["클라우드 ERP", "/features"],
  ["회계 프로그램", "/blog/accounting-program-vs-all-in-one-erp"],
  ["부가세 신고", menuHref("finance", "tax-filing")],
  ["전자세금계산서 발행", menuHref("finance", "tax-invoices")],
  ["홈택스 연동", menuHref("finance", "collect")],
  ["은행 자동 연동", menuHref("finance", "bank")],
  ["카드 내역 자동 수집", menuHref("finance", "cards")],
  ["근태관리 프로그램", menuHref("hr", "attendance")],
  ["급여 프로그램", menuHref("hr", "employees")],
  ["연차 관리", menuHref("hr", "attendance")],
  ["퇴직금 계산기", "/tools/severance-calculator"],
  ["4대보험 계산기", "/tools/insurance-calculator"],
  ["실수령액 계산기", "/tools/salary-calculator"],
  ["재고관리 프로그램", menuHref("inventory", "stock")],
  ["재고 원가 관리", menuHref("inventory", "profit")],
  ["스마트스토어 연동", menuHref("inventory", "channels")],
  ["쿠팡 연동", menuHref("inventory", "channels")],
  ["프로젝트 관리 툴", menuHref("workspace", "projecthub")],
  ["전자결재", menuHref("workspace", "approvals")],
  ["사내 메신저", menuHref("workspace", "chat")],
  ["그룹웨어", menuHref("workspace", "schedule")],
  ["문서보관함", menuHref("workspace", "documents")],
  ["전자계약", menuHref("workspace", "signatures")],
  ["ERP 도입 비용", "/pricing"],
  ["세무사 제휴", "/tax-partners"],
];

export const PRICING = {
  amount: 39000,
  listAmount: 80000,   // 정상가(취소선). 청구는 amount

  seatsIncluded: 5,
  perSeat: 5000,
  note: "VAT 별도 · 기본 5명 포함 · 추가 1명당 5,000원",
  free: {
    name: "무료",
    note: "카드 등록 없이 계속 무료",
    features: [
      "구성원 5명 · 저장공간 500MB",
      "통장·카드 3개 연결 · 하루 2회 자동 동기화",
      "세금계산서 발행 월 5건 · 전자계약 월 5건",
      "프로젝트·일정·게시판·메신저·파일보관함 무제한",
      "결재 허브·근태·급여 무제한",
    ],
  },
  paid: {
    name: "오너뷰",
    features: [
      "통장·카드 무제한 연결 · 하루 2회 자동 수집 + 필요할 때 바로 수집",
      //   2026-09-21 정직화 — 홈택스는 자동 크론이 없다(버튼 한 번, 유료는 횟수 제한 없음). "자동" 이라 적지 않는다
      "홈택스 수집(무제한) · 부가세·원천세 신고 자료",
      "저장공간 500MB + 추가 1명당 10GB · 팩(+10GB) 5,000원",  // 2026-09-14 「인원당」 정정 — 쿼터 = 기본 + (추가좌석+팩)×10GB
      "세금계산서 발행 월 100건 · 전자계약 무제한",
      "AI 브리핑 매일 · AI 대표 참모 월 50만 토큰",
    ],
  },
};

/* /pricing 「따로 구독할 때와 비교」 — 옛 landing/content.ts COMPETITORS 를 그대로 옮겼다(2026-09-14).
   ⚠️ 회사명(브랜드)은 넣지 않는다. 마스킹해도 특정 가능하면 비교광고 분쟁 소지가 있다.
   가격은 각 분야의 공개 요금 기준 참고치이며, 특정 업체를 지목하지 않는다. */
export const COMPETITORS: { cat: string; price: number; perSeat: boolean }[] = [
  { cat: "HR/급여", price: 70000, perSeat: true },
  { cat: "프로젝트", price: 16000, perSeat: true },
  { cat: "전자계약", price: 39900, perSeat: false },
  { cat: "CRM", price: 4900, perSeat: true },
  { cat: "채팅", price: 120000, perSeat: false },
  { cat: "근태", price: 4000, perSeat: true },
  { cat: "세무", price: 33000, perSeat: false },
];

export const FOOTER = {
  company: "(주)모티브이노베이션 · 대표 채희웅 · 사업자등록번호 155-88-02209",
  addr: "경기 화성시 동탄구 동탄첨단산업1로 27 IX타워 A동 2514호",
  email: "creative@mo-tive.com",
  links: [
    { label: "이용약관", href: "/terms" },
    { label: "개인정보처리방침", href: "/privacy" },
    { label: "환불 정책", href: "/refund" },
    { label: "보안", href: "/security" },
    { label: "서비스 상태", href: "/status" },
  ],
};

/* 상담 요청 — 2026-09-14 전용 화면(/contact)으로 옮겼다.
   그전에는 mailto 라 신청이 회사에 남지 않았고, 메일 앱이 없는 PC 에서는 버튼이 아무 일도 안 했다. */
export const CONSULT_HREF = "/contact";

/* 가입 버튼 — /auth 는 로그인 탭이 먼저라, 가입 버튼은 회원가입 탭으로 연다 (2026-09-14). 로그인 버튼은 그냥 /auth */
export const SIGNUP_HREF = "/auth?mode=signup";

/* /contact 상담 신청 — 고르는 값은 서버(api/partnership)가 같은 목록으로 한 번 더 거른다 */
export const CONTACT = {
  h1: "도입 상담 신청",
  lead: ["회사의 업무 방식을 알려 주세요.", "필요한 메뉴와 요금을 정리해 연락드립니다."] as [string, string],
  steps: [
    ["신청", "필수 항목만 채워도 신청할 수 있습니다."],
    ["연락", "영업일 기준 1일 이내에 연락드립니다."],
    ["안내", "메뉴 구성, 자료 이전, 요금을 안내합니다."],
  ] as [string, string][],
  sizes: ["1~5명", "6~20명", "21~50명", "51명 이상"],
  interests: ["회계 · 세무", "통장 · 카드 수집", "재고 · 이커머스", "인사 · 급여", "프로젝트 · 협업", "전자계약 · 결재"],
  consent: [
    ["수집 항목", "회사명, 담당자명, 이메일, 연락처"],
    ["이용 목적", "도입 상담 회신"],
    ["보유 기간", "상담 목적 달성 후 지체 없이 파기"],
  ] as [string, string][],
};
