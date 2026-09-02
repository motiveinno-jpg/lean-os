-- 스토리지 팩 애드온 — 좌석과 분리된 +10GB, 좌석과 동일 단가(per_seat_price 재사용).
-- 설계 문서: docs/20260902_PLAN_storage_pack.md
-- 규칙: 저장 쿼터 = included_storage_bytes + (추가좌석 + 스토리지팩) × storage_per_unit_bytes
--       월 청구액   = base_price          + (추가좌석 + 스토리지팩) × per_seat_price
-- 안전 설계: 사용량 카운터는 '파생값'이라 FK 없음 + 트리거 예외안전(스토리지 쓰기를 절대 막지 않음).

-- 1) 플랜 저장용량 파라미터 (하드코딩 금지 — 플랜별 조정 가능)
alter table public.subscription_plans
  add column if not exists included_storage_bytes bigint not null default 524288000,    -- 500 MiB 기본
  add column if not exists storage_per_unit_bytes  bigint not null default 10737418240;  -- 10 GiB (좌석1 = 팩1)

-- 2) 구독 스토리지 팩 수량 (좌석과 독립 — Toss 크론이 seat_count는 덮어써도 이건 안 건드림)
alter table public.subscriptions
  add column if not exists storage_pack_count int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_storage_pack_count_nonneg') then
    alter table public.subscriptions
      add constraint subscriptions_storage_pack_count_nonneg check (storage_pack_count >= 0);
  end if;
end $$;

-- 3) 회사별 사용량 카운터 (파생값 — FK 없음: 트리거가 스토리지 쓰기를 절대 막지 않게)
create table if not exists public.company_storage_usage (
  company_id   uuid primary key,
  used_bytes   bigint not null default 0,
  object_count int    not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.company_storage_usage enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='company_storage_usage' and policyname='company_storage_usage_select'
  ) then
    create policy company_storage_usage_select on public.company_storage_usage
      for select using (company_id = public.get_my_company_id());
  end if;
end $$;
-- 쓰기 정책 없음 → 일반 사용자는 write 불가(트리거 security definer / service_role 만 갱신).

-- 4) 스토리지 경로 → company_id (documents 만 2번째 구간, 그 외 1번째; uuid 형식 아니면 null)
create or replace function public.storage_object_company(p_bucket text, p_name text)
returns uuid language plpgsql immutable as $$
declare seg text;
begin
  seg := case when p_bucket = 'documents' then (storage.foldername(p_name))[2]
              else (storage.foldername(p_name))[1] end;
  if seg is null
     or seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return seg::uuid;
end $$;

-- 5) 카운터 유지 트리거 (예외안전 — 어떤 오류도 업로드/삭제를 막지 않음)
create or replace function public.trg_company_storage_usage()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; ocid uuid; sz bigint; osz bigint;
begin
  begin
    if tg_op in ('INSERT','UPDATE') then
      cid := public.storage_object_company(new.bucket_id, new.name);
      sz  := coalesce((new.metadata->>'size')::bigint, 0);
    end if;
    if tg_op in ('UPDATE','DELETE') then
      ocid := public.storage_object_company(old.bucket_id, old.name);
      osz  := coalesce((old.metadata->>'size')::bigint, 0);
    end if;

    if ocid is not null then
      update public.company_storage_usage
        set used_bytes  = greatest(0, used_bytes - osz),
            object_count = greatest(0, object_count - 1),
            updated_at   = now()
      where company_id = ocid;
    end if;
    if cid is not null then
      insert into public.company_storage_usage(company_id, used_bytes, object_count)
      values (cid, sz, 1)
      on conflict (company_id) do update
        set used_bytes  = company_storage_usage.used_bytes + sz,
            object_count = company_storage_usage.object_count + 1,
            updated_at   = now();
    end if;
  exception when others then
    -- 카운터는 파생값 — 어떤 오류도 스토리지 작업을 막지 않는다(야간/온디맨드 정합성으로 보정).
    null;
  end;
  return coalesce(new, old);
end $$;

drop trigger if exists company_storage_usage_sync on storage.objects;
create trigger company_storage_usage_sync
  after insert or update or delete on storage.objects
  for each row execute function public.trg_company_storage_usage();

-- 6) 백필 (기존 파일 → 카운터 초기화)
insert into public.company_storage_usage(company_id, used_bytes, object_count)
select cid, sum(sz), count(*)
from (
  select public.storage_object_company(bucket_id, name) as cid,
         coalesce((metadata->>'size')::bigint, 0) as sz
  from storage.objects
) t
where cid is not null
group by cid
on conflict (company_id) do update
  set used_bytes = excluded.used_bytes, object_count = excluded.object_count, updated_at = now();

-- 7) 조회 RPC — 구독 없는 회사(무료)도 기본 500MiB 반환
create or replace function public.get_company_storage(p_company uuid default null)
returns table(used_bytes bigint, quota_bytes bigint, included_bytes bigint,
              per_unit_bytes bigint, extra_seats int, storage_packs int)
language plpgsql stable security definer set search_path=public as $$
declare
  cid uuid := coalesce(p_company, public.get_my_company_id());
  v_seat int; v_packs int; v_incl_seats int; v_incl_bytes bigint; v_unit bigint; v_found boolean;
begin
  select sub.seat_count, coalesce(sub.storage_pack_count,0), p.included_seats,
         coalesce(p.included_storage_bytes,524288000), coalesce(p.storage_per_unit_bytes,10737418240)
    into v_seat, v_packs, v_incl_seats, v_incl_bytes, v_unit
  from public.subscriptions sub
  join public.subscription_plans p on p.id = sub.plan_id
  where sub.company_id = cid
  order by sub.created_at desc limit 1;
  v_found := found;

  used_bytes := coalesce((select u.used_bytes from public.company_storage_usage u where u.company_id = cid), 0);
  if not v_found then
    included_bytes := 524288000; per_unit_bytes := 10737418240;
    extra_seats := 0; storage_packs := 0;
    quota_bytes := included_bytes;
  else
    included_bytes := v_incl_bytes; per_unit_bytes := v_unit;
    extra_seats := greatest(0, coalesce(v_seat,1) - coalesce(v_incl_seats,0));
    storage_packs := v_packs;
    quota_bytes := v_incl_bytes + (extra_seats + storage_packs)::bigint * v_unit;
  end if;
  return next;
end $$;

-- 8) 팩 수량 변경 (owner 전용). 결제·프로레이션은 앱 API(/api/billing/storage-pack)가 담당.
create or replace function public.set_storage_packs(p_count int)
returns int language plpgsql security definer set search_path=public as $$
declare cid uuid := public.get_my_company_id();
begin
  if not public.is_company_owner() then raise exception 'not authorized'; end if;
  if p_count is null or p_count < 0 then raise exception 'invalid count'; end if;
  update public.subscriptions set storage_pack_count = p_count, updated_at = now()
    where company_id = cid;
  if not found then raise exception 'no subscription'; end if;
  return p_count;
end $$;

grant execute on function public.get_company_storage(uuid) to authenticated;
grant execute on function public.set_storage_packs(int) to authenticated;
