-- 회사 기본 권한 템플릿 — 합류 시 자동 부여 (2026-09-21, 사장님 결정)
--
-- History
--   · 2026-07-30 permission_templates — 마스터가 권한 묶음을 만들어 구성원에게 "한 번에 적용"하는 표.
--     적용은 사람마다 마스터가 손으로 누른다.
--   · 2026-08-26 _seed_member_default_perms — 합류 트리거가 재고 보기 7개만 자동 부여(대표: 재무·인사 기본 비노출).
--   · 2026-09-21 직원 첫날 화면 점검 — 운영 직원 21명(3사) 중 결재 미부여 10·프로젝트 미부여 10.
--     모티브 마스터는 '일반 직원 기본' 템플릿(결재 4·거래처·전자계약·문서함·프로젝트 내 담당)을
--     11명 중 10명에게 손으로 줬다. 초대에는 템플릿 칸이 없어 합류할 때마다 다시 준다.
--
-- 자문자답
--   ① 기준: "회사가 ★ 기본으로 정한 템플릿 하나"가 합류 순간의 초기값이다. 재고 7개(defaultGrant)는 그대로 두고 그 위에 얹는다.
--   ② 왜: 첫날 휴가 신청·내 담당 업무가 막다른 길이 되지 않게. 마스터의 반복 클릭을 없애려고.
--   ③ 반대 경우: 기본 템플릿을 안 정한 회사 → 종전과 완전히 같다(재고 7개만). 템플릿을 나중에 고쳐도 이미 합류한 사람은
--      바뀌지 않는다(템플릿 화면의 기존 원칙 "수정해도 이미 적용된 구성원은 바뀌지 않습니다" 와 같음).
--      마스터 전용 키(/employees:permissions)는 템플릿에 들어 있어도 부여하지 않는다 — 마스터만 가질 수 있는 키.
--   ④ 자동으로 못 푸는 것: 어느 템플릿이 기본인지. 마스터가 템플릿 관리에서 ★ 로 정한다. 회사당 하나.
--
-- 적용 시점: 합류(users.company_id 가 채워지는 순간 — 초대 수락·합류 요청 승인 둘 다 같은 트리거).
-- 기존 데이터: 백필 없음. 이미 합류한 사람은 그대로(마스터가 준 권한을 덮지 않는다).
-- 게이트: feature_rollout 'member_default_template' — 모티브에만 먼저(회사 데이터를 만드는 자동화 규칙).
--   UI(★ 토글·초대 안내)도 같은 게이트를 읽는다. 문제 없으면 company_id null 행으로 전체.

alter table public.permission_templates
  add column if not exists is_default boolean not null default false;
comment on column public.permission_templates.is_default is
  '★ 회사 기본 템플릿 — 합류 트리거(_seed_member_default_perms)가 이 템플릿의 perm_keys 를 자동 부여한다. 회사당 하나.';

create unique index if not exists permission_templates_one_default_per_company
  on public.permission_templates (company_id) where is_default;

create or replace function public._seed_member_default_perms(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_company is null or p_user is null then return; end if;
  --   ① 재고 보기 7개 — 코드 DEFAULT_MEMBER_ROUTES(lib/permissions.ts defaultGrant)와 같은 목록. 한쪽만 고치면 어긋난다.
  foreach k in array array['/inventory/products','/inventory/stock','/inventory/orders','/inventory/sales','/inventory/purchase','/inventory/production','/inventory/channels'] loop
    insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
    select p_company, p_user, k, null, now()
    where not exists (select 1 from public.member_permissions m where m.company_id = p_company and m.user_id = p_user and m.perm_key = k);
  end loop;
  --   ② 회사 기본 템플릿(★) — 게이트가 열린 회사만. feature_on() 은 auth.uid() 에 묶여 있어
  --      서비스 롤(초대 수락 API)에서도 승인 RPC(마스터 세션)에서도 같은 답이 나오도록 표를 직접 본다.
  if exists (select 1 from public.feature_rollout f
              where f.feature = 'member_default_template' and (f.company_id is null or f.company_id = p_company)) then
    insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
    select p_company, p_user, t.k, null, now()
      from (select distinct unnest(perm_keys) as k
              from public.permission_templates
             where company_id = p_company and is_default) t   -- 부분 유일 인덱스로 회사당 최대 1건
     where t.k is not null and t.k <> ''
       and t.k <> '/employees:permissions'   -- 마스터 전용(masterOnly) 키는 템플릿으로 못 준다
       and not exists (select 1 from public.member_permissions m
                        where m.company_id = p_company and m.user_id = p_user and m.perm_key = t.k);
  end if;
end $$;
revoke all on function public._seed_member_default_perms(uuid, uuid) from public, anon, authenticated;

--   모티브에만 먼저
insert into public.feature_rollout (feature, company_id)
select 'member_default_template', 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
where not exists (select 1 from public.feature_rollout where feature = 'member_default_template');
