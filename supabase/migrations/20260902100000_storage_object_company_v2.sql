-- 회사 저장공간 집계·게이트의 경로→회사 매핑 보강 (스토리지 팩 후속, 2026-09-02)
--   종전: documents 버킷만 2번째 세그먼트, 나머지는 1번째 세그먼트 — 버킷 이름에 규칙을 묶어 두면
--         같은 버킷 안의 다른 경로 규칙(예: documents 의 `{companyId}/certificates/…` 재직증명서 PDF)이
--         조용히 집계·차단에서 빠진다. chat-files(`{channelId}/…`)는 채널 ID 를 회사로 오인해
--         유령 회사 카운터를 만들 수 있었다(실측 0건, 구조적 결함만 선제 수정).
--   개선: ① 1번째 세그먼트가 UUID 면 그것 ② 아니면 2번째 세그먼트가 UUID 면 그것
--         ③ chat-files 는 채널 → chat_channels.company_id 로 해석 ④ 그 외 null(집계·게이트 제외).
--   주의: chat_channels 조회 때문에 IMMUTABLE → STABLE. RLS·트리거 모두 STABLE 함수 허용.
--         카운터 백필을 다시 돌려 기존 값과 정합(현재 프로덕션 실측으론 매핑 결과 변화 0건).

create or replace function public.storage_object_company(p_bucket text, p_name text)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare
  seg1 text := (storage.foldername(p_name))[1];
  seg2 text := (storage.foldername(p_name))[2];
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  cid uuid;
begin
  if p_bucket = 'chat-files' then
    -- 경로 = {channelId}/… (버킷 RLS 가 이 구조에 묶여 있어 경로는 못 바꾼다) → 채널의 회사로.
    if seg1 is null or seg1 !~* uuid_re then return null; end if;
    select c.company_id into cid from public.chat_channels c where c.id = seg1::uuid;
    return cid;
  end if;
  if seg1 is not null and seg1 ~* uuid_re then return seg1::uuid; end if;
  if seg2 is not null and seg2 ~* uuid_re then return seg2::uuid; end if;
  return null;
exception when others then
  return null;
end $$;

grant execute on function public.storage_object_company(text, text) to authenticated;

-- 백필 재실행 — 새 매핑 기준으로 카운터를 다시 맞춘다(유령 회사 행 제거 포함).
truncate table public.company_storage_usage;
insert into public.company_storage_usage(company_id, used_bytes, object_count)
select cid, sum(sz), count(*)
from (
  select public.storage_object_company(bucket_id, name) as cid,
         coalesce((metadata->>'size')::bigint, 0) as sz
  from storage.objects
) t
where cid is not null
group by cid;
