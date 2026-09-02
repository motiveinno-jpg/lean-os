-- 20260902050000_document_folders_visibility.sql
-- 파일보관함 폴더 공개 범위 4단계 + 숨김을 RLS 로 (결정 146, 드팜므 문의발 P4)
--
-- ── History ────────────────────────────────────────────────────────────────
-- document_folders / document_files 는 처음부터 "회사 하나 = 한 칸" 이었다.
-- 두 표 모두 정책이 `ALL USING (company_id = get_my_company_id())` 한 줄(그것도
-- document_folders_company / document_folders_company_isolation 으로 같은 내용이
-- 두 번 붙어 있다 — 과거 두 마이그레이션이 각각 만든 흔적)뿐이라,
-- 회사에 속한 사람은 남의 폴더도 전부 본다. 드팜므에서 "인사 폴더를 팀장만
-- 보이게 할 수 없냐"는 문의가 왔고, 화면에서 걸러 숨기는 방식은 조회 API 를
-- 직접 부르면 뚫린다. 이미 일정(schedule_events)이 2026-06 에 같은 문제를
-- visibility + target_user_ids + target_departments 3칸 + SELECT 정책으로 풀었으므로
-- (`view visible events` 정책), 그 문법을 그대로 미러링한다.
--
-- ── 자문자답 ───────────────────────────────────────────────────────────────
-- ① 무엇을 기준으로 판단하나? → **폴더가 경계다. 파일은 폴더를 따른다.**
--    파일마다 공개 범위를 또 두면 "폴더는 보이는데 안이 비어 있다"가 생기고
--    사용자는 어디서 잘렸는지 알 수 없다. 폴더 한 곳에서만 정한다.
-- ② 기존 폴더는? → 기본값 'company' = 지금 동작 그대로. **소급 없음.**
--    created_by 는 기존 폴더에 null(만든 사람 모름) — private 판정에서 null 이면
--    소유자가 없는 것으로 처리돼 아무에게도 안 보인다. 기존 폴더는 전부
--    'company' 라 이 경로를 타지 않는다.
-- ③ 반례 — 폴더 없는 파일은? → folder_id is null 이면 **회사 전체(지금과 동일)**.
--    documentId / dealId / vaultDocId 로 붙는 첨부는 folder_id 가 null 이라
--    (src/lib/file-storage.ts uploadFile: folder_id: context?.folderId || null)
--    9개 화면의 첨부 조회는 영향을 받지 않는다. 적용 시점 현재 실측:
--    document_files 8건 중 folder_id is null 3건.
--
-- ── 결정 ───────────────────────────────────────────────────────────────────
-- 규칙: 폴더에 visibility(private/members/departments/company). 숨김은 RLS 가 한다.
-- AS_IS ▶ TO_BE: 회사 전원이 전 폴더 열람 ▶ 공개 범위에 든 사람만 폴더와 그 안 파일.
-- 적용 시점: 이 마이그레이션부터. 기존 데이터 처리: 전부 'company' 기본값(무변화).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) document_folders 공개 범위 칸
-- ───────────────────────────────────────────────────────────────────────────
alter table public.document_folders
  add column if not exists visibility text not null default 'company',
  add column if not exists target_user_ids uuid[] not null default '{}',
  add column if not exists target_departments text[] not null default '{}',
  add column if not exists created_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.document_folders'::regclass
       and conname = 'document_folders_visibility_check'
  ) then
    alter table public.document_folders
      add constraint document_folders_visibility_check
      check (visibility in ('private','members','departments','company'));
  end if;
end $$;

comment on column public.document_folders.visibility is
  '공개 범위: private(만든 사람만) / members(지정한 사람) / departments(지정한 부서) / company(회사 전체·기본값). 숨김은 RLS 가 한다.';
comment on column public.document_folders.created_by is
  '만든 사람(users.id). 기존 폴더는 null — private 판정에서 null 이면 소유자 없음으로 처리.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2) RLS — document_folders
--    기존 정책(document_folders_company, document_folders_company_isolation)은
--    둘 다 `ALL USING (company_id = get_my_company_id())` 인 **같은 내용의 중복**이다.
--    PERMISSIVE 정책은 OR 로 합쳐지므로, 이 둘을 남긴 채 SELECT 정책만 추가하면
--    회사 스코프 하나로 다 통과해 아무것도 숨겨지지 않는다. → 둘을 걷어내고
--    select / insert / update / delete 를 명시적으로 다시 깐다(쓰기는 기존과 동일한
--    회사 스코프 — 동작 변화 없음).
--    ※ RESTRICTIVE 정책(advisor_ro_ins/upd/del)은 건드리지 않는다.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists "document_folders_company" on public.document_folders;
drop policy if exists "document_folders_company_isolation" on public.document_folders;
drop policy if exists "document_folders_select_visible" on public.document_folders;
drop policy if exists "document_folders_insert_company" on public.document_folders;
drop policy if exists "document_folders_update_company" on public.document_folders;
drop policy if exists "document_folders_delete_company" on public.document_folders;

-- SELECT: schedule_events 의 `view visible events` 와 같은 문법(같은 원칙).
create policy "document_folders_select_visible" on public.document_folders
  for select using (
    company_id = (select public.get_my_company_id())
    and (
      created_by = (select u.id from public.users u where u.auth_id = (select auth.uid()))
      or visibility = 'company'
      or (visibility = 'members'
          and (select u.id from public.users u where u.auth_id = (select auth.uid())) = any (target_user_ids))
      or (visibility = 'departments' and public.get_my_department() = any (target_departments))
    )
  );

-- INSERT/UPDATE/DELETE: 기존과 같은 회사 스코프 유지.
-- ※ 공개 범위(visibility/target_*)를 누가 바꿀 수 있는지 — 폴더 권한 관리 주체 제한은
--   이번 범위가 아니다(결정 146 는 "보이기/숨기기"까지). 지금은 회사 구성원이면 바꿀 수 있다.
--   나중에 조일 자리: 아래 update 정책의 using/with check 에 created_by 또는 has_perm 추가.
create policy "document_folders_insert_company" on public.document_folders
  for insert with check (company_id = (select public.get_my_company_id()));

create policy "document_folders_update_company" on public.document_folders
  for update using (company_id = (select public.get_my_company_id()))
          with check (company_id = (select public.get_my_company_id()));

create policy "document_folders_delete_company" on public.document_folders
  for delete using (company_id = (select public.get_my_company_id()));

-- ───────────────────────────────────────────────────────────────────────────
-- 3) RLS — document_files : 파일은 폴더를 따른다
--    기존 정책도 document_files_company / document_files_company_isolation 중복 ALL.
--    SELECT 만 폴더 조건을 얹고, 나머지는 기존 회사 스코프 그대로 다시 깐다.
--    in (select id from public.document_folders) 는 folders 의 RLS 를 다시 타므로
--    "폴더가 안 보이면 그 안 파일도 안 보인다" 가 된다.
--    ⚠ document_files 는 9개 화면이 매달린 표다. documentId / dealId / vaultDocId 로
--      붙는 첨부는 folder_id 가 null 이라 `folder_id is null` 가지로 전부 통과 —
--      기존 화면 영향 없음(적용 시점 실측: 8건 중 3건이 folder_id null, 나머지 5건은
--      보관함 폴더 파일이며 그 폴더는 전부 visibility='company').
--    ※ RESTRICTIVE 정책(advisor_ro_*, document_files_delete_owner_or_perm)은 그대로 둔다.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists "document_files_company" on public.document_files;
drop policy if exists "document_files_company_isolation" on public.document_files;
drop policy if exists "document_files_select_visible" on public.document_files;
drop policy if exists "document_files_insert_company" on public.document_files;
drop policy if exists "document_files_update_company" on public.document_files;
drop policy if exists "document_files_delete_company" on public.document_files;

create policy "document_files_select_visible" on public.document_files
  for select using (
    company_id = (select public.get_my_company_id())
    and (
      folder_id is null
      or folder_id in (select f.id from public.document_folders f)
    )
  );

create policy "document_files_insert_company" on public.document_files
  for insert with check (company_id = (select public.get_my_company_id()));

create policy "document_files_update_company" on public.document_files
  for update using (company_id = (select public.get_my_company_id()))
          with check (company_id = (select public.get_my_company_id()));

create policy "document_files_delete_company" on public.document_files
  for delete using (company_id = (select public.get_my_company_id()));

-- 성능: document_files(folder_id) 는 idx_document_files_folder_id 로 이미 있다(중복 생성 안 함).
-- 폴더 목록 조회가 회사+공개범위로 걸리므로 폴더 쪽 보조 인덱스만 보강.
create index if not exists idx_document_folders_created_by
  on public.document_folders (created_by);
create index if not exists idx_document_folders_company_visibility
  on public.document_folders (company_id, visibility);

-- ───────────────────────────────────────────────────────────────────────────
-- 4) 버킷 한도 — 결정 146 ①
--    적용 전 실측: storage.buckets.file_size_limit for 'document-files' = NULL
--    (= 버킷 한도 없음 → 프로젝트 전역 한도가 그대로 적용되던 상태. 화면에 적힌 50MB 는
--     전역 한도값이었다). 여기서 버킷 한도를 500MB 로 못박는다.
--    ⚠ 전역 한도(Storage 설정의 global file size limit)는 SQL 로 못 바꾼다.
--      실제 업로드 상한 = min(전역 한도, 버킷 한도) 이므로, 전역이 50MB 로 남아 있으면
--      이 값만으로는 500MB 가 되지 않는다 → 대시보드(Storage › Settings)에서 확인·상향 필요.
update storage.buckets
   set file_size_limit = 524288000  -- 500MB
 where id = 'document-files';
