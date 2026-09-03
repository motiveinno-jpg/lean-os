-- 대시보드 "오늘 챙길 것" 체크 기억 (2026-09-03) · 결정 151 (docs/20260903_PLAN_dashboard_v2.md)
--
--   History: 홈 브리핑(오늘 챙길 것)은 지금까지 '읽고 마는 목록'이었다. 30분 쿨타임으로
--   다시 생성되는 제안 줄만 있었고, 처리한 줄과 안 한 줄을 구분할 자리가 없어 매번 같은
--   줄을 다시 훑어야 했다. 결정 151 은 줄 왼쪽에 완료 체크를 두고, 체크된 줄은 흐리게
--   아래로 내린다. 그 체크를 담는 표가 이 표다.
--
--   자문자답
--   ① 무엇을 기준으로 '같은 줄'이라 판단하는가 — 브리핑 줄은 배치가 돌 때마다 새로 만들어져
--      id 가 바뀐다(30분 쿨타임 재생성). 그래서 줄의 id 가 아니라 '제목에서 뽑은 키'
--      (item_key)로 잡는다. 같은 날 같은 제목이면 같은 할 일이다.
--   ② 왜 하루 단위인가 — '오늘 챙길 것'이라 내일이면 목록 자체가 새로 만들어진다. 체크가
--      영구히 남으면 내일 다시 뜬 같은 제목의 줄이 이미 완료로 보인다. 그래서 day(KST 날짜)를
--      키에 넣어 날이 바뀌면 자동으로 초기화된다(행을 지우지 않아도 안 읽힌다).
--      day 를 서버 now() 로 만들지 않는 이유: 서버는 UTC 라 KST 자정~09:00 이 전날로 찍힌다.
--      화면이 자기 시간대로 계산한 날짜를 넣는다.
--   ③ 반대 경우(되돌리기) — 잘못 체크했으면 다시 눌러 해제한다 = 행 delete. 그래서 delete
--      정책이 반드시 필요하다(결정 151 '되돌리기: 다시 클릭').
--   ④ 자동으로 못 푸는 것 — 오래된 행 청소. 하루치 몇 줄이라 양이 작고, 지우는 크론은
--      회사 데이터를 건드리는 자동화라 게이트가 필요하다. 이번 판에서는 만들지 않고
--      표 주석에 '30일 뒤 정리 후보'라고만 남긴다.
--
--   본인 판정 관용구: public.users 는 id 와 auth_id 가 따로 있고 실제로 둘이 다른 행이 있다
--   (23행 중 2행). 그래서 user_id = auth.uid() 를 쓰면 그 두 사람은 체크가 새거나 막힌다.
--   기존 표들과 같은 관용구인 public.current_app_user_id()
--   (= select id from users where auth_id = auth.uid()) 를 쓴다. notifications 의
--   notifications_own_update / schedule_events 의 'manage own events' 와 같은 판정이다.
--   덤으로 세무사 열람 세션은 users 행이 없어 current_app_user_id() 가 null → 읽기·쓰기 모두
--   자연히 막힌다(별도 advisor 정책 불필요).
--
--   기존 데이터 처리: 새 표. 백필 없음. 체크가 없으면 지금까지처럼 전부 미완료로 보인다.

create table if not exists public.briefing_checks (
  company_id uuid not null references public.companies(id) on delete cascade,
  -- ⚠ users(id) FK 를 걸면 안 된다 (2026-09-03 실사고, 적용 직후 prod 에서 제거): company_id·user_id 두 FK 가 같이 있으면
  --   PostgREST 가 이 표를 users↔companies 조인 표로 보고 관계를 하나 더 만든다 → users 에서 companies 를 임베드하는
  --   getCurrentUser 가 "more than one relationship" 으로 실패 → 회사 없음 → /company-setup 루프(전 회사 영향).
  --   user_id 는 FK 없이 둔다(퇴사자 행은 30일 청소 후보). 다른 회사·본인 표(tax_deadline_checks 등)와 같은 처리.
  user_id    uuid not null,
  -- KST 날짜. 서버가 아니라 화면이 넣는다(자문자답 ②).
  day        date not null,
  -- 브리핑 줄 제목에서 뽑은 키. 줄 id 는 재생성마다 바뀌므로 쓰지 않는다(자문자답 ①).
  item_key   text not null check (char_length(item_key) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id, day, item_key)
);

comment on table public.briefing_checks is
  '대시보드 "오늘 챙길 것" 완료 체크(결정 151). 하루 단위 기억 — day(KST)가 바뀌면 다시 미완료. 30일 지난 행은 정리 후보(청소 크론은 아직 없음).';
comment on column public.briefing_checks.day is
  '체크한 날(KST). 서버 now() 는 UTC 라 자정~09:00 이 전날로 찍히므로 화면이 계산해 넣는다.';
comment on column public.briefing_checks.item_key is
  '브리핑 줄 제목 기반 키(200자 이내). 줄 id 는 30분 재생성마다 바뀌어 쓸 수 없다.';

-- 조회 패턴은 "내 오늘 체크 전부"(company_id, user_id, day) 하나뿐이고,
-- 위 기본키 btree 의 앞 세 칸이 그대로 그 조회를 받는다. 같은 앞칸의 인덱스를 하나 더 만들면
-- 쓰기만 두 번 하고 읽기는 그대로라 중복 인덱스 경고만 남는다 → 별도 인덱스를 만들지 않는다.

alter table public.briefing_checks enable row level security;

-- 같은 회사 + 본인 행만. 익명(anon) 없음 — 네 정책 모두 to authenticated.
drop policy if exists briefing_checks_select on public.briefing_checks;
create policy briefing_checks_select on public.briefing_checks for select to authenticated
  using (company_id = (select public.get_my_company_id())
         and user_id = (select public.current_app_user_id()));

drop policy if exists briefing_checks_insert on public.briefing_checks;
create policy briefing_checks_insert on public.briefing_checks for insert to authenticated
  with check (company_id = (select public.get_my_company_id())
              and user_id = (select public.current_app_user_id()));

drop policy if exists briefing_checks_update on public.briefing_checks;
create policy briefing_checks_update on public.briefing_checks for update to authenticated
  using (company_id = (select public.get_my_company_id())
         and user_id = (select public.current_app_user_id()))
  with check (company_id = (select public.get_my_company_id())
              and user_id = (select public.current_app_user_id()));

-- 체크 해제 = 행 삭제(결정 151 되돌리기).
drop policy if exists briefing_checks_delete on public.briefing_checks;
create policy briefing_checks_delete on public.briefing_checks for delete to authenticated
  using (company_id = (select public.get_my_company_id())
         and user_id = (select public.current_app_user_id()));
