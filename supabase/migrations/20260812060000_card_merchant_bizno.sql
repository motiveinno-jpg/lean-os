-- 카드 가맹점 사업자번호 — raw_data 안이 아니라 제 칸에 둔다 (2026-08-12)
--
--   History: 2026-08-12 '구분(법인·일반·간이·면세)' 화면(5cf05c9d)을 만들 때
--     번호를 `raw_data->>'merchantBusinessNo'` 에서 읽게 했다. 그런데 그 키를 쓰는 것은
--     2026-05-04 하루치 611건뿐인 **옛 채널**이고, 지금 도는 두 채널은 이름이 다르다.
--       · 청구내역(billing) 1,681건 → raw_data->'charge'->>'resMemberStoreCorpNo'  (BC 746건 채워짐)
--       · 승인내역(approval) 479건 → raw_data->'approval'->>'resMemberStoreCorpNo' (전부 빈칸)
--     그래서 화면은 있는 번호(746건)조차 못 읽고 전부 '—' 였다.
--
--   왜 칸을 새로 만드나: 채널마다 키 위치가 다르고(charge/approval/옛 top) 앞으로 또 늘어난다.
--     화면·집계가 채널을 알 필요가 없게 **정규화한 숫자 10자리**를 한 칸에 모은다.
--
--   기존 데이터: 아래 백필이 세 위치를 모두 훑어 한 번에 채운다.
--   적용 시점: 즉시. 이후 codef-sync 가 저장할 때마다 같이 채운다.

alter table public.card_transactions
  add column if not exists merchant_bizno text;

comment on column public.card_transactions.merchant_bizno is
  '가맹점 사업자번호(숫자 10자리, 하이픈 없음). CODEF 카드 응답 resMemberStoreCorpNo 를 정규화해 저장. merchant_tax_types(과세유형 구분) 조회의 열쇠.';

--   숫자 10자리가 아니면 아예 안 넣는다 — 가맹점번호(9955xxxxxx 등 카드사 자체 번호)가 섞이면
--   국세청 조회가 통째로 헛돈다.
alter table public.card_transactions
  drop constraint if exists card_transactions_merchant_bizno_format;
alter table public.card_transactions
  add constraint card_transactions_merchant_bizno_format
  check (merchant_bizno is null or merchant_bizno ~ '^[0-9]{10}$');

--   과세유형 채우기가 "이 회사에서 아직 구분 모르는 번호"를 훑는 용도
create index if not exists idx_card_tx_merchant_bizno
  on public.card_transactions (company_id, merchant_bizno)
  where merchant_bizno is not null;

--   백필 — 세 채널의 원자료에서 끌어온다
update public.card_transactions t
set merchant_bizno = d.bz
from (
  select id,
         regexp_replace(coalesce(
           nullif(raw_data->'charge'->>'resMemberStoreCorpNo', ''),
           nullif(raw_data->'approval'->>'resMemberStoreCorpNo', ''),
           nullif(raw_data->>'merchantBusinessNo', ''),
           ''), '[^0-9]', '', 'g') as bz
  from public.card_transactions
) d
where t.id = d.id
  and t.merchant_bizno is null
  and length(d.bz) = 10;
