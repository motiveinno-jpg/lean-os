-- 첫 칸('항목')도 머리에서 끌어 옮길 수 있게 — 그 자리를 표마다 기억한다 (2026-08-06 사장님 지시).
--   null = 맨 앞(지금까지와 같음). 값은 0..칸수 범위로 화면에서 다시 한 번 눌러 담는다.
alter table public.project_boards add column if not exists name_pos smallint;
comment on column public.project_boards.name_pos is '첫 칸(행 이름)이 머리에서 몇 번째에 서는지. null=맨 앞';
