-- 탭 권한에 명시적 허용/차단 — 기본 켜진 탭(관리자/기본제공)도 끌 수 있게.
--   allowed=true(부여/허용), allowed=false(명시 차단). 행 없으면 기본값(역할/기본제공) 적용.
ALTER TABLE public.user_tab_access ADD COLUMN IF NOT EXISTS allowed boolean NOT NULL DEFAULT true;
