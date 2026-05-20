-- =====================================================================
-- P0 보완: chat_channels INSERT RETURNING 차단 회귀 (20260520040000 후속)
-- =====================================================================
-- 문제: `chat_channels_select_member` RESTRICTIVE FOR SELECT 정책이
--   `INSERT ... RETURNING ...` 평가 시점에 같이 적용되어, 같은 트랜잭션에서
--   chat_members 행이 아직 INSERT 되기 전이므로 본인이 만든 채널조차 SELECT 가
--   거부됨 → 42501. prod 신규 채널 생성(DM/팀/딜) 전면 불가.
--
-- 사이드 이펙트: 기존 7건 채널 중 5건이 chat_members 0행이라 생성자조차
--   본인 채널을 못 보던 상태 → 백필로 정정.
--
-- 해결:
--   1) chat_channels.created_by 컬럼 추가 (멱등) — 생성자 추적.
--   2) created_by/멤버 백필 — 과거 데이터 + 생성자 멤버십 보장.
--   3) SELECT 정책 USING 에 `created_by = current_app_user_id()` 분기 추가 →
--      INSERT RETURNING 통과 (트리거가 BEFORE INSERT 에 created_by 채움).
--   4) BEFORE INSERT 트리거로 created_by 자동 세팅 (앱 코드가 명시 안 해도).
--
-- 재귀 게이트 준수: 정책 본문에 chat_*/users/employees 인라인 서브쿼리 0.
--   `created_by = current_app_user_id()` 는 컬럼 직접비교 + SECURITY DEFINER
--   헬퍼 한 번. is_channel_member 는 동일.
--
-- type='team' 공개 회사채널 분기 제거: 현 데이터 0행이라 누출 위험 0,
--   필요 시 별도 마이그로 재도입.
--
-- 비파괴: 다른 RLS 정책 (chat_members/chat_messages/chat_participants 정책
--   및 INSERT/UPDATE/DELETE 모두) 무수정.
-- =====================================================================

-- 1) created_by 컬럼 추가 (멱등)
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- 2) created_by 백필 — 가장 오래된 멤버/참가자를 생성자로 추정
--    chat_members.joined_at / chat_participants.invited_at 기준 (NULL 안전).
UPDATE public.chat_channels c
SET created_by = COALESCE(
  (SELECT user_id FROM public.chat_members
     WHERE channel_id = c.id
     ORDER BY joined_at NULLS LAST
     LIMIT 1),
  (SELECT user_id FROM public.chat_participants
     WHERE channel_id = c.id
     ORDER BY invited_at NULLS LAST
     LIMIT 1)
)
WHERE c.created_by IS NULL;

-- 3) chat_members 백필 — chat_participants 만 있고 chat_members 없는 경우
INSERT INTO public.chat_members (channel_id, user_id, joined_at)
SELECT cp.channel_id, cp.user_id, COALESCE(cp.invited_at, now())
FROM public.chat_participants cp
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_members cm
  WHERE cm.channel_id = cp.channel_id AND cm.user_id = cp.user_id
)
ON CONFLICT (channel_id, user_id) DO NOTHING;

-- 4) 생성자 멤버십 보장 — created_by 가 채워졌지만 chat_members 행 없는 경우
INSERT INTO public.chat_members (channel_id, user_id, joined_at)
SELECT c.id, c.created_by, COALESCE(c.created_at, now())
FROM public.chat_channels c
WHERE c.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_members cm
    WHERE cm.channel_id = c.id AND cm.user_id = c.created_by
  )
ON CONFLICT (channel_id, user_id) DO NOTHING;

-- 5) SELECT 정책 교체 — created_by 분기 추가로 INSERT RETURNING 통과
DROP POLICY IF EXISTS chat_channels_select_member ON public.chat_channels;
CREATE POLICY chat_channels_select_member ON public.chat_channels
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (
    -- 본인이 만든 채널은 같은 트랜잭션 INSERT RETURNING 시점에도 통과.
    -- (BEFORE INSERT 트리거가 created_by 를 미리 채우므로 RETURNING 평가 시
    --  이미 NEW.created_by = current_app_user_id() 가 보장됨.)
    created_by = public.current_app_user_id()
    OR public.is_channel_member(id, public.current_app_user_id())
    -- type='team' 공개 회사채널 분기는 현 데이터 0행이라 제거.
    -- 미래 도입 시 별도 마이그로.
  );

-- 6) BEFORE INSERT 트리거 — created_by 자동 채움
CREATE OR REPLACE FUNCTION public.chat_channels_set_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.current_app_user_id();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_channels_set_creator() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS chat_channels_set_creator ON public.chat_channels;
CREATE TRIGGER chat_channels_set_creator
  BEFORE INSERT ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.chat_channels_set_creator();

COMMENT ON COLUMN public.chat_channels.created_by
  IS 'P0 보완(20260520070000): SELECT RESTRICTIVE 가 INSERT RETURNING 까지 차단하던 회귀의 우회로. 생성자 분기 + BEFORE INSERT 트리거 자동주입.';

COMMENT ON FUNCTION public.chat_channels_set_creator()
  IS 'chat_channels.created_by 를 current_app_user_id() 로 자동 채우는 BEFORE INSERT 트리거. SELECT 정책이 RETURNING 시점에 본인 채널을 통과시키기 위한 전제.';
