-- =====================================================================
-- P0 채팅 권한 결함 — 채널 멤버만 채널·멤버·메시지 SELECT 가능 (멱등)
-- =====================================================================
-- 배경: chat_channels/chat_members/chat_messages/chat_participants 의
--   기존 PERMISSIVE 정책은 `company_id = get_my_company_id()` 만 검사 →
--   회사 직원 누구나 모든 딜채널·DM 채널을 SELECT 가능한 P0 결함.
--   직원 보고: "딜채널/팀채널 초대받은 사람만 볼 수 있어야 하는데 모두가 보임".
--
-- 설계:
--   1) is_channel_member(channel_id, user_id) SECURITY DEFINER 헬퍼 신설.
--      재귀 게이트 준수: 정책 본문은 chat_members/chat_channels/users/employees
--      인라인 서브쿼리 0, 헬퍼 한 번만 호출(STABLE).
--      `user_id` 인자는 public.users.id (auth.users.id 아님).
--      호출자는 current_app_user_id() 로 매핑한 값을 넘긴다.
--   2) RESTRICTIVE SELECT 정책 4개 추가:
--      - chat_channels: type='team' 공개 회사채널은 회사격리 유지(현재 0행이지만
--        공개 회사채널 도입을 위한 forward-compat), 그 외(deal/subdeal/dm/partner
--        /기타)는 멤버만.
--      - chat_members/chat_messages/chat_participants: 채널 멤버만.
--      기존 company PERMISSIVE 정책은 그대로(회사격리 외피) — RESTRICTIVE 와
--      AND 결합되어 "회사 + 멤버" 의 교집합이 노출 범위.
--
-- 비파괴: INSERT/UPDATE/DELETE 권한·기존 정책 무수정. RLS 추가 격리만.
-- =====================================================================

-- 1) 헬퍼: 채널 멤버 여부 확인 (재귀 안전)
CREATE OR REPLACE FUNCTION public.is_channel_member(
  p_channel_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_members
    WHERE channel_id = p_channel_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_channel_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.is_channel_member(uuid, uuid)
  IS 'P0 채팅 권한 격리 헬퍼 — RESTRICTIVE 정책 본문에서 chat_members 1회 lookup. SECURITY DEFINER STABLE.';

-- 2) chat_channels SELECT 강화
--   type='team' 공개 회사채널은 회사격리만(forward-compat: 현재 0행),
--   그 외는 멤버만 노출.
DROP POLICY IF EXISTS chat_channels_select_member ON public.chat_channels;
CREATE POLICY chat_channels_select_member ON public.chat_channels
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (
    COALESCE(type, '') = 'team'
    OR public.is_channel_member(id, public.current_app_user_id())
  );

-- 3) chat_members SELECT 강화 — 본인이 멤버인 채널의 멤버 목록만
DROP POLICY IF EXISTS chat_members_select_member ON public.chat_members;
CREATE POLICY chat_members_select_member ON public.chat_members
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (public.is_channel_member(channel_id, public.current_app_user_id()));

-- 4) chat_messages SELECT 강화 — 채널 멤버만 메시지 노출
DROP POLICY IF EXISTS chat_messages_select_member ON public.chat_messages;
CREATE POLICY chat_messages_select_member ON public.chat_messages
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (public.is_channel_member(channel_id, public.current_app_user_id()));

-- 5) chat_participants SELECT 강화 (병존 테이블 동일 패턴)
DROP POLICY IF EXISTS chat_participants_select_member ON public.chat_participants;
CREATE POLICY chat_participants_select_member ON public.chat_participants
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (public.is_channel_member(channel_id, public.current_app_user_id()));
