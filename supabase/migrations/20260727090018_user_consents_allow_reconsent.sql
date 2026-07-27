-- 재동의 지원 (2026-07-27)
--   기존 인덱스는 auth_id 당 'signup' 1건만 허용해 약관 개정 시 재동의 기록이 불가능했다.
--   버전 조합이 다르면 새 기록이 남도록 바꾼다 — 같은 버전에 대한 중복(재시도·새로고침)만 막는다.
--   이렇게 하면 "이 사람이 어느 버전에 언제 동의했는지" 이력이 그대로 쌓인다.

DROP INDEX IF EXISTS public.user_consents_signup_once;

CREATE UNIQUE INDEX IF NOT EXISTS user_consents_signup_once_per_version
  ON public.user_consents (auth_id, document_versions)
  WHERE consent_type = 'signup';
