// 라운드6.5 TeamHub 헤더바 — 라우트 → 브레드크럼(그룹 › 타이틀) 매핑.
//   사이드바 NAV_GROUPS 라벨과 정렬(중복 정의지만 셸 순환 import 회피용 독립 사전).
//   매칭은 최장 prefix 우선 — /partners/ledger 가 /partners 보다 먼저 잡힘.

export type RouteCrumb = { group: string | null; title: string; desc?: string };

const ROUTE_LABELS: Record<string, RouteCrumb> = {
  // desc 가 있으면 리포트형 표준 헤더(제목+설명)가 화면 상단에 자동 표시됨(app-shell 주입).
  //   self-헤더 있는 화면(/dashboard·/reports/*·/projecthub·/settings·/chat)은 desc 생략 → 중복 방지.
  "/dashboard": { group: "홈", title: "대시보드", desc: "오늘 챙길 것을 한눈에 — 내 업무·자금·일정·전자결재 현황을 봅니다." },
  "/copilot": { group: "홈", title: "AI 참모" },
  "/notifications": { group: "홈", title: "알림", desc: "받은 알림을 모아 봅니다." },
  "/support-programs": { group: "홈", title: "지원사업추천", desc: "회사 자료(업종·소재지·직원·매출)로 걸러 낸 정부 지원정책입니다. 신청은 각 기관에서 합니다." },

  // 브레드크럼 title = 좌측 사이드바 허브 라벨과 일치(거래처 / 세금·증빙 / 거래 장부 / 전표입력 / 분석).
  //   세부 화면(거래처 관리·원장, 손익계산서 등)은 FinanceTabs·ReportsTabs 하위 탭이 표시 → 헤더 중복 방지.
  //   /reports/* 는 별도 항목 없이 이 "/reports" 를 상속해 모두 "분석" 으로 표기.
  //   2026-08-11 — 분석이 사이드바 그룹으로 승격, 거래처 원장도 그리로 옮겼다.
  //   머리말은 **사이드바에서 고른 갈래 이름**과 같아야 한다("분석 › 분석"이면 아무것도 안 알려 준다).
  //   최장 prefix 우선이라 아래 갈래별 항목이 "/reports" 보다 먼저 잡힌다.
  "/reports": { group: "분석", title: "분석" },
  "/reports/summary": { group: "분석", title: "경영 요약" },
  "/reports/revenue": { group: "분석", title: "손익 현황" },
  "/reports/expense": { group: "분석", title: "손익 현황" },
  "/reports/monthly": { group: "분석", title: "손익 현황" },
  "/reports/upcoming": { group: "분석", title: "자금 전망" },
  "/reports/outlook": { group: "분석", title: "자금 전망" },
  "/reports/flow": { group: "분석", title: "자금 전망" },
  "/reports/statements": { group: "분석", title: "회계 자료" },
  "/reports/pnl": { group: "분석", title: "회계 자료" },
  "/reports/bs": { group: "분석", title: "회계 자료" },
  "/reports/costs": { group: "분석", title: "회계 자료" },
  "/reports/by-person": { group: "분석", title: "회계 자료" },
  "/reports/three-way-match": { group: "분석", title: "회계 자료" },
  "/partners/ledger": { group: "분석", title: "거래처 원장", desc: "거래처별 매출·매입 원장과 잔액을 봅니다." },
  "/partners/reconciliation/voucher-entry": { group: "재무", title: "일반전표", desc: "통장·대체·결산 거래를 차변·대변으로 직접 입력합니다." },
  "/partners/reconciliation/sale-purchase": { group: "재무", title: "매입매출전표", desc: "세금계산서·카드·현금영수증을 부가세 유형과 함께 입력합니다." },
  "/collect": { group: "재무", title: "수집·전표", desc: "세금계산서·계산서·현금영수증·카드·통장을 한 곳에서 받아오고 전표로 만듭니다." },
  "/partners/reconciliation": { group: "재무", title: "거래 장부", desc: "통장·카드 거래를 전표·계산서와 맞춰 봅니다." },
  "/partners": { group: "재무", title: "거래처", desc: "거래처 정보와 잔액을 관리합니다." },
  "/tax-invoices": { group: "재무", title: "세금·증빙", desc: "발행·수취한 세금계산서를 관리합니다." },
  "/cash-receipts": { group: "재무", title: "세금·증빙", desc: "현금영수증 발행·수취 내역을 관리합니다." },
  "/matching": { group: "재무", title: "거래 매칭", desc: "통장·카드 거래를 자동 매칭합니다." },
  //   2026-08-11 — 통장 줄 처리는 '수집·전표'의 통장 탭으로 옮겼다. 여기 남은 건 비목 자동 분류다.
  "/transactions": { group: "재무", title: "자동 분류", desc: "미분류 지출을 비용 항목으로 정리·자동화합니다. (전표·수금 처리는 수집·전표의 통장 탭)" },

  "/schedule": { group: "업무", title: "일정 / 할 일", desc: "일정과 할 일을 관리합니다." },
  "/projecthub/quotes": { group: "업무", title: "견적 수취함", desc: "협력사에서 받은 견적을 모아 봅니다." },
  "/projecthub": { group: "업무", title: "프로젝트", desc: "프로젝트를 유형별로 관리합니다." },
  "/projects": { group: "업무", title: "워크플로우", desc: "전사 작업 보드를 봅니다." },
  "/deals": { group: "업무", title: "프로젝트", desc: "프로젝트를 관리합니다." },
  "/approvals": { group: "업무", title: "결재 허브", desc: "지출결의·문서 등 사내 결재 요청을 올리고 승인·관리합니다. (외부 계약 서명은 전자계약)" },
  "/board": { group: "업무", title: "게시판", desc: "사내 게시판입니다." },
  "/chat": { group: "업무", title: "메신저" },
  "/signatures": { group: "업무", title: "전자계약", desc: "거래처·고객 등 외부 대상 전자계약을 발송하고 서명을 관리합니다." },
  "/contracts/signed": { group: "업무", title: "서명 완료 계약서" },
  "/my-contracts": { group: "홈", title: "내 서명 요청", desc: "나에게 온 서명 요청 전체 목록 (마이페이지 › 급여·계약·증명에서 옵니다)." },

  "/employees": { group: "인사", title: "구성원", desc: "직원 정보·급여·계약을 관리합니다." },
  "/team": { group: "업무", title: "구성원 디렉토리", desc: "누가 어느 부서·직책에 있는지 봅니다." },
  "/attendance": { group: "인사", title: "근태 관리", desc: "출퇴근·근태 현황을 관리합니다." },
  "/leave": { group: "업무", title: "휴가 신청", desc: "휴가 신청은 결재 허브에서 처리합니다." },
  "/hr-templates": { group: "인사", title: "근로계약·서식", desc: "근로·연봉계약 서식을 만들고, 일괄 발송과 서명 현황을 관리합니다. (개별 발송은 구성원 상세)" },
  "/documents": { group: "업무", title: "파일보관함", desc: "회사 파일·문서를 보관합니다." },

  "/bank": { group: "재무", title: "통장", desc: "통장 잔액과 거래를 봅니다." },
  "/finance/status": { group: "재무", title: "현황", desc: "작성된 전표의 현황·지표 — 확정·반려·출처, 일반·매입매출 종류, 계정과목·거래처·부가세 유형, 전표 없는 증빙을 봅니다." },
  "/cards": { group: "재무", title: "카드", desc: "법인카드 사용내역을 봅니다." },
  "/payments": { group: "재무", title: "정기 지출", desc: "정기결제·고정비를 관리합니다." },
  "/subscriptions": { group: "자금", title: "구독 관리", desc: "구독 서비스를 관리합니다." },
  "/loans": { group: "자금", title: "대출", desc: "대출 현황을 관리합니다." },
  "/vault": { group: "자금", title: "자산", desc: "회사 자산을 관리합니다." },

  //   재고 (2026-08-25 신설)
  "/inventory/profit": { group: "재고", title: "이익관리", desc: "구매·생산·판매에서 남는 돈을 원가(선입선출)가 반영된 숫자로 봅니다 — 품목·거래처·채널별 이익, 손실, 원가 층." },
  "/inventory/status": { group: "재고", title: "현황", desc: "주문·판매·구매·생산을 기간으로 집계해 그래프와 표로 봅니다. 재고 금액·마진·납기 지난 주문·자재 부족을 한 화면에서." },
  "/inventory/products": { group: "재고", title: "품목", desc: "파는 것·쓰는 것을 SKU 로 등록합니다. 수량을 세지 않는 품목(서비스)도 여기서 정합니다." },
  "/inventory/stock": { group: "재고", title: "창고관리", desc: "지금 몇 개인지 봅니다. 수량은 움직인 기록의 합이라 언제 왜 변했는지 되짚을 수 있습니다." },
  "/inventory/orders": { group: "재고", title: "주문" },
  "/inventory/sales": { group: "재고", title: "판매" },
  "/inventory/purchase": { group: "재고", title: "구매" },
  "/inventory/production": { group: "재고", title: "생산" },
  "/inventory/channels": { group: "재고", title: "이커머스" },
  "/settings": { group: "설정", title: "회사 설정", desc: "회사 기본·회계·인사 설정을 관리합니다." },
  //   설정 5그룹 (2026-08-24) — 사이드바에 편 다섯 줄. 최장 prefix 우선이라 /settings 보다 먼저 잡힌다.
  //   설정 화면은 self-헤더(상자 안 탭 + 설명 줄)를 가지므로 desc 는 두지 않는다.
  "/settings/company": { group: "설정", title: "회사 기초정보" },
  "/settings/people": { group: "설정", title: "구성원·초대" },
  "/settings/finance": { group: "설정", title: "회계·세무 설정" },
  "/settings/integration": { group: "설정", title: "연동·API 키" },
  "/settings/system": { group: "설정", title: "보안·시스템" },
  "/announcements": { group: "도움말", title: "공지사항", desc: "공지사항을 관리합니다." },
  "/mypage": { group: "홈", title: "마이페이지", desc: "내 계정 정보를 관리합니다." },
  "/billing": { group: "설정", title: "요금제", desc: "요금제와 결제를 관리합니다." },
  "/guide": { group: "도움말", title: "사용 가이드" },
  "/support": { group: "도움말", title: "고객센터" },

  "/error-logs": { group: "운영", title: "에러 모니터링", desc: "발생한 에러를 모니터링합니다." },
  "/operator-users": { group: "운영", title: "유저 계정 관리", desc: "유저 계정을 관리합니다." },
  "/admin": { group: "운영", title: "관리자", desc: "운영자 도구입니다." },
  "/onboarding": { group: null, title: "시작하기" },
};

// 최장 prefix 우선 정렬(한 번만 계산)
const SORTED_PREFIXES = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);

export function getRouteCrumb(pathname: string): RouteCrumb | null {
  for (const p of SORTED_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return ROUTE_LABELS[p];
  }
  return null;
}
