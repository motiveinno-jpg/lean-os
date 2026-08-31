-- 백업/임시 테이블 봉합 — RLS 켜고 정책 0개 (= anon/authenticated 전면 차단)
--
-- History
--   2026-08 여러 차례의 데이터 보정 작업에서 `create table … as select …` 로 원본을 떠 놓은
--   백업본들이 public 스키마에 그대로 남았다. public 스키마는 PostgREST 로 노출되고
--   anon/authenticated 에 SELECT 가 기본 부여되므로, **anon 키만으로 이 백업들을 통째로
--   읽을 수 있는 상태**였다 (근태 215행·회사 181행·급여 지급 큐 37행 등 개인정보 포함).
--   supabase advisor `rls_disabled_in_public` ERROR 13건.
--   실측(적용 전, `set local role anon`):
--     attendance_backup_20260807 = 215행, _backup_company_20260810 = 181행,
--     backup_payment_queue_payroll_20260806 = 37행  → 전부 조회됨.
--
-- 결정
--   1) 삭제하지 않는다. 백업은 백업으로서 값이 있고, 지우는 건 되돌릴 수 없다.
--      대신 **읽을 수 있는 사람만 없앤다.**
--   2) RLS 를 켜고 **정책은 만들지 않는다.** 정책 0 = 모든 행이 걸러짐 →
--      anon/authenticated 는 0행. service_role 은 bypassrls 라 그대로 접근 가능하므로
--      운영/복구 작업에는 영향이 없다.
--   3) 추가로 anon/authenticated 의 테이블 권한 자체를 회수한다(이중 방어).
--      나중에 누가 실수로 정책을 하나 붙여도 권한이 없어 뚫리지 않는다.
--   4) 데이터·구조는 손대지 않는다. drop/rename/delete 없음.
--
-- 파급 확인
--   - 이 13개 테이블을 참조하는 함수 0건, 뷰 0건 (pg_proc.prosrc / pg_views.definition 검색).
--   - 클라이언트 코드 참조 0건. `src/types/database.ts` 에 자동 생성된 타입 정의만 존재(런타임 쿼리 아님).
--   - 적용 후 advisor 는 `rls_disabled_in_public` ERROR 13건 → 0건,
--     대신 `rls_enabled_no_policy` INFO 가 13건 늘어난다. **이건 의도한 상태다**(봉인).

do $$
declare
  t text;
  targets text[] := array[
    'attendance_backup_20260807',
    '_backup_company_20260810',
    'backup_payment_queue_payroll_20260806',
    'backup_payment_batches_payroll_20260806',
    '_bak_documents_20260803',
    '_bak_documents_20260803b',
    '_bak_doc_revisions_20260803',
    '_bak_sigreq_doclink_20260803',
    '_bak_document_files_rollen_luke_20260824',
    'backup_20260805_token_unify',
    '_cov_out',
    '_bak_error_logs_resolved_20260825',
    '_bak_error_logs_resolved_20260826'
  ];
begin
  foreach t in array targets loop
    -- 이미 지운 백업이라면 조용히 건너뛴다 (idempotent)
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
