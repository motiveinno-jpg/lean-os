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

  // 브레드크럼 title = 좌측 사이드바 허브 라벨과 일치(거래처 / 세금·증빙 / 거래 장부 / 전표입력 / 분석).
  //   세부 화면(거래처 관리·원장, 손익계산서 등)은 FinanceTabs·ReportsTabs 하위 탭이 표시 → 헤더 중복 방지.
  //   /reports/* 는 별도 항목 없이 이 "/reports" 를 상속해 모두 "분석" 으로 표기.
  "/reports": { group: "파이낸스", title: "분석" },
  "/partners/ledger": { group: "파이낸스", title: "거래처", desc: "거래처별 매출·매입 원장과 잔액을 봅니다." },
  "/partners/reconciliation/voucher-entry": { group: "파이낸스", title: "전표입력", desc: "거래를 전표로 직접 입력합니다." },
  "/partners/reconciliation": { group: "파이낸스", title: "거래 장부", desc: "통장·카드 거래를 전표·계산서와 맞춰 봅니다." },
  "/partners": { group: "파이낸스", title: "거래처", desc: "거래처 정보와 잔액을 관리합니다." },
  "/tax-invoices": { group: "파이낸스", title: "세금·증빙", desc: "발행·수취한 세금계산서를 관리합니다." },
  "/cash-receipts": { group: "파이낸스", title: "세금·증빙", desc: "현금영수증 발행·수취 내역을 관리합니다." },
  "/matching": { group: "파이낸스", title: "거래 매칭", desc: "통장·카드 거래를 자동 매칭합니다." },
  "/transactions": { group: "파이낸스", title: "거래 장부", desc: "미분류 지출을 계정과목으로 정리·자동화합니다. (입금 정산은 거래 매칭)" },

  "/schedule": { group: "워크스페이스", title: "일정 / 할 일", desc: "일정과 할 일을 관리합니다." },
  "/projecthub/quotes": { group: "워크스페이스", title: "견적 수취함", desc: "협력사에서 받은 견적을 모아 봅니다." },
  "/projecthub": { group: "워크스페이스", title: "프로젝트", desc: "프로젝트를 유형별로 관리합니다." },
  "/projects": { group: "워크스페이스", title: "워크플로우", desc: "전사 작업 보드를 봅니다." },
  "/deals": { group: "워크스페이스", title: "프로젝트", desc: "프로젝트를 관리합니다." },
  "/approvals": { group: "워크스페이스", title: "결재 허브", desc: "지출결의·문서 등 사내 결재 요청을 올리고 승인·관리합니다. (외부 계약 서명은 전자계약)" },
  "/board": { group: "워크스페이스", title: "게시판", desc: "사내 게시판입니다." },
  "/chat": { group: "워크스페이스", title: "메신저" },
  "/signatures": { group: "워크스페이스", title: "전자계약", desc: "거래처·고객 등 외부 대상 전자계약을 발송하고 서명을 관리합니다." },
  "/contracts/signed": { group: "워크스페이스", title: "서명 완료 계약서" },
  "/my-contracts": { group: "워크스페이스", title: "내 서명 요청", desc: "나에게 온 서명 요청을 봅니다." },

  "/employees": { group: "인사관리", title: "구성원", desc: "직원 정보·급여·계약을 관리합니다." },
  "/team": { group: "인사관리", title: "구성원", desc: "구성원을 관리합니다." },
  "/attendance": { group: "인사관리", title: "근태 관리", desc: "출퇴근·근태 현황을 관리합니다." },
  "/leave": { group: "워크스페이스", title: "휴가 신청", desc: "휴가 신청은 결재 허브에서 처리합니다." },
  "/hr-templates": { group: "인사관리", title: "근로계약·서식", desc: "근로·연봉계약 서식을 만들고, 일괄 발송과 서명 현황을 관리합니다. (개별 발송은 구성원 상세)" },
  "/documents": { group: "인사관리", title: "파일보관함", desc: "회사 파일·문서를 보관합니다." },

  "/bank": { group: "자산관리", title: "통장", desc: "통장 잔액과 거래를 봅니다." },
  "/cards": { group: "자산관리", title: "카드", desc: "법인카드 사용내역을 봅니다." },
  "/payments": { group: "자산관리", title: "정기 지출", desc: "정기결제·고정비를 관리합니다." },
  "/subscriptions": { group: "자산관리", title: "구독 관리", desc: "구독 서비스를 관리합니다." },
  "/loans": { group: "자산관리", title: "대출", desc: "대출 현황을 관리합니다." },
  "/vault": { group: "자산관리", title: "자산", desc: "회사 자산을 관리합니다." },

  "/settings": { group: "설정·도움말", title: "회사 설정", desc: "회사 기본·회계·인사 설정을 관리합니다." },
  "/announcements": { group: "설정·도움말", title: "공지사항", desc: "공지사항을 관리합니다." },
  "/mypage": { group: "홈", title: "마이페이지", desc: "내 계정 정보를 관리합니다." },
  "/billing": { group: "설정·도움말", title: "요금제", desc: "요금제와 결제를 관리합니다." },
  "/guide": { group: "설정·도움말", title: "사용 가이드" },
  "/support": { group: "설정·도움말", title: "고객센터" },

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
