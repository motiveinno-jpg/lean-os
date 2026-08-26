-- 직원 기본 권한: 재고 보기 7개 자동 부여 (2026-08-26 사장님)
--   "직원은 재고가 보이고, 재무·인사는 기본으로 안 보여야 한다 — 인사엔 연봉 등 예민한 것이 있다."
--   · 재무·인사는 always 메뉴가 없으면 그룹이 숨는다(구성원 디렉토리는 업무로 옮김). 재고는 반대로 '기본 부여'가 필요하다.
--   · always(부여 대상 아님)와 달리 **회수 가능한 부여**로 둔다 — 회사마다 재고를 안 쓰면 마스터가 빼면 된다.
--   · 합류 경로가 4곳(초대 수락·기존 직원 추가·빠른 추가·합류 요청 승인)이라 앱이 아니라 users 트리거에서 한 번에 심는다.
--   · 목록은 src/lib/permissions.ts 의 defaultGrant 와 같아야 한다 — 한쪽만 고치지 말 것.
--   · 현황(/inventory/status: 매출·마진)·:write·:adjust 는 기본 부여하지 않는다.

create or replace function public._seed_member_default_perms(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_company is null or p_user is null then return; end if;
  foreach k in array array['/inventory/products','/inventory/stock','/inventory/orders','/inventory/sales','/inventory/purchase','/inventory/production','/inventory/channels'] loop
    insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
    select p_company, p_user, k, null, now()
    where not exists (select 1 from public.member_permissions m where m.company_id = p_company and m.user_id = p_user and m.perm_key = k);
  end loop;
end $$;
revoke all on function public._seed_member_default_perms(uuid, uuid) from public, anon, authenticated;

create or replace function public._trg_users_seed_default_perms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  --   회사에 들어온 직원·관리자만. 마스터는 전 메뉴, 파트너·세무 파트너는 각자 규칙.
  if new.company_id is not null and new.role in ('employee', 'admin') and coalesce(new.is_master, false) = false
     and (tg_op = 'INSERT' or old.company_id is distinct from new.company_id or old.role is distinct from new.role) then
    perform public._seed_member_default_perms(new.company_id, new.id);
  end if;
  return new;
end $$;
drop trigger if exists users_seed_default_perms on public.users;
create trigger users_seed_default_perms
  after insert or update of company_id, role on public.users
  for each row execute function public._trg_users_seed_default_perms();

-- 백필: 지금 회사에 있는 직원·관리자 전원
do $$
declare r record;
begin
  for r in select id, company_id from public.users where company_id is not null and role in ('employee', 'admin') and coalesce(is_master, false) = false loop
    perform public._seed_member_default_perms(r.company_id, r.id);
  end loop;
end $$;
