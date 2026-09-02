-- 20260902060000_folder_perm_hardening.sql
-- 파일보관함 폴더 — 공개 범위를 '누가' 바꾸나 + 실물(스토리지)까지 잠그기
-- (20260902050000_document_folders_visibility.sql 이 남긴 '나중에 조일 자리' 2건)
--
-- ── History ────────────────────────────────────────────────────────────────
-- 2026-09-02 의 앞 마이그레이션(20260902050000)이 폴더에 visibility 4단계를 넣고
-- SELECT 를 RLS 로 잠갔다. 그때 두 곳을 일부러 미뤘고, 주석에 그대로 적어 뒀다.
--   ① document_folders UPDATE/DELETE 는 회사 스코프 한 줄 그대로 —
--      "지금은 회사 구성원이면 바꿀 수 있다. 나중에 조일 자리: update 정책의
--       using/with check 에 created_by 또는 has_perm 추가."
--      → 즉 아무나 남의 'private(나만)' 폴더를 visibility='company' 로 바꿔 열어 보거나
--        폴더째로 지울 수 있다. 숨김을 RLS 로 옮긴 의미가 UPDATE 한 줄로 무너진다.
--   ② storage.objects 의 document_files_select 는
--      `bucket_id='document-files' AND foldername(name)[1] = company_id` 뿐 —
--      표(document_files)는 폴더 RLS 를 따르게 막았지만, **실물 객체**는 회사 스코프다.
--      경로를 아는 사람(전에 받아 뒀던 링크·로그·이전 권한 시절 캡처)은
--      createSignedUrl 로 권한 밖 폴더 파일을 그대로 받아낸다.
-- 권한자 판정 문법은 새로 만들지 않는다 — 이미 2026-08-20 에
-- document_files_delete_owner_or_perm(RESTRICTIVE) 이
--   `uploaded_by = (select current_app_user_id()) or (select has_perm('/documents:delete'))`
-- 로 굳혀 뒀고, 화면 권한 카탈로그에도 /documents 아래 세부키는 delete 하나뿐이다
-- (src/lib/permissions.ts: "남의 파일 삭제"). 같은 함수·같은 키를 재사용한다
-- (새 perm_key 를 만들면 member_permissions 백필 없이는 마스터 외 아무도 못 쓴다).
--
-- ── 자문자답 ───────────────────────────────────────────────────────────────
-- ① 폴더의 공개 범위는 **누가** 바꾸나? → **만든 사람 + 권한자**(마스터 또는
--    '/documents:delete' 위임자). 폴더는 "내가 정한 경계"이므로 남이 함부로 열면
--    경계가 아니고, 반대로 퇴사·부재 시 아무도 못 고치면 폴더가 잠겨 버리므로
--    권한자에게 문은 남긴다.
-- ② created_by 가 null 인 옛 폴더는? → **권한자만.** 소유자 불명 폴더를
--    "주인이 없으니 아무나" 로 열면 지금 상태(아무나)와 같아진다. 잠그는 쪽이 기본.
--    `created_by = (select current_app_user_id())` 는 null 일 때 자연히 false 라
--    별도 분기 없이 이 결론이 나온다.
-- ③ 반례 — 표만 막으면 되지 않나? → 아니다. **실물까지 막아야 "안 보인다"가 참이다.**
--    document_files 행이 안 보이면 화면에는 안 나오지만, 서명 URL 발급은
--    storage.objects 정책만 통과하면 된다. 그래서 경로에서 폴더를 되읽어
--    folders 표(그 사용자 시야의 RLS)로 다시 거른다.
-- ④ 자동으로 못 푸는 것 → 경로가 폴더 소속인지는 **경로 문법**으로만 안다
--    (`{companyId}/folders/{folderId}/{ts}_{rand}`, src/lib/file-storage.ts
--     buildStoragePath). general/ · documents/{id}/ · deals/{id}/ · vault/{id}/ 는
--    폴더가 없으므로 기존 회사 스코프 그대로 둔다 — 이 갈래를 안 남기면
--    9개 화면의 첨부 다운로드가 전부 깨진다(적용 시점 실측: document-files 객체 4건 중
--    folders/ 1건, 그 외 3건).
--
-- ── 결정 ───────────────────────────────────────────────────────────────────
-- 규칙 1: 폴더 UPDATE·DELETE = 회사 스코프 AND (만든 사람 OR 권한자).
--   AS_IS ▶ TO_BE: 회사 구성원 누구나 남의 폴더 범위 변경·삭제 ▶ 만든 사람·권한자만.
--   적용 시점: 이 마이그레이션부터. 기존 데이터: 칸 변경 없음(정책만). created_by null
--   폴더는 권한자만 손댈 수 있게 되며, 그런 폴더의 이름 변경이 막히면 마스터가 하면 된다.
-- 규칙 2: storage.objects SELECT = 회사 스코프 AND (폴더 경로가 아니거나 OR 그 폴더가 보이거나).
--   AS_IS ▶ TO_BE: 경로만 알면 권한 밖 폴더 파일도 서명 URL 발급 ▶ 폴더가 보이는 사람만.
--   적용 시점: 이 마이그레이션부터. 기존 데이터: 객체 이동·경로 변경 없음.
-- ※ INSERT/UPDATE/DELETE(스토리지)는 손대지 않는다 — 업로드 흐름(insert 는 파일이
--   놓일 폴더가 아직 표에 없을 수도 있는 순서)을 깨지 않기 위해서다. 스토리지 DELETE 는
--   이미 업로더/권한자 조건이 붙어 있다(document_files_delete). 남은 갈래는 다음 자리.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) document_folders UPDATE / DELETE — 만든 사람 또는 권한자
--    ※ RESTRICTIVE 정책(advisor_ro_upd/del)과 SELECT/INSERT 정책은 그대로 둔다.
--    ※ with check 도 같은 식 — using 만 조이면 "남의 폴더로 넘기는" 위조는 막히지만
--      자기 폴더의 created_by 를 남에게 넘겨 자기 손을 떠나게 만드는 것은 통과한다.
--      created_by 불변(immutable) 까지는 요구하지 않는다(화면이 보내지 않는 칸이고,
--      소유권 이전을 나중에 기능으로 열 수 있어야 한다). 필요해지면 트리거로.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists "document_folders_update_company" on public.document_folders;
drop policy if exists "document_folders_delete_company" on public.document_folders;
drop policy if exists "document_folders_update_owner_or_perm" on public.document_folders;
drop policy if exists "document_folders_delete_owner_or_perm" on public.document_folders;

create policy "document_folders_update_owner_or_perm" on public.document_folders
  for update using (
    company_id = (select public.get_my_company_id())
    and (
      created_by = (select public.current_app_user_id())
      or (select public.has_perm('/documents:delete'))
    )
  ) with check (
    company_id = (select public.get_my_company_id())
    and (
      created_by = (select public.current_app_user_id())
      or (select public.has_perm('/documents:delete'))
    )
  );

create policy "document_folders_delete_owner_or_perm" on public.document_folders
  for delete using (
    company_id = (select public.get_my_company_id())
    and (
      created_by = (select public.current_app_user_id())
      or (select public.has_perm('/documents:delete'))
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 2) storage.objects — document-files 버킷 SELECT 를 폴더에 연동
--    경로: {companyId}/{context}/{파일명}
--      storage.foldername(name) = {companyId, context…} (마지막 파일명은 빠진다)
--      → [1]=companyId, [2]=context 첫 조각, [3]=folders 뒤의 folderId
--    폴더 소속은 [2]='folders' 인 것만. 나머지(general/documents/deals/vault)는
--    기존 회사 스코프 그대로 통과 → 기존 첨부 다운로드 무영향.
--    uuid 캐스팅 방어: 잘못된 경로(수동 업로드·옛 경로)로 22P02 를 내면 정책 평가가
--      에러가 되어 조회 전체가 죽는다. and 는 평가 순서가 보장되지 않으므로
--      case 로 감싸 uuid 모양일 때만 캐스팅하고, 아니면 null →
--      `null in (subquery)` = null = 통과 아님(= 거부)로 떨어진다.
--    성능: 행마다 document_folders 서브쿼리(그 자체가 folders RLS 를 다시 탄다).
--      회사당 폴더 수는 수십 규모, 서명 URL 발급은 한 번에 몇 건이라 허용 범위.
--      folders 쪽 인덱스는 앞 마이그레이션에서 깔았다.
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists "document_files_select" on storage.objects;

create policy "document_files_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'document-files'
    and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
    and (
      -- 폴더 소속이 아닌 파일(general/documents/deals/vault …) — 기존 그대로
      (storage.foldername(name))[2] is distinct from 'folders'
      -- 폴더 소속 — 그 폴더가 내 시야에 있어야 한다(folders 표 RLS 가 판단)
      or (case
            when (storage.foldername(name))[3] ~*
                 '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[3])::uuid
            else null
          end) in (select f.id from public.document_folders f)
    )
  );
