// 운영자 화면 공용 — 경로를 사람이 읽는 이름으로, 초를 '12초/1분 5초'로 (페이지 체류 화면·대시보드 카드)
import { getRouteCrumb } from "@/lib/route-labels";

// 공개 페이지 이름 — 앱 화면은 route-labels 가 이름을 준다
const PUBLIC_NAMES: Record<string, string> = {
  "/": "첫 화면(랜딩)", "/pricing/": "요금제", "/features/": "기능 소개", "/contact/": "도입 상담", "/auth/": "로그인·회원가입",
  "/tax-partners/": "세무 파트너", "/privacy/": "개인정보처리방침", "/terms/": "이용약관",
  "/refund/": "환불규정", "/security/": "보안", "/unsubscribe/": "메일 수신거부", "/tools/vat-calculator/": "부가세 계산기",
};

export function pageName(path: string): string {
  if (PUBLIC_NAMES[path]) return PUBLIC_NAMES[path];
  const crumb = getRouteCrumb(path.replace(/\/$/, "") || "/");
  if (crumb?.title) return crumb.group ? `${crumb.group} › ${crumb.title}` : crumb.title;
  if (path.startsWith("/industries/")) return "업종별 소개";
  return path;
}

export const fmtSec = (n: number | null | undefined) =>
  n == null ? "—" : n >= 60 ? `${Math.floor(n / 60)}분 ${Math.round(n % 60)}초` : `${Number(n).toFixed(n < 10 ? 1 : 0)}초`;
