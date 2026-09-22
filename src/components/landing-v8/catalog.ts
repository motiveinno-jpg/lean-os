// 공개 페이지 메뉴 목록 — **앱 사이드바(components/sidebar.tsx NAV_GROUPS)를 그대로 옮긴 것** (2026-09-14, 결정 228)
//
//   전에는 목록이 세 벌이었다: 옛 CATALOG(components/landing/content.ts, 08-20 사이드바 기준) · v8 MENUS · TOPICS 순번.
//   그 뒤 사이드바가 바뀌어(재고 그룹·이익관리·고정자산·세무 신고·지원사업추천, 그룹명 재무·업무·인사·설정)
//   /features 와 /demo 가 없는 이름을 광고하고 있었다.
//
//   ▸ 그룹·메뉴 이름과 차례 = 사이드바. 마스터 전용(마스터)은 뺀다. 설정은 lib/settings-nav.ts SETTINGS_GROUPS 5개 + 요금제.
//   ▸ 사이드바를 바꾸면 여기도 같이 고친다 → `node scripts/check-landing-catalog.mjs` 가 어긋난 줄을 찍는다.
//   ▸ key(그룹) = 옛 주소 그대로(`/features/?g=finance` 등, 검색 색인·sitemap). 이름만 사이드바를 따른다.
//   ▸ m = 메뉴 key. 옛 숫자 m 은 legacy(옛 CATALOG 차례)로 새 key 에 잇는다 — 공유된 링크가 엉뚱한 메뉴를 열지 않게.
//   ▸ src = 제품 화면 캡처(public/product). null = 아직 없음 → 화면 자리 없이 설명만 보인다.
//     ⚠️ 캡처는 QA 시드 회사(가상)에서만 찍는다(결정 220).
//   ▸ 문구 = 합니다체(랜딩 어체). 기능 설명은 그 화면 코드 머리주석에서 확인한 것만 적었다.

export type Menu = {
  key: string;
  name: string;
  href: string;          // 앱 안 주소(사이드바 href) — 대조 스크립트가 쓴다
  icon: string;
  src: string | null;
  desc: string;
  items: string[];
};

export type Group = {
  key: string;
  name: string;
  short: string;
  icon: string;
  lead: string;
  menus: Menu[];
  legacy?: string[];     // 옛 CATALOG 의 메뉴 차례 → 새 key
};

const shot = (f: string) => `/product/${f}.png`;

export const CATALOG: Group[] = [
  {
    key: "home", name: "홈", short: "홈", icon: "chart",
    lead: "로그인하면 오늘의 우선순위 업무부터 보여 드립니다.",
    legacy: ["dashboard", "notifications", "mypage", "copilot"],
    menus: [
      { key: "dashboard", name: "대시보드", href: "/dashboard", icon: "chart", src: shot("f-dashboard-v5"),
        desc: "잔액·손익·미수금·세금 일정을 신호로 보고, 오늘 할 일을 AI가 순서대로 정리합니다.",
        items: ["통장·손익·미수금 신호", "AI 오늘의 우선순위 업무", "위젯 골라 담기·크기 조절", "보기 설정 저장"] },
      { key: "notifications", name: "알림", href: "/notifications", icon: "mail", src: shot("f-notifications-v2"),
        desc: "결재·입금·계약·세금 일정이 알림으로 모입니다.",
        items: ["결재·서명 요청", "입금·미수금 알림", "세금 일정 사전 안내", "안 읽은 알림만 보기"] },
      { key: "mypage", name: "마이페이지", href: "/mypage", icon: "user", src: shot("f-mypage-v2"),
        desc: "출퇴근부터 연차·급여명세·증명서까지 내 기록만 모아 봅니다.",
        items: ["오늘 출퇴근·주간 근무", "연차 잔여·휴가 신청", "급여명세·근로계약 확인", "재직·경력증명서 신청"] },
      { key: "copilot", name: "AI 참모", href: "/copilot", icon: "chat", src: shot("f-ai-copilot-v7"),
        desc: "회사 실데이터를 근거로 지금 무엇을 먼저 할지 답합니다.",
        items: ["실데이터 기반 답변", "미수금 회수 우선순위", "화면 위치 안내", "확정은 대표님이"] },
      { key: "support-programs", name: "지원사업추천", href: "/support-programs", icon: "gift", src: shot("f-support-programs-v1"),
        desc: "회사 자료로 받을 수 있는 정부 지원 제도를 골라 예상 지원 금액까지 계산합니다.",
        items: ["고용장려금·세액공제 등 상시 제도", "직원 자료로 자격 판정", "예상 지원 금액 계산", "담기·진행 상태 관리"] },
    ],
  },
  {
    key: "inventory", name: "재고", short: "재고", icon: "box",
    lead: "물건이 들어오고 나가는 흐름을 한곳에서 관리합니다.",
    legacy: ["products", "stock", "orders", "sales", "purchase", "production", "channels"],
    menus: [
      { key: "products", name: "품목", href: "/inventory/products", icon: "box", src: shot("f-inv-products-v2"),
        desc: "파는 것을 한 번만 등록하면 재고·판매·구매·생산이 같은 품목을 씁니다.",
        items: ["SKU·규격·단위", "판매가·원가", "안전재고 설정", "수량 안 세는 품목 구분"] },
      { key: "stock", name: "창고관리", href: "/inventory/stock", icon: "layers", src: shot("f-inv-stock-v4"),
        desc: "품목별 현재 수량과 안전재고보다 모자란 품목을 한눈에 봅니다.",
        items: ["창고별 현재고", "안전재고 대비 상태", "움직인 이력 추적", "실사(재고조사)로 차이 조정"] },
      { key: "orders", name: "주문", href: "/inventory/orders", icon: "doc", src: shot("f-inv-orders-v2"),
        desc: "견적과 주문을 한 서식으로 작성합니다. 주문서는 재고를 움직이지 않습니다.",
        items: ["견적·주문 한 서식", "직접 만든 칸 추가", "공급가액·부가세 저장", "판매·구매·생산으로 불러오기"] },
      { key: "sales", name: "판매", href: "/inventory/sales", icon: "trend", src: shot("f-inv-sales-v2"),
        desc: "주문서를 불러와 저장하면 그때 재고가 빠집니다. 나눠서 출고해도 남은 수량을 셉니다.",
        items: ["주문서 불러오기", "부분 출고 관리", "미출고 잔량 추적", "저장 시 재고 자동 반영"] },
      { key: "purchase", name: "구매", href: "/inventory/purchase", icon: "drive", src: shot("f-inv-purchase-v3"),
        desc: "발주한 수량과 실제 입고 수량을 맞춰 보고, 모자란 품목을 찾아 채웁니다.",
        items: ["발주 등록·입고 진행률", "미입고 수량 집계", "모자란 품목 자동 채우기", "저장 시 재고 자동 반영"] },
      { key: "production", name: "생산", href: "/inventory/production", icon: "factory", src: shot("f-inv-production-v2"),
        //   2026-09-22 정직화 — 작업지시 화면은 없다. 주문서를 불러와 완성 수량을 저장하면 자재가 빠지고 완제품이 든다(production 머리 주석).
        desc: "자재구성(BOM)을 정해 두면 주문서를 불러와 완성 수량만 저장해도 자재가 빠지고 완제품이 입고됩니다.",
        items: ["자재구성(BOM) 등록", "주문서 불러와 완성 처리", "자재 자동 차감", "완제품 자동 입고"] },
      // 이커머스: 엑셀 붙여넣기가 기본(결정 18). 채널 API 가져오기는 코드가 있으나 실제 회사 키로 검증 전(lib/channel-api.ts 머리주석).
      { key: "channels", name: "이커머스", href: "/inventory/channels", icon: "link", src: shot("f-inv-channels-v2"),
        desc: "판매채널 주문을 엑셀로 붙여넣어 가져옵니다. 같은 주문은 두 번 들어가지 않습니다.",
        items: ["주문 엑셀 붙여넣기", "중복 주문 자동 차단", "채널 상품코드 ↔ SKU 연결", "가져온 이력 조회"] },
      { key: "inventory-status", name: "현황", href: "/inventory/status", icon: "chart", src: shot("f-inv-status-v1"),
        desc: "주문·판매·구매·생산을 한 화면에서 집계와 그래프로 봅니다.",
        items: ["주문 진행률·납기 지남", "판매·매입 집계(반품 차감)", "자재 부족 예상", "채널별 판매 비중"] },
      { key: "profit", name: "이익관리", href: "/inventory/profit", icon: "trend", src: shot("f-inv-profit-v1"),
        desc: "출고 원가를 반영한 판매 이익과 손실을 품목·거래처·채널별로 봅니다.",
        items: ["출고 원가(FIFO·이동평균)", "품목·거래처·채널별 이익", "폐기·감모 손실", "원가 미확정 건 따로 표시"] },
    ],
  },
  {
    key: "finance", name: "재무", short: "재무", icon: "wallet",
    lead: "돈이 들어오고 나가는 흐름과 장부를 한곳에서 관리합니다.",
    legacy: ["bank", "cards", "partners", "collect", "tax-invoices", "voucher-entry", "sale-purchase", "payments"],
    menus: [
      { key: "bank", name: "통장", href: "/bank", icon: "bank", src: shot("f-bank2-v5"),
        desc: "은행 계좌를 연결하면 잔액과 거래 내역이 자동으로 들어옵니다.",
        items: ["계좌별 잔액·총자산", "거래 내역 자동 수집", "수금 매칭·계좌 이동 정리", "하루 2회 자동 동기화"] },
      { key: "cards", name: "카드", href: "/cards", icon: "card", src: shot("f-cards-v5"),
        desc: "법인카드 승인 내역을 자동으로 모읍니다.",
        items: ["카드별 사용액", "승인 내역 자동 수집", "한도 대비 사용률", "사용자별 집계"] },
      { key: "partners", name: "거래처", href: "/partners", icon: "users", src: shot("f-partners-v5"),
        desc: "거래처마다 프로젝트·계약·매출 이력이 자동으로 쌓입니다.",
        items: ["거래처 관리·원장 연결", "사업자번호 자동 조회", "휴면 거래처 감지", "파트너 포털 초대"] },
      { key: "collect", name: "수집·전표", href: "/collect", icon: "drive", src: shot("f-bank-v5"),
        desc: "세금계산서·현금영수증·카드·통장 자료를 한 번에 받아 그 자리에서 전표로 만듭니다.",
        items: ["한 번에 수집(전부·선택)", "미처리 건수 한눈에", "계정 자동 추천·학습", "통장 수금 매칭"] },
      { key: "tax-invoices", name: "세금·증빙", href: "/tax-invoices", icon: "receipt", src: shot("f-tax-v5"),
        desc: "세금계산서와 현금영수증을 발행하고 매입·매출 자료를 모읍니다.",
        items: ["세금계산서 발행", "매입·매출 자료 수집", "현금영수증 발행", "수정 세금계산서"] },
      { key: "voucher-entry", name: "일반전표", href: "/partners/reconciliation/voucher-entry", icon: "pen", src: shot("f-voucher-v5"),
        desc: "통장 거래를 불러와 차변·대변으로 기표합니다. 합계가 맞지 않으면 저장되지 않습니다.",
        items: ["통장·카드 불러오기", "차·대변 자동 검증", "중복 의심 전표 감지", "계정과목 사전 관리"] },
      { key: "sale-purchase", name: "매입매출전표", href: "/partners/reconciliation/sale-purchase", icon: "sheet", src: shot("f-salepurchase-v2"),
        desc: "세금계산서·카드·현금영수증을 부가세 유형과 함께 기표합니다.",
        items: ["부가세 유형 10종", "매입·매출 구분", "수정세금계산서(음수) 입력", "월 마감(잠금)"] },
      { key: "assets", name: "고정자산", href: "/finance/assets", icon: "box", src: shot("f-assets-v1"),
        desc: "장비·차량·소프트웨어를 등록하면 달마다 감가상각 전표 초안을 만듭니다.",
        items: ["자산 등록·처분", "월 감가상각 전표 초안", "확정은 사람이 전표에서", "상각 누계"] },
      { key: "tax-filing", name: "세무 신고", href: "/finance/tax-filing", icon: "receipt", src: shot("f-tax-filing-v1"),
        desc: "원천세·부가세 신고서를 급여·전표 자료로 채웁니다. 제출은 홈택스에서 직접 합니다.",
        items: ["원천징수이행상황신고서", "부가세 신고서 준비", "지급명세서", "신고 기한·세무사 전달 엑셀"] },
      { key: "payments", name: "정기 지출", href: "/payments", icon: "repeat", src: shot("f-payments-v5"),
        desc: "매달 나가는 돈을 찾아 등록을 추천하고, 결제일 전에 알려 드립니다.",
        items: ["반복 결제 자동 감지", "다음 결제일 알림", "고정비 비중 분석", "자금 전망에 반영"] },
      { key: "finance-status", name: "현황", href: "/finance/status", icon: "chart", src: shot("f-finance-status-v1"),
        desc: "작성된 전표를 상태·종류·출처별로 집계하고, 처리할 전표를 모아 봅니다.",
        items: ["확정·대기·반려 현황", "일반·매입매출 구분", "규칙 자동 처리 비율", "전표 없는 증빙 건수"] },
    ],
  },
  {
    key: "workspace", name: "업무", short: "업무", icon: "briefcase",
    lead: "일이 시작돼 끝날 때까지 사람과 문서가 함께 움직입니다.",
    legacy: ["schedule", "projecthub", "approvals", "board", "chat", "signatures", "documents"],
    menus: [
      { key: "schedule", name: "일정 / 할 일", href: "/schedule", icon: "calendar", src: shot("f-schedule-v5"),
        desc: "회사 일정과 내 할 일을 한 화면에서 봅니다.",
        items: ["회사 공유 일정", "나만 보는 개인 일정", "할 일 우선순위", "프로젝트 마감 연동"] },
      { key: "projecthub", name: "프로젝트", href: "/projecthub", icon: "briefcase", src: shot("f-projects-v6"),
        desc: "표·칸반·캘린더·간트 네 가지 보기로 프로젝트를 관리합니다. 진행 단계는 직접 정합니다.",
        items: ["표·칸반·캘린더·간트", "진행 단계 직접 설정", "담당자·마감·첨부", "견적에서 정산까지"] },
      { key: "approvals", name: "결재 허브", href: "/approvals", icon: "check", src: shot("f-approvals-v5"),
        desc: "경비·지출·휴가·구매·연장근무 요청이 하나의 결재함에 모입니다.",
        items: ["내 결재함·내 요청", "다단계 결재선", "일괄 승인·선택 반려", "결재 양식 만들기"] },
      { key: "board", name: "게시판", href: "/board", icon: "board", src: shot("f-board-v5"),
        desc: "공지와 부서 게시글을 같은 시스템 안에서 관리합니다.",
        items: ["전사 공지·고정", "댓글·첨부·투표", "읽음 현황 확인"] },
      { key: "chat", name: "메신저", href: "/chat", icon: "chat", src: shot("f-chat-v5"),
        desc: "프로젝트마다 전용 채널이 열리고, 외부 파트너도 초대할 수 있습니다.",
        items: ["프로젝트·팀·1:1 채널", "파일 공유·멘션", "외부 파트너 초대"] },
      { key: "signatures", name: "전자계약", href: "/signatures", icon: "sign", src: shot("f-contract-v5"),
        desc: "계약서 작성부터 서명·보관까지 한 흐름으로 끝냅니다.",
        items: ["서식·템플릿", "직인 자동 합성", "발송·열람·서명 추적", "열람 전 발송 취소"] },
      { key: "documents", name: "파일보관함", href: "/documents", icon: "folder", src: shot("f-documents-v5"),
        desc: "회사 서류를 폴더로 나눠 권한에 맞게 보관합니다.",
        items: ["폴더·권한 관리", "드래그 업로드", "용량·종류 관리", "통합 검색"] },
      { key: "team", name: "구성원 디렉토리", href: "/team", icon: "users", src: shot("f-team-v2"),
        desc: "누가 어느 부서에 있는지 목록과 조직도로 봅니다.",
        items: ["부서별 목록", "조직도 보기", "연락처 검색", "조직도 이미지 내보내기"] },
    ],
  },
  {
    key: "hr", name: "인사", short: "인사", icon: "user",
    lead: "입사부터 급여까지 사람에 대한 기록이 끊기지 않습니다.",
    legacy: ["employees", "attendance", "hr-templates"],
    menus: [
      { key: "employees", name: "구성원", href: "/employees", icon: "user", src: shot("f-members-v5"),
        desc: "부서·직급·입사일을 관리하고, 급여는 4대보험·원천세까지 자동으로 계산합니다.",
        items: ["구성원 등록·상세", "4대보험·원천세 자동 계산", "급여 배치·명세서 발송", "메뉴별 권한 부여"] },
      { key: "attendance", name: "근태 관리", href: "/attendance", icon: "clock", src: shot("f-hr-v7"),
        desc: "출퇴근·연차·연장근무가 자동으로 집계됩니다.",
        items: ["원클릭 출퇴근", "연차 발생·사용 이력", "주 52시간 사용률", "여러 달 조회·엑셀"] },
      { key: "hr-templates", name: "근로계약·서식", href: "/hr-templates", icon: "file", src: shot("f-templates-v5"),
        desc: "근로계약서를 서식으로 만들고 전자서명으로 받습니다.",
        items: ["변수 치환 서식", "계약 발송·서명 현황", "직원 기록 연동"] },
    ],
  },
  {
    key: "analysis", name: "분석", short: "분석", icon: "trend",
    lead: "현재 경영 현황과 향후 자금 흐름을 숫자로 확인합니다.",
    legacy: ["summary", "profit-report", "outlook", "statements", "ledger", "vat"],
    menus: [
      { key: "summary", name: "경영 요약", href: "/reports/summary", icon: "chart", src: shot("f-acct-v5"),
        desc: "자금·손익·채권·채무 현황과 이번 주 To-do를 한 장에 모읍니다.",
        items: ["통장·손익·원장 세 기준", "이번 주 To-do", "전표 미처리 건수 표시", "엑셀·인쇄"] },
      { key: "profit-report", name: "손익 현황", href: "/reports/profit", icon: "trend", src: shot("f-profit-v2"),
        desc: "확정 전표 기준으로 손익계산서와 같은 숫자를 봅니다.",
        items: ["매출·원가·판관비 구조", "전월·전년 자동 비교", "셀 클릭 → 원천 전표", "월별 표·엑셀"] },
      { key: "outlook", name: "자금 전망", href: "/reports/outlook", icon: "clock", src: shot("f-flow-v5"),
        desc: "날짜가 정해진 예정 입출금을 반영해 앞으로의 잔액 곡선을 그립니다.",
        items: ["예정 잔액 곡선", "최저점·부족 시점 경고", "주 단위 자금 달력", "시나리오 조정"] },
      { key: "statements", name: "회계 자료", href: "/reports/statements", icon: "file", src: shot("f-statements-v2"),
        desc: "손익계산서·재무상태표 같은 정식 재무제표를 뽑습니다.",
        items: ["손익계산서", "재무상태표", "비용 분석", "전기 비교·CSV·인쇄"] },
      { key: "ledger", name: "거래처 원장", href: "/partners/ledger", icon: "book", src: shot("f-ledger-v2"),
        desc: "거래처별 채권·채무 잔액을 한 장부로 봅니다.",
        items: ["거래처별 잔액", "미수 경과 구간 분석", "월계·누계·차액 마감", "엑셀 내보내기"] },
      { key: "vat", name: "부가세", href: "/reports/vat", icon: "won", src: shot("f-vat-v2"),
        desc: "매출·매입 세액을 모아 신고 기간별 예상 납부세액을 미리 봅니다.",
        items: ["기간별 매출·매입 세액", "예상 납부세액", "증빙 누락 점검", "신고 자료 집계"] },
    ],
  },
  {
    key: "company", name: "설정", short: "설정", icon: "sheet",
    lead: "회사 정보·구성원·회계 기준·연동을 대표가 직접 정합니다.",
    legacy: ["company", "billing"],
    menus: [
      { key: "company", name: "회사 기초정보", href: "/settings/company", icon: "sheet", src: shot("f-settings-v2"),
        desc: "사업자 정보와 직인·로고, 회사 공용 양식을 관리합니다.",
        items: ["회사정보·직인·로고", "회사 양식(PDF)"] },
      { key: "people", name: "구성원·초대", href: "/settings/people", icon: "users", src: shot("f-settings-people-v1"),
        desc: "구성원 초대와 합류 요청, 부서를 관리합니다.",
        items: ["구성원 초대", "합류 요청 승인", "부서 관리"] },
      { key: "finance-settings", name: "회계·세무", href: "/settings/finance", icon: "book", src: shot("f-settings-finance-v1"),
        desc: "자금 기준·계정과목·회계마감·세무 파트너·4대보험 요율을 정합니다.",
        items: ["자금·통장 기준", "계정과목·분류", "회계마감·기초잔액", "세무 파트너 연결", "4대보험 요율"] },
      { key: "integration", name: "연동·API 키", href: "/settings/integration", icon: "link", src: shot("f-settings-integration-v1"),
        desc: "은행·카드 자동 수집을 공동인증서로 연결하고, 외부 서비스 API 키를 등록합니다.",
        items: ["은행연동(공동인증서)", "외부 서비스 API 키"] },
      { key: "system", name: "보안·시스템", href: "/settings/system", icon: "shield", src: shot("f-settings-system-v1"),
        desc: "접속을 허용할 IP를 정합니다.",
        items: ["접속 허용 IP"] },
      { key: "billing", name: "요금제", href: "/billing", icon: "card", src: shot("f-billing-v2"),
        desc: "지금 쓰는 요금제와 사용량을 확인하고 바꿉니다.",
        items: ["플랜 비교·변경", "구성원 좌석 관리", "저장공간 사용량·팩 추가", "결제 수단·내역"] },
    ],
  },
  {
    key: "help", name: "도움말", short: "도움말", icon: "book",
    lead: "막히는 곳은 앱 안에서 바로 확인하고 문의합니다.",
    legacy: ["announcements", "guide", "support"],
    menus: [
      { key: "announcements", name: "공지사항", href: "/announcements", icon: "mail", src: shot("f-announcements-v2"),
        desc: "오너뷰의 새 기능과 점검 소식을 앱 안에서 받습니다.",
        items: ["새 기능 소식", "점검 안내", "읽음 표시"] },
      { key: "guide", name: "사용 가이드", href: "/guide", icon: "book", src: shot("f-guide-v2"),
        desc: "메뉴마다 무엇을 하는 곳인지 화면 안에서 찾아봅니다.",
        items: ["메뉴별 사용법", "화면 옆 도움말 서랍", "처음 시작하기"] },
      { key: "support", name: "고객센터", href: "/support", icon: "chat", src: shot("f-support-v2"),
        desc: "문의를 남기면 답변이 화면 안에 쌓입니다.",
        items: ["문의 등록·답변 확인", "자주 묻는 질문", "첨부파일 전달"] },
    ],
  },
];

/* 옛 주소 호환 — 구성원 디렉토리는 인사(옛 hr m=3)에서 업무로 옮겼다 */
const MOVED: Record<string, { g: string; m: string }> = { "hr:3": { g: "workspace", m: "team" } };

/** ?g=&m= → [그룹 index, 메뉴 index]. m 은 메뉴 key 또는 옛 숫자 차례. 없거나 모르면 0. */
export function pickMenu(g: string | null, m: string | null): [number, number] {
  const moved = g && m ? MOVED[`${g}:${m}`] : undefined;
  const gKey = moved?.g ?? g;
  const mKey = moved?.m ?? m;
  const gi = CATALOG.findIndex((x) => x.key === gKey);
  if (gi < 0) return [0, 0];
  const grp = CATALOG[gi];
  let key = mKey ?? "";
  if (/^\d+$/.test(key)) key = grp.legacy?.[Number(key)] ?? "";
  const mi = grp.menus.findIndex((x) => x.key === key);
  return [gi, mi < 0 ? 0 : mi];
}

/** 메뉴 주소 — 첫 메뉴는 m 을 빼고, 첫 그룹(홈)은 g 도 뺀다(canonical 과 같게 — 같은 화면이 두 주소가 되지 않게) */
export function menuHref(gKey: string, mKey?: string): string {
  const grp = CATALOG.find((x) => x.key === gKey);
  const first = grp?.menus[0]?.key;
  if (!mKey || mKey === first) return gKey === CATALOG[0].key ? "/features/" : `/features/?g=${gKey}`;
  return `/features/?g=${gKey}&m=${mKey}`;
}

export const MENU_COUNT = CATALOG.reduce((n, g) => n + g.menus.length, 0);
