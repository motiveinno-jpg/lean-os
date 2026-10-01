// 주소별 접근 판정 — middleware 가 쓰는 공개 목록과 로그인 필요 목록을 한 곳에 둔다.
//
//   ▸ 공개(PUBLIC_ROUTES·PUBLIC_PREFIXES): 로그인 없이 열린다.
//   ▸ 로그인 필요(APP_ROUTE_SEGMENTS): 비로그인이면 /auth 로 보낸다.
//   ▸ 둘 다 아니면 없는 주소다 — 미들웨어는 손대지 않고 Next 가 404(not-found)를 그린다.
//     전에는 공개 목록에 없는 주소를 전부 로그인 필요로 봐서 /nonexistent 같은 주소도 로그인 화면으로 갔다.
//
//   ⚠️ 로그인이 필요한 화면을 새로 만들면 첫 주소 조각을 APP_ROUTE_SEGMENTS 에 넣는다.
//      빠뜨리면 비로그인 방문이 로그인 화면 대신 화면 자체로 들어간다(자료는 RLS 가 막지만 튕겨 주지 않는다).
//      src/lib/__tests__/route-access.test.ts 가 src/app 의 page 파일과 이 목록을 대조해 빠진 것을 찍는다.
//   ⚠️ 엣지 런타임(middleware)에서 돈다 — 다른 모듈을 import 하지 않는다.

export const PUBLIC_ROUTES = [
  '/',
  '/auth',
  '/auth/verify',
  '/auth/reset',
  '/auth/find-email',
  '/api/auth/callback',
  '/terms',
  '/privacy',
  '/refund',
  '/security',  // 보안 안내 — 비로그인 노출이 목적
  '/invite',
  '/sign',
  '/share',
  '/advisor',  // 세무사 파트너 포털 랜딩(로그인/가입) — 하위 라우트는 세션 필요 (2026-08-11)
  '/tax-partners',  // 세무사 제휴 모집 랜딩 (2026-08-11)
  '/platform',
  '/demo',
  '/pricing',   // 랜딩에서 분리한 요금제 페이지 — 비로그인 노출이 목적 (2026-07-27)
  '/features',  // 랜딩에서 분리한 기능 둘러보기 페이지 — 동일 (2026-07-27)
  '/ai',        // AI 자동화 페이지 — 동일 (2026-07-27)
  '/contact',   // 도입 상담 신청 — 랜딩 「전문 상담 예약」 (2026-09-14)
  '/oauth/authorize', // AI 커넥터(MCP) 연결 허용 화면 — 화면이 직접 로그인을 확인하고 로그인 뒤 같은 주소로 돌아온다 (2026-09-29)
  '/unsubscribe', // 광고 메일 수신거부 — 정보통신망법 제50조. 로그인을 요구하면 「쉬운 방법」 요건에 어긋난다 (2026-09-16)
  '/maintenance',
  '/status',
  '/tools', // 무료 계산기 허브(모음) — 검색 유입용 공개 인덱스 (2026-08-31)
  '/tools/leave-calculator', // 무료 연차 계산기 — 검색 유입용 공개 도구 (2026-08-13)
  '/tools/severance-calculator', // 무료 퇴직금 계산기 — 공개 도구 2탄 (2026-08-13)
  '/tools/insurance-calculator', // 무료 4대보험 계산기 — 공개 도구 3탄 (2026-08-13)
  '/tools/salary-calculator', // 무료 실수령액 계산기 — 공개 도구 4탄 (2026-08-13)
  '/tools/weekly-holiday-calculator', // 무료 주휴수당 계산기 — 공개 도구 5탄 (2026-08-25)
  '/tools/vat-calculator', // 무료 부가세 계산기 — 공개 도구 6탄 (2026-08-25)
];

// 토큰이 경로 조각으로 붙는 외부 공개 라우트 — 정확 일치로는 /quote/<token> 이 걸리지 않아
//   비로그인 거래처가 로그인으로 튕겼다(2026-08-31 QA 실측 — 견적 외부 승인 실사용 0건의 원인).
//   /sign·/share 는 토큰을 쿼리로 받아 정확 일치로 충분, 여기엔 경로형만 넣는다.
//   /industries — 업종별 활용 페이지, 비로그인 공개(2026-09-16)
//   /survey/ — 프로젝트 설문 응답(로그인 없는 외부 공개, 내용은 project-survey 엣지가 토큰으로 검증)
export const PUBLIC_PREFIXES = ['/quote/', '/portal/', '/survey/', '/industries'];

/** 로그인이 필요한 화면의 첫 주소 조각. `(app)` 묶음 전부 + 묶음 밖 로그인 화면 */
export const APP_ROUTE_SEGMENTS = [
  // (app) 묶음 — 사이드바 안 화면
  'admin', 'announcements', 'approvals', 'attendance', 'bank', 'billing', 'board', 'cards', 'cash-receipts',
  'chat', 'collect', 'contracts', 'copilot', 'dashboard', 'deals', 'design', 'documents', 'e-invoices',
  'employees', 'error-logs', 'finance', 'guide', 'hr-templates', 'inventory', 'leave', 'loans', 'master',
  'matching', 'my-contracts', 'mypage', 'notifications', 'onboarding', 'operator-users', 'partners',
  'payments', 'projecthub', 'projects', 'reports', 'schedule', 'settings', 'signatures', 'subscriptions',
  'support', 'support-programs', 'tax-invoices', 'team', 'transactions', 'vault',
  // 묶음 밖 로그인 화면 — /advisor·/platform 첫 화면은 위 공개 목록이 먼저 열어 준다
  'company-setup', 'join-pending', 'advisor', 'platform',
] as const;

export function isPublicRoute(pathname: string): boolean {
  // API 라우트는 자체 인증 처리
  if (pathname.startsWith('/api/')) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname === `${route}/`,
  );
}

const APP_SET: ReadonlySet<string> = new Set(APP_ROUTE_SEGMENTS);

/** 로그인이 필요한 앱 주소인가 — 첫 조각이 목록에 있고 공개 주소가 아니면 */
export function requiresLogin(pathname: string): boolean {
  if (isPublicRoute(pathname)) return false;
  return APP_SET.has(pathname.split('/')[1] ?? '');
}
