-- 스토리지 쿼터 집행 게이트 — 모든 업로드 경로(클라 직접 포함)를 DB 한 곳에서 막는다.
--   설계: docs/20260902_PLAN_storage_pack.md
--   안전: feature_on('storage_quota_enforce', company) 로 게이트 — 기본 OFF(플래그 없으면 무영향).
--         RESTRICTIVE 라 기존 회사격리 정책과 AND 결합(더 느슨해지지 않음).
--         객체가 회사매핑 안 되거나 플래그 OFF면 항상 통과 → 켜기 전엔 현행과 100% 동일.

-- 쿼터만 반환하는 경량 함수(RLS 인라인 평가용)
create or replace function public.company_storage_quota(p_company uuid)
returns bigint language plpgsql stable security definer set search_path=public as $$
declare q bigint;
begin
  select coalesce(p.included_storage_bytes, 524288000)
         + (greatest(0, coalesce(sub.seat_count,1) - coalesce(p.included_seats,0))
            + coalesce(sub.storage_pack_count,0))::bigint
           * coalesce(p.storage_per_unit_bytes, 10737418240)
    into q
  from public.subscriptions sub
  join public.subscription_plans p on p.id = sub.plan_id
  where sub.company_id = p_company
  order by sub.created_at desc limit 1;
  return coalesce(q, 524288000); -- 구독 없으면 기본 500MiB
end $$;

grant execute on function public.company_storage_quota(uuid) to authenticated;

-- 업로드 게이트: 회사 사용량이 이미 쿼터 이상이면 신규 업로드 거부(플래그 켜진 회사만).
--   파일 크기 정밀 검사는 앱 계층 assertStorageQuota 가 맡고, 이 정책은 '이미 초과분'의 방어선.
drop policy if exists storage_quota_gate on storage.objects;
create policy storage_quota_gate on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    public.storage_object_company(bucket_id, name) is null
    or not public.feature_on('storage_quota_enforce', public.storage_object_company(bucket_id, name))
    or coalesce((select u.used_bytes from public.company_storage_usage u
                 where u.company_id = public.storage_object_company(bucket_id, name)), 0)
       < public.company_storage_quota(public.storage_object_company(bucket_id, name))
  );
