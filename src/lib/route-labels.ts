// 라운드6.5 TeamHub 헤더바 — 라우트 → 브레드크럼(그룹 › 타이틀) 매핑.
//   사이드바 NAV_GROUPS 라벨과 정렬(중복 정의지만 셸 순환 import 회피용 독립 사전).
//   매칭은 최장 prefix 우선 — /partners/ledger 가 /partners 보다 먼저 잡힘.

export type RouteCrumb = { group: string | null; title: string };

const ROUTE_LABELS: Record<string, RouteCrumb> = {
  "/dashboard": { group: "홈", title: "대시보드" },
  "/notifications": { group: "홈", title: "알림" },

  "/reports/flow": { group: "파이낸스", title: "경영 흐름" },
  "/reports/pnl": { group: "파이낸스", title: "손익계산서" },
  "/reports/bs": { group: "파이낸스", title: "재무상태표" },
  "/reports/costs": { group: "파이낸스", title: "비용 분석" },
  "/reports/by-person": { group: "파이낸스", title: "인원별 분석" },
  "/reports/three-way-match": { group: "파이낸스", title: "3면 대사" },
  "/reports": { group: "파이낸스", title: "분석" },
  "/partners/ledger": { group: "파이낸스", title: "거래처 원장" },
  "/partners/reconciliation/voucher-entry": { group: "파이낸스", title: "전표입력" },
  "/partners/reconciliation": { group: "파이낸스", title: "거래 매칭" },
  "/partners": { group: "파이낸스", title: "거래처 관리" },
  "/tax-invoices": { group: "파이낸스", title: "세금계산서" },
  "/cash-receipts": { group: "파이낸스", title: "현금영수증" },
  "/matching": { group: "파이낸스", title: "거래 매칭" },
  "/transactions": { group: "파이낸스", title: "거래내역" },

  "/schedule": { group: "워크스페이스", title: "일정 / 할 일" },
  "/projecthub/quotes": { group: "워크스페이스", title: "견적 수취함" },
  "/projecthub": { group: "워크스페이스", title: "프로젝트" },
  "/projects": { group: "워크스페이스", title: "워크플로우" },
  "/deals": { group: "워크스페이스", title: "프로젝트" },
  "/approvals": { group: "워크스페이스", title: "결재관리" },
  "/board": { group: "워크스페이스", title: "게시판" },
  "/chat": { group: "워크스페이스", title: "메신저" },
  "/signatures": { group: "워크스페이스", title: "전자계약" },
  "/contracts/signed": { group: "워크스페이스", title: "서명 완료 계약서" },
  "/my-contracts": { group: "워크스페이스", title: "내 서명 요청" },

  "/employees": { group: "인사관리", title: "구성원" },
  "/team": { group: "인사관리", title: "구성원" },
  "/attendance": { group: "인사관리", title: "근태 관리" },
  "/leave": { group: "인사관리", title: "휴가" },
  "/hr-templates": { group: "인사관리", title: "양식 관리" },
  "/documents": { group: "인사관리", title: "파일보관함" },

  "/bank": { group: "자산관리", title: "통장" },
  "/cards": { group: "자산관리", title: "카드" },
  "/payments": { group: "자산관리", title: "정기결제·구독" },
  "/subscriptions": { group: "자산관리", title: "구독 관리" },
  "/loans": { group: "자산관리", title: "대출" },
  "/vault": { group: "자산관리", title: "자산" },

  "/settings": { group: "설정·도움말", title: "회사 설정" },
  "/announcements": { group: "설정·도움말", title: "공지사항" },
  "/mypage": { group: "설정·도움말", title: "마이페이지" },
  "/billing": { group: "설정·도움말", title: "요금제" },
  "/guide": { group: "설정·도움말", title: "사용 가이드" },
  "/support": { group: "설정·도움말", title: "고객센터" },

  "/error-logs": { group: "운영", title: "에러 모니터링" },
  "/operator-users": { group: "운영", title: "유저 계정 관리" },
  "/admin": { group: "운영", title: "관리자" },
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
