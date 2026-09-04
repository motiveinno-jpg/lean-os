-- 내 상태(회의중·자리비움·외근·집중·퇴근) — 2026-09-04 사장님 "우측 상단 내 이름을 눌렀을 때 현재 상태를 설정, 메신저에도 표시"
--   별도 표 대신 users 에 칸 4개: 회사 구성원이 이미 users 를 읽고(RLS "Users can view company members"),
--   본인 행 UPDATE 도 이미 열려 있다(auth_id = auth.uid()). 새 표를 만들면 users FK 가 필요해 PostgREST junction 오인
--   위험이 생긴다(2026-09-03 장애 교훈) — 칸 추가가 가장 안전하다.
--   presence_until 이 지나면 화면이 '근무중' 으로 본다(서버 잡 없음). null = 직접 해제할 때까지.
alter table public.users
  add column if not exists presence_status text not null default 'available',
  add column if not exists presence_note text,
  add column if not exists presence_until timestamptz,
  add column if not exists presence_set_at timestamptz;

alter table public.users drop constraint if exists users_presence_status_check;
alter table public.users add constraint users_presence_status_check
  check (presence_status in ('available', 'meeting', 'away', 'out', 'focus', 'off'));

comment on column public.users.presence_status is '내 상태: available 근무중 · meeting 회의중 · away 자리비움 · out 외근 · focus 집중 근무 · off 퇴근/휴가';
comment on column public.users.presence_note is '상태 한 줄 메모(30자) — 예: 14시 복귀';
comment on column public.users.presence_until is '이 시각이 지나면 화면이 근무중으로 본다. null = 직접 해제';
