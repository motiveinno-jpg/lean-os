// 운영/개발 환경 구분 (2026-06-30 dev 분리).
//   Vercel: Production 스코프엔 NEXT_PUBLIC_APP_ENV 미설정 → production.
//           Preview/dev 스코프엔 NEXT_PUBLIC_APP_ENV=development.
//   목적: dev(별도 Supabase)에서 운영 외부서비스(CODEF/결제/메일)를 실수로 건드리지 않게 가드.
export const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV || "production").toLowerCase();
export const isProduction = APP_ENV === "production";
export const isDev = !isProduction;

// dev에서도 CODEF 외부 연동을 의도적으로 켜고 싶을 때만 쓰는 탈출구
// (dev Supabase에 샌드박스 자격증명을 넣고 테스트할 때 NEXT_PUBLIC_DEV_CODEF=1)
export const devCodefEnabled = process.env.NEXT_PUBLIC_DEV_CODEF === "1";
