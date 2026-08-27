-- 감사 추적 보강 (2026-08-27 ERP 3순위 ④) — 전표 상태 변경·급여명세 발급을 audit_logs 에 남긴다. 화면: 회사설정 › 접속 보안 › 변경 이력
--   결정 84 — audit_logs 는 이미 서명·결재·파일·프로젝트를 쌓는다(수정·삭제 금지 RLS). 전표(상태·일자·적요)와 급여명세(발급·수정)를 트리거로 더한다.
--   결정 85 — 급여 로그에 금액은 남기지 않는다(회사 전원 열람 가능 → 급여액 누수 방지). 누구 것을 언제 발급/수정했는지만.
create or replace function public._audit_journal_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.entry_date is not distinct from old.entry_date and new.description is not distinct from old.description then return new; end if;
  select id into v_uid from users where auth_id = auth.uid() limit 1;
  insert into audit_logs (company_id, user_id, entity_type, entity_id, action, before_json, after_json, metadata)
  values (new.company_id, coalesce(v_uid, new.reviewed_by, new.created_by),
          'journal_entry', new.id,
          case when tg_op = 'INSERT' then 'create' when new.status is distinct from old.status then new.status else 'update' end,
          case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status, 'entry_date', old.entry_date, 'description', old.description) else null end,
          jsonb_build_object('status', new.status, 'entry_date', new.entry_date, 'description', new.description, 'source', new.source, 'voucher_no', new.voucher_no),
          jsonb_build_object('entry_kind', new.entry_kind));
  return new;
end $$;
drop trigger if exists trg_audit_journal_entry on public.journal_entries;
create trigger trg_audit_journal_entry after insert or update on public.journal_entries for each row execute function public._audit_journal_entry();

create or replace function public._audit_payroll_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.net_pay is not distinct from old.net_pay then return new; end if;
  select id into v_uid from users where auth_id = auth.uid() limit 1;
  insert into audit_logs (company_id, user_id, entity_type, entity_id, action, before_json, after_json, metadata)
  values (new.company_id, v_uid, 'payroll_item', new.id,
          case when tg_op = 'INSERT' then 'create' when new.status is distinct from old.status then coalesce(new.status, 'update') else 'amount_changed' end,
          case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) else null end,
          jsonb_build_object('status', new.status, 'period_month', new.period_month, 'employee_id', new.employee_id), null);
  return new;
end $$;
drop trigger if exists trg_audit_payroll_item on public.payroll_items;
create trigger trg_audit_payroll_item after insert or update on public.payroll_items for each row execute function public._audit_payroll_item();
create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);
