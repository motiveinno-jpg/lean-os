-- 프로젝트 v3 컬럼 타입 확장(사장님 확정 1·2차) + 첨부파일 버킷 (2026-09-01)
--
-- History — 20260831180000_project_item_columns.sql 이 커스텀 컬럼 정의 표를 만들 때
--   타입을 v2.6 옛 칼럼 표에서 옮겨올 수 있는 6종(text·number·date·select·person·partner)으로만
--   제한했다. 표 UI 가 먼저 필요했고, 옛 데이터에 없는 타입을 미리 열어둘 이유가 없었기 때문.
--   이제 사장님이 1·2차로 확정한 컬럼 타입 8종을 추가한다.
--
-- 결정 1 — type 체크 제약을 16종으로 재생성
--   규칙: project_item_columns.type ∈ 기존 6종 + formula·check·url·tel·longtext·auto·files·ovlink
--         + rating·place (2026-09-01 사장님 3차 추가 승인)
--     formula  수식        settings 에 식 정의. 값은 계산이라 fields 에 저장하지 않을 수 있다(화면 몫).
--     check    체크        fields[key] = true/false
--     url      웹 링크
--     tel      전화
--     longtext 긴 글       text 와 저장 형태는 같고 입력 UI(여러 줄)만 다르다
--     auto     자동 날짜   settings.mode = 'created' | 'updated' — 사람이 못 고치는 계산 칸
--     files    첨부파일    값은 파일 메타 배열, 실물은 아래 project-files 버킷
--     ovlink   오너뷰 연결 게시글·문서·전자계약 등 앱 안 레코드 참조
--     rating   평점        fields[key] = 1~5 정수. 범위는 화면·settings 가 지킨다(제약은 타입 목록만).
--     place    위치        주소 텍스트. text 와 저장 형태는 같고 입력·표시(지도 링크 등)만 다르다.
--   AS_IS ▶ TO_BE: 6종만 허용 ▶ 16종 허용. 기존 행은 전부 6종 안이라 재생성 시 검증 통과(백필 없음).
--   적용 시점: 즉시. 기존 데이터 처리: 없음(제약만 넓힘 — 좁히는 변경이 아니라 무손실).
--
-- 결정 2 — files 타입 첨부 실물 저장소 project-files (private)
--   경로 규약: {company_id}/{deal_id}/{item_id}/{uuid}_{원본파일명}
--     → 회사 id 가 **첫 구간**이라 employee-files·receipts 와 같은 격리 문법을 그대로 쓴다
--       (20260820210000 insert · 20260820220000 select · 20260820190000 delete 와 동일 패턴).
--   update 정책은 만들지 않는다 — 업로드는 항상 새 uuid 경로라 덮어쓰기(upsert)가 없다.
--     RLS 기본 deny 이므로 정책이 없으면 이 버킷의 UPDATE 는 아무도 못 한다(의도).
--   크기 20MB · MIME 제한 없음(사장님 지시). 엣지/서버 배치는 service_role 이라 영향 없음.
--
-- 누락 점검: 권한/RLS(아래 명시) · 역할(세무대리인 세션은 상위 표 project_item_columns 의
--   RESTRICTIVE 3종이 이미 막는다) · 기존 데이터(없음) · 되돌리기(제약은 좁히면 되나 기존 값이
--   새 타입이면 실패 — 롤백 시 값 정리 선행) · 외부전송/인쇄/모바일: 해당없음.

-- ─────────────────────────────────────────────────────────────
-- A. project_item_columns.type — 6종 ▶ 16종
-- ─────────────────────────────────────────────────────────────
alter table public.project_item_columns
  drop constraint if exists project_item_columns_type_check;

alter table public.project_item_columns
  add constraint project_item_columns_type_check
  check (type in (
    'text','number','date','select','person','partner',
    'formula','check','url','tel','longtext','auto','files','ovlink',
    'rating','place'
  ));

comment on column public.project_item_columns.type is
  '컬럼 타입 16종 — text·number·date·select·person·partner(2026-08-31) + formula·check·url·tel·longtext·auto(settings.mode=created|updated)·files·ovlink(2026-09-01 확정 1·2차) + rating·place(2026-09-01 3차).';

-- ─────────────────────────────────────────────────────────────
-- B. project-files 버킷 — files 컬럼 첨부 실물 (private, 20MB)
--    경로 {company_id}/{deal_id}/{item_id}/{uuid}_{filename}
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 20971520, null)
on conflict (id) do update
  set public = false,
      file_size_limit = 20971520,
      allowed_mime_types = null;

-- 회사 격리 3종(select/insert/delete). update 는 두지 않는다 = 아무도 덮어쓸 수 없다.
drop policy if exists project_files_storage_select on storage.objects;
create policy project_files_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'project-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

drop policy if exists project_files_storage_insert on storage.objects;
create policy project_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files'
              and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

drop policy if exists project_files_storage_delete on storage.objects;
create policy project_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);
