-- 스토리지 쿼터 집행을 전체 회사로 켠다 — 단, 모티브(테스트 테넌트)는 제외.
--   설계: docs/20260902_PLAN_storage_pack.md (사장님 2026-09-02: "모티브 제외 앞으로 전부 자기 용량에 맞게 차단")
--   방식: feature_rollout 전역 행(company_id null) → 모든 회사 각자 업로드에 집행 적용.
--         모티브는 게이트 정책에서 명시적으로 제외(테스트 자유 보장). 신규 회사도 전역 행이라 자동 적용.
--   안전: 적용 시점 기준 사용량 > 쿼터인 회사 0곳(모티브 외) — 즉시 막히는 회사 없음.

-- 1) 전역 집행 플래그
insert into public.feature_rollout(feature, company_id, note)
values ('storage_quota_enforce', null, '전체 집행(모티브 제외는 게이트 정책에서) — 2026-09-02 사장님')
on conflict do nothing;

-- 2) 게이트 정책 재정의 — 모티브 제외 조건 추가
drop policy if exists storage_quota_gate on storage.objects;
create policy storage_quota_gate on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    public.storage_object_company(bucket_id, name) is null
    or public.storage_object_company(bucket_id, name) = 'c361afb9-8a52-4cac-add9-8992f0f7c09c'  -- 모티브(테스트) 제외
    or not public.feature_on('storage_quota_enforce', public.storage_object_company(bucket_id, name))
    or coalesce((select u.used_bytes from public.company_storage_usage u
                 where u.company_id = public.storage_object_company(bucket_id, name)), 0)
       < public.company_storage_quota(public.storage_object_company(bucket_id, name))
  );
