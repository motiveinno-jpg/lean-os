-- 회사 완전 삭제 (2026-08-10 사장님 요청 — "마스터한테만 회사를 아예 삭제할 수 있는 탭")
--
-- reset_company_data(데이터 초기화 — 회사·구성원 보존)와 달리 companies 행까지 지운다.
-- 호출자는 반드시 그 회사의 마스터(users.is_master)여야 하고, 회사명을 정확히 입력해야 한다.
--
-- 설계:
--  · 대상 회사는 파라미터가 아니라 '호출자의 소속' 에서 도출 — 남의 회사 id 를 넣는 공격 자체가 불가능.
--  · reset_company_data 의 고정 테이블 목록은 2026-05 이후 생긴 테이블(근태·휴가·게시판·AI 등)이
--    빠져 있어 재사용하지 않는다. information_schema 에서 company_id 컬럼을 가진 테이블을
--    실행 시점에 전부 찾아 동적으로 지운다 — 새 테이블이 생겨도 자동 포함.
--  · ⚠️ session_replication_role(replica) 는 쓰지 않는다 — 운영의 postgres 롤에는 그 파라미터
--    SET 권한이 없다(2026-08-10 확인: has_parameter_privilege = false. 같은 방식을 쓰는
--    reset_company_data 도 현재 운영에서는 실패할 상태다). 대신 FK 위반을 잡아 가며
--    여러 패스로 반복 삭제한다 — 자식이 먼저 지워지면 다음 패스에서 부모가 지워진다.
--  · company_id 가 없는 자식 테이블(chat_messages 등)은 부모 JOIN 으로 먼저 지운다.
--  · users 행은 삭제(회사가 사라지므로), auth 계정은 보존 — 구성원이 다시 로그인하면
--    회사 설정 화면으로 가서 새로 시작할 수 있다.
--  · 전체가 한 트랜잭션 — companies 행까지 못 지우면 예외를 던져 전부 롤백된다
--    (절반만 지워진 회사가 남지 않는다).
--  · 외부 리소스(Stripe 구독 해지)는 API 라우트가 이 함수 호출 전에 처리한다.

create or replace function public.master_delete_company(p_confirm_name text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user users%rowtype;
  v_company companies%rowtype;
  v_tbl record;
  v_pass int;
  v_deleted bigint;
  v_pass_deleted bigint;
  v_pass_errors int;
  v_failed text[] := '{}';
  v_tables text[];
  t text;
begin
  -- ① 호출자 확인 — 마스터만
  select * into v_user from users where auth_id = auth.uid();
  if v_user.id is null or v_user.company_id is null then
    raise exception 'forbidden: no company' using errcode = '42501';
  end if;
  if not coalesce(v_user.is_master, false) then
    raise exception 'forbidden: master only' using errcode = '42501';
  end if;

  select * into v_company from companies where id = v_user.company_id;
  if v_company.id is null then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  -- ② 회사명 재입력 확인 — 공백 정리 후 완전 일치.
  --    회사명이 비어 있는 계정(온보딩 중단 등)은 영원히 못 지우게 되므로 '회사 삭제' 문구로 대체.
  if btrim(coalesce(p_confirm_name, '')) <> coalesce(nullif(btrim(v_company.name), ''), '회사 삭제') then
    raise exception 'confirm_name_mismatch' using errcode = 'P0001';
  end if;

  -- ③ company_id 가 없는 자식/손자 — 부모가 지워지기 전에 먼저 (깊은 것부터)
  delete from chat_reactions where message_id in (
    select cm.id from chat_messages cm where cm.channel_id in (select id from chat_channels where company_id = v_company.id));
  delete from chat_mentions      where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_files         where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_action_cards  where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_messages      where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_events        where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_members       where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from chat_participants  where channel_id in (select id from chat_channels where company_id = v_company.id);
  delete from deal_milestones        where deal_id in (select id from deals where company_id = v_company.id);
  delete from deal_assignments       where deal_id in (select id from deals where company_id = v_company.id);
  delete from deal_revenue_schedule  where deal_id in (select id from deals where company_id = v_company.id);
  delete from deal_nodes             where deal_id in (select id from deals where company_id = v_company.id);
  delete from sub_deals              where parent_deal_id in (select id from deals where company_id = v_company.id);
  delete from approval_steps where request_id in (select id from approval_requests where company_id = v_company.id);
  delete from doc_revisions  where document_id in (select id from documents where company_id = v_company.id);
  delete from doc_approvals  where document_id in (select id from documents where company_id = v_company.id);
  delete from hr_contract_package_items where document_id in (select id from documents where company_id = v_company.id);
  delete from document_share_feedback where share_id in (select id from document_shares where company_id = v_company.id);
  delete from document_share_views    where share_id in (select id from document_shares where company_id = v_company.id);
  delete from loan_payments            where loan_id in (select id from loans where company_id = v_company.id);
  delete from closing_checklist_items  where checklist_id in (select id from closing_checklists where company_id = v_company.id);
  delete from treasury_transactions    where position_id in (select id from treasury_positions where company_id = v_company.id);
  delete from payroll_items            where batch_id in (select id from payment_batches where company_id = v_company.id);
  delete from transaction_matches      where transaction_id in (select id from transactions where company_id = v_company.id);

  -- ④ company_id 를 가진 모든 테이블 — 실행 시점 동적 탐색 후 다회 패스 삭제.
  --    FK 로 아직 못 지우는 테이블은 그 패스에서 건너뛰고, 자식이 지워진 다음 패스에서 지워진다.
  --    company_id 타입이 uuid/text 혼재라 ::text 비교로 통일. users·companies 는 마지막에 별도.
  select array_agg(c.table_name) into v_tables
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name = 'company_id'
    and tb.table_type = 'BASE TABLE'
    and c.table_name not in ('users', 'companies');

  for v_pass in 1..8 loop
    v_pass_deleted := 0;
    v_pass_errors := 0;
    v_failed := '{}';
    foreach t in array v_tables loop
      begin
        execute format('delete from %I where company_id::text = $1', t) using v_company.id::text;
        get diagnostics v_deleted = row_count;
        v_pass_deleted := v_pass_deleted + v_deleted;
      exception
        when foreign_key_violation then
          -- 자식이 아직 남음 — 다음 패스에서 재시도
          v_pass_errors := v_pass_errors + 1;
          v_failed := array_append(v_failed, t);
        when others then
          -- 업무 규칙 트리거가 삭제를 막는 경우(예: allowance_types 의 "법정 수당은 삭제 불가").
          -- 회사 자체가 사라지는 삭제이므로 그 테이블만 사용자 트리거를 끄고 지운다.
          -- FK 는 internal 트리거라 계속 검사된다(무결성 유지). DDL 은 트랜잭션에 묶인다.
          begin
            execute format('alter table %I disable trigger user', t);
            execute format('delete from %I where company_id::text = $1', t) using v_company.id::text;
            get diagnostics v_deleted = row_count;
            v_pass_deleted := v_pass_deleted + v_deleted;
            execute format('alter table %I enable trigger user', t);
          exception when others then
            begin execute format('alter table %I enable trigger user', t); exception when others then null; end;
            v_pass_errors := v_pass_errors + 1;
            v_failed := array_append(v_failed, t);
          end;
      end;
    end loop;
    -- 더 지울 것도, 막힌 것도 없으면 종료. 지운 게 없는데 막힌 것만 남았으면 더 돌아도 소용없음.
    exit when v_pass_errors = 0 or v_pass_deleted = 0;
  end loop;

  if coalesce(array_length(v_failed, 1), 0) > 0 then
    raise exception 'delete blocked by fk: %', array_to_string(v_failed, ', ');
  end if;

  -- ⑤ 구성원 행 삭제(auth 계정은 보존 — 재로그인 시 회사 설정부터 새로 시작), 회사 행 삭제.
  --    여기서 실패하면 예외 → 트랜잭션 전체 롤백(절반 삭제 없음).
  delete from users where company_id = v_company.id;
  delete from companies where id = v_company.id;

  return json_build_object('ok', true, 'company', v_company.name, 'tables_swept', coalesce(array_length(v_tables, 1), 0));
end;
$$;

-- 마스터 본인만 의미 있게 실행 가능(함수 안에서 검증)하지만, 호출 자체는 로그인 사용자로 제한.
revoke execute on function public.master_delete_company(text) from anon;
grant execute on function public.master_delete_company(text) to authenticated;
