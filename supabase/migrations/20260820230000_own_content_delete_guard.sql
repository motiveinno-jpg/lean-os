-- 남이 쓴 것을 못 지우게 (2026-08-20 사장님: "이거랑 비슷한 오류나 에러 있는지 샅샅히 확인" → 전부 수정)
--
-- 파일보관함과 같은 계열. 아래 테이블들은 정책이 `FOR ALL (company_id = get_my_company_id())` 하나뿐이라
-- **같은 회사면 남이 쓴 글·댓글·노트·알림·대화기록을 지우거나 고칠 수 있었다.**
-- 권한 0 계정(박서연)으로 실제 시도해 전부 재현 확인:
--     board_posts 🔓삭제됨 · task_comments 🔓삭제됨 · ai_interactions 🔓삭제됨
--     notifications 🔓삭제됨·🔓읽음처리됨 · project_board_item_notes 🔓삭제됨
--
-- 화면은 대부분 이미 작성자만 버튼을 보여준다(게시판·태스크댓글·메신저).
--   → 즉 이건 "개발자도구로 우회 가능" 등급. 다만 project_board_item_notes 는 **화면도 안 막혀 있어**
--     사장님이 파일보관함에서 겪으신 것과 완전히 같은 형태였다(UI 는 같은 커밋에서 함께 수정).
--
-- 방식: 기존 PERMISSIVE 회사격리는 그대로 두고 DELETE/UPDATE 에만 RESTRICTIVE 를 덧대 AND 로 좁힌다.
--   SELECT·INSERT 무변경 — 읽기·작성 동작은 전혀 바뀌지 않는다.
--
-- 소유자 비교는 반드시 public.current_app_user_id() (= users.id).
--   ⚠️ auth.uid() 를 쓰면 안 된다: 이 컬럼들은 users.id 를 담는데(실데이터 전건 확인),
--      운영 21명 중 2명은 users.id ≠ auth_id 라 그 사람들만 조용히 어긋난다.
--
-- 예외 허용
--   · 게시판: 작성자 또는 '/board:pin' 보유자(=마스터 포함) — 화면의 댓글 삭제 조건과 동일.
--   · 그 외: 작성자 또는 마스터(is_company_master) — 퇴사자 글 정리 등 운영상 필요.
--   · 메신저: 보낸 사람만. 마스터도 남의 대화를 지울 수 없다(화면과 동일, 감청 오해 방지).

-- ── 게시판 글·댓글 ────────────────────────────────────────
drop policy if exists board_posts_own_write on public.board_posts;
create policy board_posts_own_write on public.board_posts as restrictive for delete to authenticated
  using (author_id = (select public.current_app_user_id()) or (select public.has_perm('/board:pin')));
drop policy if exists board_posts_own_update on public.board_posts;
create policy board_posts_own_update on public.board_posts as restrictive for update to authenticated
  using (author_id = (select public.current_app_user_id()) or (select public.has_perm('/board:pin')));

drop policy if exists board_comments_own_write on public.board_comments;
create policy board_comments_own_write on public.board_comments as restrictive for delete to authenticated
  using (author_id = (select public.current_app_user_id()) or (select public.has_perm('/board:pin')));
drop policy if exists board_comments_own_update on public.board_comments;
create policy board_comments_own_update on public.board_comments as restrictive for update to authenticated
  using (author_id = (select public.current_app_user_id()) or (select public.has_perm('/board:pin')));

-- ── 태스크 댓글 ───────────────────────────────────────────
drop policy if exists task_comments_own_write on public.task_comments;
create policy task_comments_own_write on public.task_comments as restrictive for delete to authenticated
  using (created_by = (select public.current_app_user_id()) or (select public.is_company_master()));
drop policy if exists task_comments_own_update on public.task_comments;
create policy task_comments_own_update on public.task_comments as restrictive for update to authenticated
  using (created_by = (select public.current_app_user_id()) or (select public.is_company_master()));

-- ── 프로젝트 보드 노트 (화면도 안 막혀 있던 것) ────────────
drop policy if exists pbi_notes_own_write on public.project_board_item_notes;
create policy pbi_notes_own_write on public.project_board_item_notes as restrictive for delete to authenticated
  using (user_id = (select public.current_app_user_id()) or (select public.is_company_master()));
drop policy if exists pbi_notes_own_update on public.project_board_item_notes;
create policy pbi_notes_own_update on public.project_board_item_notes as restrictive for update to authenticated
  using (user_id = (select public.current_app_user_id()) or (select public.is_company_master()));

-- ── AI 대화기록 (개인 기록) ───────────────────────────────
drop policy if exists ai_interactions_own_write on public.ai_interactions;
create policy ai_interactions_own_write on public.ai_interactions as restrictive for delete to authenticated
  using (user_id = (select public.current_app_user_id()) or (select public.is_company_master()));
drop policy if exists ai_interactions_own_update on public.ai_interactions;
create policy ai_interactions_own_update on public.ai_interactions as restrictive for update to authenticated
  using (user_id = (select public.current_app_user_id()) or (select public.is_company_master()));

-- ── 알림 (통보 대상 본인만) ───────────────────────────────
--   INSERT 는 회사 범위 그대로 — 시스템이 남에게 알림을 만들어 주는 게 정상 동작이다.
--   화면의 갱신은 전부 본인 것(.eq('user_id', 내 id) 또는 내 알림 id)이라 안 깨진다.
drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications as restrictive for delete to authenticated
  using (user_id = (select public.current_app_user_id()));
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications as restrictive for update to authenticated
  using (user_id = (select public.current_app_user_id()));

-- ── 메신저 (보낸 사람만) ──────────────────────────────────
--   UPDATE 하는 코드는 없지만(수정 기능 없음) 남이 고치는 길 자체를 막아 둔다.
drop policy if exists chat_messages_own_delete on public.chat_messages;
create policy chat_messages_own_delete on public.chat_messages as restrictive for delete to authenticated
  using (sender_id = (select public.current_app_user_id()));
drop policy if exists chat_messages_own_update on public.chat_messages;
create policy chat_messages_own_update on public.chat_messages as restrictive for update to authenticated
  using (sender_id = (select public.current_app_user_id()));
