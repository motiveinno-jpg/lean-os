-- 전표입력 단일 그리드(§3-3-A) 인라인 수정 지원 (2026-06-12 핸드오프)
--   1) journal_entry_audits: 수정 이력 — 누가/언제/변경 전 값(jsonb) 보존
--   2) update_manual_voucher RPC: 확정 전표 인라인 수정 — 차대균형·마감월·계정소유 재검증 + 이력 기록
--   삭제는 기존 voucher_reject(status=rejected, 행 보존) 그대로 — 행 자체가 이력.

-- ── 1. 수정 이력 테이블 ──
create table if not exists public.journal_entry_audits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  action text not null check (action in ('update','delete')),
  actor_id uuid,
  before jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_journal_entry_audits_entry on public.journal_entry_audits (entry_id, created_at desc);

alter table public.journal_entry_audits enable row level security;

drop policy if exists journal_entry_audits_select on public.journal_entry_audits;
create policy journal_entry_audits_select on public.journal_entry_audits
  for select using (company_id = public.get_my_company_id() and public.is_company_admin());
-- INSERT 는 secdef RPC 내부에서만 (클라이언트 직접 기록 금지 — 위조 방지)

-- ── 2. 확정 전표 인라인 수정 RPC ──
--   p_lines: [{account_id, debit, credit, partner_id, memo}] — save_manual_voucher 와 동일 형식.
--   일자(entry_date)·전표번호(voucher_no)·구분(voucher_type)은 변경 불가(인라인 수정 범위 밖).
create or replace function public.update_manual_voucher(
  p_entry_id uuid,
  p_description text,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_e record;
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_d numeric; v_c numeric;
  v_acct uuid;
  v_before jsonb;
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status <> 'confirmed' then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;

  -- hard guard: locked accounting period
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'NEED_TWO_LINES';
  end if;

  -- validate lines + totals (one side per line, account must belong to company)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line->>'debit')::numeric, 0);
    v_c := coalesce((v_line->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or (v_d = 0 and v_c = 0) then
      raise exception 'INVALID_LINE_AMOUNT';
    end if;
    v_acct := (v_line->>'account_id')::uuid;
    if v_acct is null or not exists (select 1 from chart_of_accounts a where a.id = v_acct and a.company_id = v_company) then
      raise exception 'INVALID_ACCOUNT';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  -- audit: snapshot before-state (header description + all lines)
  select jsonb_build_object(
    'description', v_e.description,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'account_id', jl.account_id, 'debit', jl.debit, 'credit', jl.credit,
      'partner_id', jl.partner_id, 'memo', jl.description
    ) order by jl.created_at), '[]'::jsonb)
  ) into v_before
  from journal_lines jl where jl.entry_id = p_entry_id;

  insert into journal_entry_audits (company_id, entry_id, action, actor_id, before)
  values (v_company, p_entry_id, 'update', v_uid, v_before);

  -- replace lines
  delete from journal_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (
      p_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid
    );
  end loop;

  update journal_entries
  set description = coalesce(p_description, description),
      reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
end;
$$;

grant execute on function public.update_manual_voucher(uuid, text, jsonb) to authenticated;
