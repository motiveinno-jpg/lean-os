-- 세무 마감 신고본(tax_returns) — 2026-10-12 세무 2차 결정 258 (docs/20261012_PLAN_tax_closing_v2.md)
--
-- 왜: 세무 신고 화면은 매번 지금 장부로 다시 계산한다. 그래서 신고한 뒤 전표가 바뀌면 "그때 무엇을 냈는지"가 사라지고,
--     수정신고를 할 때 무엇과 비교해야 하는지 알 수 없었다.
--     '세무 마감' = 낸 신고서 숫자를 그 순간 그대로 한 줄로 남기는 것(신고본). 데이터를 잠그지는 않는다 —
--     나중에 다시 계산한 값은 같은 기간의 가장 최근 마감본(status='closed' 중 revision 최대)과 비교해 수정신고로 안내한다.
--
-- 규칙:
--   kind       = vat · wht · simple_statement · annual_statement · daily_work_report · insurance_report
--   period_key = 기간 열쇠(문자) — vat '2026-1-final' / '2026-2-prelim', wht '2026-09' 처럼 화면(lib)이 정한다.
--   revision   = 0 정기, 1.. 수정 차수. 같은 회사·종류·기간에서 (지금까지 최대 차수 + 1) 만 받는다(취소본 포함 — 번호를 다시 쓰지 않는다).
--                없으면 0. 빈 번호·중복 번호를 막는다. 동시 마감은 advisory lock 으로 줄 세운다.
--   신고본은 고치지 않는다 — 바꿀 수 있는 것은 'closed → cancelled' 한 번뿐(취소한 사람·시각·사유만 채운다).
--     그 밖의 칸이 하나라도 바뀌면 거절한다. 지우기 정책은 두지 않는다(이력이다).
--   closed_by / cancelled_by = public.users.id — auth.uid() 와 다를 수 있어(운영 2명) current_app_user_id() 로 맞춘다.
--   읽기·마감·취소 = 같은 회사 AND has_perm('/finance/tax-filing') (has_perm 은 마스터 포함).
--   세무대리인 쓰기 금지 — advisor_ro_* RESTRICTIVE 정본 패턴 그대로.
--
-- 기존 데이터: 새 표라 없음.
-- 버린 안: closing_snapshots(월 회계 마감 확정본)에 kind 를 더해 같이 쓰기 — 그 표는 '월' 단위·회계마감 권한이고,
--          세무 신고는 기간 단위(반기·분기·월)·세무 신고 권한이라 열쇠와 권한이 둘 다 다르다.
--          / 신고본을 고칠 수 있게(update) 두기 — 낸 신고서가 나중에 바뀌면 수정신고 비교 기준이 사라진다. 고칠 일은 '취소 후 새 차수'로.

create table if not exists public.tax_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('vat', 'wht', 'simple_statement', 'annual_statement', 'daily_work_report', 'insurance_report')),
  period_key text not null,
  revision int not null default 0 check (revision >= 0),
  status text not null default 'closed' check (status in ('closed', 'cancelled')),
  figures jsonb not null default '{}'::jsonb,      -- 신고서 칸별 값
  schedules jsonb not null default '{}'::jsonb,    -- 부속서류
  source_ids jsonb not null default '{}'::jsonb,   -- 근거 자료 id 목록
  manual jsonb not null default '{}'::jsonb,       -- 사람이 직접 넣은 칸
  note text,
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz not null default now(),
  cancelled_by uuid references public.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);

comment on table public.tax_returns is
  '세무 마감 신고본 — 낸 신고서 숫자 스냅샷. 고치지 않고 취소 후 새 차수로. 수정신고 비교 기준(결정 258).';

create unique index if not exists tax_returns_closed_uq
  on public.tax_returns (company_id, kind, period_key, revision) where status = 'closed';
create index if not exists tax_returns_company_kind_period_idx
  on public.tax_returns (company_id, kind, period_key);

-- ── 권한(RLS) ────────────────────────────────────────────────────────────
alter table public.tax_returns enable row level security;

revoke all on public.tax_returns from anon;
revoke delete, truncate, references, trigger on public.tax_returns from authenticated;
grant select, insert, update on public.tax_returns to authenticated;

drop policy if exists tax_returns_select on public.tax_returns;
create policy tax_returns_select on public.tax_returns
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (select public.has_perm('/finance/tax-filing'))
  );

drop policy if exists tax_returns_insert on public.tax_returns;
create policy tax_returns_insert on public.tax_returns
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and (select public.has_perm('/finance/tax-filing'))
    and closed_by = (select public.current_app_user_id())
  );

--   취소만 — 무엇이 바뀔 수 있는지는 아래 tax_returns_guard 트리거가 맡는다(RLS 는 칸 단위를 못 본다).
drop policy if exists tax_returns_update on public.tax_returns;
create policy tax_returns_update on public.tax_returns
  for update to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (select public.has_perm('/finance/tax-filing'))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and (select public.has_perm('/finance/tax-filing'))
  );

-- 지우기 정책 없음 — 신고본은 이력이다.

drop policy if exists advisor_ro_ins on public.tax_returns;
create policy advisor_ro_ins on public.tax_returns as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.tax_returns;
create policy advisor_ro_upd on public.tax_returns as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.tax_returns;
create policy advisor_ro_del on public.tax_returns as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ── 트리거 ───────────────────────────────────────────────────────────────
-- 차수 확인(INSERT) + 칸 보호(UPDATE). SECURITY INVOKER — 마감 권한자는 RLS 로 같은 기간 줄을 모두 본다.
create or replace function public.tax_returns_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_next int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'closed' then
      raise exception '신고본은 마감(closed) 상태로만 만들 수 있습니다.' using errcode = 'P0001';
    end if;
    if new.cancelled_by is not null or new.cancelled_at is not null or new.cancel_reason is not null then
      raise exception '새 신고본에 취소 정보를 넣을 수 없습니다.' using errcode = 'P0001';
    end if;
    -- 같은 회사·종류·기간 마감을 한 줄로 세운다(동시에 두 사람이 마감해도 차수가 겹치지 않게)
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || '|' || new.kind || '|' || new.period_key, 0));
    select coalesce(max(revision) + 1, 0) into v_next
      from public.tax_returns
     where company_id = new.company_id and kind = new.kind and period_key = new.period_key;
    if new.revision is distinct from v_next then
      raise exception '차수가 맞지 않습니다 — 이 기간의 다음 차수는 %입니다(받은 값 %).', v_next, new.revision using errcode = 'P0001';
    end if;
    new.closed_at := now();
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: closed → cancelled 한 번만, 취소 정보만
  if old.status <> 'closed' or new.status <> 'cancelled' then
    raise exception '신고본은 고칠 수 없습니다 — 마감본을 취소하는 것만 됩니다.' using errcode = 'P0001';
  end if;
  if row(new.id, new.company_id, new.kind, new.period_key, new.revision, new.figures, new.schedules,
         new.source_ids, new.manual, new.note, new.closed_by, new.closed_at, new.created_at)
     is distinct from
     row(old.id, old.company_id, old.kind, old.period_key, old.revision, old.figures, old.schedules,
         old.source_ids, old.manual, old.note, old.closed_by, old.closed_at, old.created_at)
  then
    raise exception '신고본 내용은 바꿀 수 없습니다 — 취소 후 새 차수로 마감해 주세요.' using errcode = 'P0001';
  end if;
  if current_user = 'authenticated' then
    new.cancelled_by := public.current_app_user_id();   -- 화면 값을 믿지 않는다
  end if;
  new.cancelled_at := now();
  return new;
end $$;

revoke execute on function public.tax_returns_guard() from public, anon, authenticated;

drop trigger if exists tax_returns_guard on public.tax_returns;
create trigger tax_returns_guard before insert or update on public.tax_returns
  for each row execute function public.tax_returns_guard();
