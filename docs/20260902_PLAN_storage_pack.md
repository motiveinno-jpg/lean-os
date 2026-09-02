# 스토리지 팩 애드온 — 기획 + 결제/DB 설계

> 작성 2026-09-02 · 사장님 지시: "회사당 기본 500MB, 추가 인원 1명당 +10GB, **사람 안 늘려도 용량만 구매 가능하게 하되 가격은 좌석 추가와 동일**"
> 형식: `docs/PLANNING_METHOD.md` 준수 (History → 자문자답 → 결정 → 누락점검 → 파급 → 커밋)

---

## 0. 한 줄 요약

저장공간을 **좌석에서 분리**해 독립 구매 가능한 "**스토리지 팩(+10GB)**"을 만든다.
- 좌석 추가(₩5,000/월) = 로그인 1 + 10GB
- **스토리지 팩(₩5,000/월) = 10GB만 (로그인 없음)** ← 신설
- 결제 금액·저장 쿼터 두 공식이 **`(추가좌석 + 스토리지팩)`** 한 항을 똑같이 더하는 구조로 통일한다.

---

## 1. History — 지금 왜 이 모양인가

- **좌석 요금 공식**은 한 곳에 있다: `src/lib/billing.ts:122 computeMonthlyCharge()`
  = `base_price + per_seat_price × max(0, seat_count − included_seats)` (VAT 10% 별도).
  단, 빌링 UI(`src/app/(app)/billing/page.tsx:626`)가 이 함수를 안 부르고 **같은 계산을 인라인으로 중복**한다 → 애드온 추가 시 두 곳을 같이 고쳐야 함(또는 중앙화).
- **정기결제 실엔진은 Toss 크론**: pg_cron `toss-charge-daily`(매일 02:10 KST) → 엣지 `supabase/functions/toss-charge/index.ts`.
  이 크론은 매 주기 **`seat_count`를 무시하고 `employees` 실인원으로 금액을 재계산**(`index.ts:342-412`)하고 프로레이션(중도 입·퇴사 일할)까지 처리한 뒤 `seat_count = actualSeats`로 덮어쓴다.
  → **즉 `seat_count`는 캐시값**이고, 실제 청구 근거는 직원 수다.
- **Stripe는 비대칭**: 체크아웃 때 추가좌석을 line item 수량으로 고정(`api/stripe/checkout/route.ts:132`)하고 이후 **좌석 변동을 subscription item 수량에 반영하는 코드가 없다**. Stripe 가입자는 스스로 갱신.
- **저장공간 개념은 DB에 없음**: `subscription_plans`에 storage 컬럼 없음. `src/lib/billing.ts`의 `PLAN_LIMITS.maxStorageMb`는 **하드코딩 상수 + 어디서도 미검사**. 실제 쿼터/사용량/업로드 게이트 전무.
- **연동 선례**: `billing_seat_coupons`(무료 좌석 grant, RLS select-only + `redeem_seat_coupon` security-definer RPC) = 이번 애드온이 베낄 권한 패턴. `codef_usage_metering` = 사용량 계측 선례.
- **현재 실사용량**: 오너뷰 전 회사·전 버킷 합계 **≈185MB / 100GB**. 어떤 단일 회사도 500MB를 넘지 않는다(교차합산 버킷 최대가 company-assets 69MB) → **쿼터 도입해도 기존 회사 아무도 안 막힘**.

---

## 2. 자문자답

**Q1. 무엇을 기준으로 "쿼터"를 판정하나?**
→ 회사 단위. 쿼터 = `기본용량 + (추가좌석 + 스토리지팩) × 단위용량`. 좌석과 팩은 **용량 부여가 동일(각 +10GB)**, 차이는 로그인 유무뿐. 그래서 한 항으로 합산.

**Q2. 사용자는 왜 팩을 사는가?**
→ 인원은 그대로인데(로그인 계정 더 필요 없음) 파일이 많아 용량만 부족한 회사. 지금 결제는 좌석 추가로만 열려 있어 "유령 계정"을 만들어야 하는 불합리 → 팩으로 해소.

**Q3. 반대 경우(예외)는?**
→ ① **무료 플랜**: `per_seat_price=0, max_seats=5`. 좌석 확장·팩 판매 대상 아님 → 무료는 500MB 고정. ② **결제사 두 곳(Toss·Stripe) 모두 지원**(아래 결정3): 우리 Stripe 구독은 이미 추가좌석 ₩5,000 Price(`STRIPE_PRICE_STANDARD_EXTRA_SEAT_*`)를 line item으로 갖고 있어, 동일 단가 스토리지 팩 line item을 추가/수량변경하면 되고 **Stripe가 프로레이션을 자동 처리**한다(Toss보다 오히려 단순). 없던 건 "결제 후 구독 수량 변경" 코드뿐 → 이번에 신설. ③ **엔터프라이즈**(`per_seat_price=0`): 좌석 무료 번들이라 팩 단가 정책 별도 필요 → 이번 범위 밖(플랜 파라미터로 후속 설정).

**Q4. 자동으로 못 푸는 경우는?(→사람에게 맡기고 화면에 적는다)**
→ 팩 구매/해지는 **회사 owner의 명시적 결제 행위**. 자동 증설 없음(깜짝 청구 방지). 용량 초과 시 시스템은 **업로드를 막고 "팩 구매" CTA만 띄운다** — 결정은 사람이.

**Q5. 경계값?**
→ 팩 수 0(기본)·음수 금지(CHECK). 사용량 = 쿼터 정확히 같을 때는 통과, 초과 시 차단. 파일당 크기 상한(500MB, Supabase 전역)은 **별개 개념**이라 그대로 유지.

---

## 3. 결정

각 결정 = **규칙 / AS_IS ▶ TO_BE / 적용시점 / 기존데이터**.

### 결정 1 — 쿼터·요금을 데이터 주도로, 두 공식이 같은 항을 더한다
- **규칙**:
  - 저장 쿼터(bytes) = `plan.included_storage_bytes + (extra_seats + storage_pack_count) × plan.storage_per_unit_bytes`
  - 월 청구액 = `base_price + (extra_seats + storage_pack_count) × per_seat_price` (+VAT)
  - `extra_seats = max(0, seat_count − included_seats)`. **팩 단가는 per_seat_price를 재사용**(새 가격 컬럼 없음 = "동일 가격").
- **AS_IS ▶ TO_BE**: 요금 = base + extra_seats×price ▶ base + (extra_seats **+ packs**)×price. 쿼터 = (개념 없음) ▶ 위 공식.
- **적용시점**: 마이그레이션 적용 즉시(팩 0이면 기존과 100% 동일 금액).
- **기존데이터**: `storage_pack_count default 0` → 모든 기존 구독 금액 불변.

### 결정 2 — 스키마 (아래 §4 DDL)
- `subscription_plans`에 `included_storage_bytes`(기본 500MiB), `storage_per_unit_bytes`(기본 10GiB) 추가 → 하드코딩 금지 규칙 준수, 플랜별 조정 가능.
- `subscriptions`에 `storage_pack_count int default 0 check(>=0)` 추가. **좌석과 독립**(Toss 크론이 seat_count는 덮어쓰지만 pack_count는 건드리지 않음).
- `company_storage_usage`(회사별 사용량 카운터) 신설 + `storage.objects` 트리거로 유지 + 야간 정합성.

### 결정 3 — 결제 반영은 **Toss·Stripe 둘 다**, 계산은 중앙화
- **규칙**: `computeMonthlyCharge(plan, seatCount, storagePacks=0)`로 시그니처 확장하고 **UI 인라인 계산을 이 함수 호출로 교체**(중복 제거). 구매/해지는 `subscription.payment_provider`로 분기:
  - **Toss**: 크론 금액식(`toss-charge/index.ts:406-412`)에 `+ storage_pack_count`. 구매 시 남은 주기 일할분을 billing key로 즉시 단건 청구(좌석 프로레이션 로직 재사용).
  - **Stripe**: `stripe.subscriptions.update()`로 **스토리지 팩 Price(₩5,000, 좌석과 동일 단가) subscription item의 quantity = storage_pack_count** 설정(없으면 item 추가). `proration_behavior:'always_invoice'`로 **Stripe가 일할 청구·정기갱신을 자동 처리** → 우리 크론 불필요. 필요한 것은 새 Stripe Price 1개(`STRIPE_PRICE_STORAGE_PACK_MONTHLY`/`_ANNUAL`, 추가좌석과 같은 금액) + env 등록.
    - ⚠️ 부수 효과(좋은): 이 "구독 수량 변경" 경로가 생기면 **Stripe 가입자의 좌석 변동도 사후 반영 가능**(지금은 체크아웃 시 고정)해지는 기존 갭도 후속으로 메울 수 있음.
- **팩 프로레이션**: 구매 즉시 남은 주기 일할 청구, 해지는 **다음 주기부터**(환불 없음, 통상 SaaS 다운그레이드). Toss=수동 일할, Stripe=자동.
- **적용시점**: 다음 청구 주기부터 정기 반영, 구매 시 일할분 즉시 청구.
- **기존데이터**: 없음(신규 컬럼·신규 Stripe Price).

### 결정 4 — 쿼터 집행(enforcement)은 앱 게이트 + RLS 방어, 2단계 롤아웃
- **규칙**:
  - 1차(정밀): 공용 업로드 헬퍼에 `assertStorageQuota(company, incomingBytes)` 선검사 — 초과면 업로드 거부 + "팩 구매" 안내.
  - 2차(방어): `storage.objects` INSERT RLS에 카운터 기반 게이트(이미 쿼터 이상이면 새 업로드 거부) — 클라 직접 업로드 우회 방지.
  - **롤아웃**: `feature_rollout` 게이트로 **모티브(c361afb9…)에 먼저** → 문제없음 확인 후 전체. 최초엔 **warn-only(차단 안 함, 로그만)**로 켰다가 hard-block 전환.
- **AS_IS ▶ TO_BE**: 업로드 무제한 ▶ 쿼터 초과 시 신규 업로드 차단(기존 파일·조회·다운로드는 영향 없음).
- **적용시점**: warn-only 배포 → 수일 관측 → 차단 on.
- **기존데이터**: 현재 어떤 회사도 500MB 미만이라 **차단 발생 0건 예상**(§1). 백필로 카운터 초기화.

### 결정 5 — UI
- 빌링 페이지에 **"저장공간" 카드**: 사용량/쿼터 게이지, 현재 팩 수, `+10GB 추가 (₩5,000/월)` / `-` 버튼 → `/api/billing/storage-pack`.
- 업로드 차단 시 토스트 "저장공간이 가득 찼습니다 — 스토리지 팩 추가" + `/billing` 링크.
- **⚠️ UI 구조(query-kit·globals·shell) 변경 아님**(카드 1개 추가) — 다만 실제 구현은 CLAUDE.md의 "UI 구조 변경은 연준호 PC" 규칙에 저촉되지 않는 기능 추가로 처리.

---

## 4. DB 설계 (마이그레이션 초안)

> 파일: `supabase/migrations/20260902xxxxxx_storage_pack_addon.sql`
> 적용은 반드시 `node scripts/apply-supabase-migration.mjs`(원장 기록 → CI DB gate 통과).

```sql
-- 1) 플랜 파라미터 (데이터 주도, 하드코딩 금지)
alter table public.subscription_plans
  add column if not exists included_storage_bytes bigint not null default 524288000,   -- 500 MiB
  add column if not exists storage_per_unit_bytes  bigint not null default 10737418240; -- 10 GiB (좌석1=팩1 공통)

-- 2) 구독에 스토리지 팩 수량 (좌석과 분리)
alter table public.subscriptions
  add column if not exists storage_pack_count int not null default 0;
alter table public.subscriptions
  add constraint subscriptions_storage_pack_count_nonneg check (storage_pack_count >= 0) not valid;
alter table public.subscriptions validate constraint subscriptions_storage_pack_count_nonneg;

-- 3) 회사별 사용량 카운터 (빠른 조회 · 트리거 유지)
create table if not exists public.company_storage_usage (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  used_bytes  bigint not null default 0,
  object_count int   not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.company_storage_usage enable row level security;
-- 조회는 자기 회사만, 쓰기는 트리거/서비스롤만(정책 없음 = 일반 사용자 write 불가)
create policy company_storage_usage_select on public.company_storage_usage
  for select using (company_id = public.get_my_company_id());

-- 4) storage.objects 경로 → company_id 매핑
--    ⚠️ 버킷별 경로 규칙 상이(ops 메모): documents 만 2번째 구간, 나머지 1번째.
--    비격리/공용 버킷(company-assets 등)은 쿼터 제외 — 배포 전 각 버킷 실데이터로 검증할 것.
create or replace function public.storage_object_company(p_bucket text, p_name text)
returns uuid language sql immutable as $$
  select case
    when p_bucket = 'documents' then nullif((storage.foldername(p_name))[2], '')::uuid
    when p_bucket in ('company-assets','chat-files','form-templates') then null  -- 쿼터 제외(검증 필요)
    else nullif((storage.foldername(p_name))[1], '')::uuid
  end
$$;

-- 5) 카운터 유지 트리거
create or replace function public.trg_company_storage_usage()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; ocid uuid; sz bigint; osz bigint;
begin
  if tg_op in ('INSERT','UPDATE') then
    cid := public.storage_object_company(new.bucket_id, new.name);
    sz  := coalesce((new.metadata->>'size')::bigint, 0);
  end if;
  if tg_op in ('UPDATE','DELETE') then
    ocid := public.storage_object_company(old.bucket_id, old.name);
    osz  := coalesce((old.metadata->>'size')::bigint, 0);
  end if;

  if tg_op = 'DELETE' or (tg_op='UPDATE' and ocid is not null) then
    if ocid is not null then
      update public.company_storage_usage
        set used_bytes = greatest(0, used_bytes - osz),
            object_count = greatest(0, object_count - 1), updated_at = now()
      where company_id = ocid;
    end if;
  end if;
  if tg_op = 'INSERT' or (tg_op='UPDATE' and cid is not null) then
    if cid is not null then
      insert into public.company_storage_usage(company_id, used_bytes, object_count)
      values (cid, sz, 1)
      on conflict (company_id) do update
        set used_bytes = company_storage_usage.used_bytes + sz,
            object_count = company_storage_usage.object_count + 1, updated_at = now();
    end if;
  end if;
  return null;
end $$;

drop trigger if exists company_storage_usage_sync on storage.objects;
create trigger company_storage_usage_sync
  after insert or update or delete on storage.objects
  for each row execute function public.trg_company_storage_usage();

-- 6) 백필 (기존 파일 → 카운터 초기화)
insert into public.company_storage_usage(company_id, used_bytes, object_count)
select c, sum(sz), count(*) from (
  select public.storage_object_company(bucket_id, name) as c,
         coalesce((metadata->>'size')::bigint,0) as sz
  from storage.objects
) t where c is not null
group by c
on conflict (company_id) do update
  set used_bytes = excluded.used_bytes, object_count = excluded.object_count, updated_at = now();

-- 7) 조회 RPC
create or replace function public.get_company_storage(p_company uuid default public.get_my_company_id())
returns table(used_bytes bigint, quota_bytes bigint, included_bytes bigint,
              per_unit_bytes bigint, extra_seats int, storage_packs int)
language sql stable security definer set search_path=public as $$
  with s as (
    select sub.seat_count, sub.storage_pack_count, p.included_seats,
           p.included_storage_bytes, p.storage_per_unit_bytes
    from public.subscriptions sub
    join public.subscription_plans p on p.id = sub.plan_id
    where sub.company_id = p_company
    order by sub.created_at desc limit 1
  )
  select
    coalesce((select used_bytes from public.company_storage_usage where company_id=p_company),0),
    s.included_storage_bytes
      + (greatest(0, s.seat_count - coalesce(s.included_seats,0)) + s.storage_pack_count) * s.storage_per_unit_bytes,
    s.included_storage_bytes, s.storage_per_unit_bytes,
    greatest(0, s.seat_count - coalesce(s.included_seats,0)), s.storage_pack_count
  from s;
$$;

-- 8) 팩 수량 변경 RPC (owner/master 만) — 실제 owner 확인 헬퍼명은 코드에서 확인 후 사용
create or replace function public.set_storage_packs(p_company uuid, p_count int)
returns int language plpgsql security definer set search_path=public as $$
begin
  if p_count < 0 then raise exception 'invalid pack count'; end if;
  -- TODO: 회사 owner/master 권한 확인 (has_perm / is_company_owner 실제 헬퍼로 교체)
  update public.subscriptions
     set storage_pack_count = p_count, updated_at = now()
   where company_id = p_company;
  return p_count; -- 결제 프로레이션은 앱 API(/api/billing/storage-pack)에서 수행
end $$;
```

**쿼터 집행 RLS(2차 방어, storage.objects INSERT)** — 이미 쿼터 이상이면 신규 업로드 거부:
```sql
-- feature_rollout('storage_quota_enforce', company) 켜진 회사에만 적용
create policy storage_quota_gate on storage.objects
  for insert to authenticated
  with check (
    public.storage_object_company(bucket_id, name) is null
    or not public.feature_on('storage_quota_enforce', public.storage_object_company(bucket_id, name))
    or coalesce((select used_bytes from public.company_storage_usage
                 where company_id = public.storage_object_company(bucket_id, name)), 0)
       < (select quota_bytes from public.get_company_storage(public.storage_object_company(bucket_id, name)))
  );
```
> ⚠️ 기존 버킷 INSERT 정책과 **AND 결합**되도록 추가(회사 격리 정책은 그대로 두고 이 게이트만 덧댐). 정책 추가 전 각 버킷 현행 INSERT 정책 확인.

---

## 5. 결제/코드 설계

### 5-1. 요금 계산 중앙화 — `src/lib/billing.ts:122`
```ts
export function computeMonthlyCharge(
  plan: Pick<PlanInfo,'basePrice'|'perSeatPrice'|'includedSeats'>,
  seatCount: number,
  storagePacks = 0,                          // ← 추가
): number {
  const extraSeats = Math.max(0, (seatCount || 1) - (plan.includedSeats || 0));
  return Math.round(plan.basePrice + (extraSeats + storagePacks) * plan.perSeatPrice);
}
```
그리고 **`billing/page.tsx:626` 인라인 계산을 이 함수 호출로 교체**(중복 제거, 두 곳 불일치 방지).

### 5-2. Toss 크론 — `supabase/functions/toss-charge/index.ts`
- 구독 select에 `storage_pack_count` 포함(`:314-316` 인근 plan select와 subs select).
- 금액식(`:406-412`):
  ```ts
  const billableUnits = billableNow + (s.storage_pack_count || 0);   // 좌석+팩
  const supplyMonthly  = base_price + billableUnits * per_seat_price;
  ```
- 프로레이션 블록(`:359-403`): 팩 수량 변경분도 좌석과 동일 일할 로직에 태움(구매 시각 기준). 최소 구현은 "팩은 다음 주기부터"로 두고, 즉시 프로레이션은 구매 API에서 별도 청구(아래).

### 5-3. 구매 API — `src/app/api/billing/storage-pack/route.ts` (신설)
- `POST { count }`(목표 수량) → owner 확인 → **현재 사용량 > 목표 쿼터면 감소 거부** → `set_storage_packs`로 수량 갱신 → `payment_provider`로 결제 반영 분기.
- **Toss**: 증가 시 남은 주기 일할액(`per_seat_price × 남은일/총일`)을 billing key로 즉시 단건 청구(`toss-charge` 단건 경로 재사용) → `invoices` 기록. 정기분은 크론이 반영.
- **Stripe**: `stripe.subscriptions.retrieve(sub.stripe_subscription_id)` → 스토리지 팩 Price item 탐색 →
  - 있으면 `stripe.subscriptions.update(subId, { items:[{ id, quantity: count }], proration_behavior:'always_invoice' })`
  - 없으면 `items:[{ price: STRIPE_PRICE_STORAGE_PACK_[MONTHLY|ANNUAL], quantity: count }]`로 추가
  → **Stripe가 일할청구·정기갱신 자동 처리**. 결과는 웹훅(`invoice.paid`)이 `invoices`에 기록.
- **감소(양쪽 공통)**: 수량 감소 → 다음 주기부터 반영(환불 없음). 현재 사용량 > 감소 후 쿼터면 거부 — "사용량을 먼저 줄이세요" 안내.
- **정합성**: 결제 호출 실패 시 `storage_pack_count` 롤백(수량-결제 불일치 방지). Stripe는 멱등키, Toss는 orderId 멱등키.
- **env 선행(Stripe)**: Stripe 대시보드에서 ₩5,000 "스토리지 팩" Price(월/연) 생성 → `STRIPE_PRICE_STORAGE_PACK_MONTHLY`·`_ANNUAL` Vercel env 등록. 미등록이면 Stripe 구매를 400으로 막아 잘못 결제 방지(체크아웃 base env와 동일 관례).

### 5-4. 업로드 게이트 — 공용 헬퍼
- 서버 업로드 경로(대부분 `storage upload → DB insert` 패턴)에 `assertStorageQuota(companyId, incomingBytes)`:
  ```ts
  const { used_bytes, quota_bytes } = await getCompanyStorage(companyId);
  if (used_bytes + incomingBytes > quota_bytes) throw new QuotaExceededError();
  ```
  실패 시 클라에 413/커스텀 코드 → 토스트 + `/billing` CTA.
- 클라 직접 업로드 버킷은 §4의 RLS 게이트가 방어.

---

## 6. 누락 점검 (PLANNING_METHOD ④)

| 항목 | 처리 |
|---|---|
| 권한·RLS | `company_storage_usage` select=자기회사, write=트리거/서비스롤. `set_storage_packs`=owner/master. 팩 구매 API owner 검증. |
| 역할 | 팩 구매·해지는 owner만(결제 주체). 일반 구성원은 사용량 조회만. |
| 빈 상태 | 사용량 0 → 게이지 0%. 구독 없음(무료) → 쿼터=500MB 고정, 팩 UI 숨김. |
| 경계값(음수/0/단수) | 팩 CHECK ≥0. 팩0=기존과 동일. 사용량==쿼터 통과, 초과 차단. |
| 중복실행 | Toss 프로레이션은 orderId 멱등키 재사용(중복청구 방지). 트리거는 insert/delete 대칭. |
| 마감 | 정기결제 주기 경계에서 팩 반영(Toss 크론). |
| 기존데이터 | default 0 → 금액 불변. 백필로 카운터 초기화. 현 최대사용 회사<500MB → 차단 0. |
| 파급화면 | §7. |
| 외부전송 | Toss billing API 단건 청구(구매 시). Supabase 스토리지 요금(원가)은 GB당 $0.0213 — 팩 매출이 원가의 수백 배(₩5,000 vs ₩290). |
| 인쇄/엑셀 | 해당없음. |
| 모바일폭 | 저장공간 카드 반응형(게이지+버튼) 필요. |
| 되돌리기 | 팩 감소=다음 주기 반영, 사용량>쿼터면 거부. 마이그레이션 롤백 = 컬럼/트리거 drop(데이터 무손실). |

---

## 7. 파급 확인 (이 값을 읽는/쓰는 화면·코드)

- **요금 계산**: `src/lib/billing.ts:122`(computeMonthlyCharge), `billing/page.tsx:626`(인라인→함수화), `toss-charge/index.ts:406`, 플랫폼 매출/회사 상세 페이지(있으면 팩 매출 합산 확인).
- **구독 조회**: `getCurrentSubscription()` `billing.ts:196` → 반환 타입에 `storagePackCount` 추가.
- **결제 경로**: `/api/billing/storage-pack`(신규) → Toss(크론 정기 + 구매 시 단건 일할) / Stripe(subscription item 수량 변경, 자동 프로레이션·갱신). 웹훅·크론 각각 `invoices` 기록.
- **업로드 경로 전수**: 각 버킷 업로드 헬퍼에 게이트 삽입 지점 목록화(receipts, documents, employee-files, deal-files, project-files, board-files, task-attachments, support-attachments, document-files, certificates). company-assets/chat-files/form-templates 쿼터 포함 여부 확정 필요.
- **사용량 표시**: 빌링 페이지 저장공간 카드 + (선택) 대시보드 위젯.

---

## 8. 단계별 실행 순서(권장)

1. **마이그레이션**(§4) 적용 — 컬럼·카운터·트리거·백필·RPC. 팩0이라 금액 불변, 집행 off.
2. **요금 계산 중앙화**(§5-1) — 함수 시그니처 확장 + UI 중복 제거(팩0이면 값 동일, 회귀 없음).
3. **Toss 크론**(§5-2)에 팩 합산 — 정기결제 반영.
4. **빌링 UI 저장공간 카드 + 구매 API (Toss·Stripe 양쪽)**(§5-3) — 여기서부터 실제 판매 가능. Stripe는 팩 Price 생성 + env 등록 선행.
5. **업로드 게이트 warn-only**(§5-4) → 모티브 feature_rollout → 관측 → hard-block + RLS 게이트 on.
6. (선택 후속) Stripe 좌석 변동 사후 반영 — §5-3의 구독 수량 변경 경로를 그대로 재사용해 기존 갭 해소.

---

## 9. 커밋 메시지 골격 (PLANNING_METHOD ⑥)

```
feat(billing): 스토리지 팩 애드온 — 좌석과 분리된 +10GB, 동일 단가(₩5,000/월)

왜 이 모양이었나: 저장공간이 좌석에만 묶여 용량만 필요한 회사가 유령 계정을 만들어야 했다.
                 저장 쿼터 개념은 DB에 아예 없었고(maxStorageMb 하드코딩·미검사).
무엇을 바꿨나: subscription_plans에 용량 파라미터, subscriptions.storage_pack_count,
             company_storage_usage 카운터+트리거+백필, get_company_storage/set_storage_packs RPC.
             요금·쿼터를 (extra_seats+storage_packs) 한 항으로 통일, computeMonthlyCharge 중앙화.
             Toss 크론 금액식에 팩 합산 + Stripe subscription item 수량 변경(양쪽 지원). 업로드 게이트 + RLS 방어(feature_rollout).
버린 안과 이유: ①종량제 자동청구 → 깜짝청구·해지리스크. ②유령 좌석 재사용 → 혼란.
             ③팩 전용 새 가격 신설 → per_seat_price 재사용으로 "동일 단가" 충족(단, Stripe는 인보이스 명확화 위해 같은 금액의 팩 Price 1개만 추가).
검증: 팩0에서 금액 100% 불변 확인. 백필 후 카운터=실사용 대조. 현 최대 회사<500MB(차단 0).
```
