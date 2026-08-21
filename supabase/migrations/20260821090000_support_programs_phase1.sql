-- 지원사업 큐레이션 Phase 1 — 상시 제도 카탈로그 + 회사 카드 + 담기 (2026-08-21 사장님 지시)
--
-- 기획: docs/20260821_PLAN_support_programs.md
--
-- 왜 이 모양인가
--   · 공고 해석(AI)은 **플랫폼 전체에서 공고 1건당 1회**만 한다. 그래서 카탈로그(gov_programs)는
--     회사에 속하지 않는 **공용 테이블**이고, 회사별 판정은 코드가 회사 프로필과 대조해 화면에서 만든다.
--     (회사마다 LLM 이 공고를 읽으면 1,000사 × 3,000건 = 일 300만 회 — 비용이 매출을 넘는다.)
--   · Phase 1 은 source='always'(상시 제도)만 담는다. 공고형(bizinfo·kstartup)은 인증키가 나온 뒤
--     같은 테이블에 source 만 달리해서 들어온다 — 스키마를 다시 안 바꾸려고 처음부터 열어 뒀다.
--   · 판정 결과를 저장하는 gov_program_matches 는 **Phase 1 에 만들지 않는다.** 상시 제도가 10건뿐이라
--     화면을 열 때 계산하는 편이 싸고, 규칙을 고치면 즉시 반영된다. 공고 수천 건이 들어오는
--     Phase 3 에서 캐시 테이블을 붙인다.
--
-- 권한 — 지원사업 화면은 직원 개인정보(생년월일·급여)로 판정하므로 owner·admin 전용이다.
--   읽기까지 owner·admin 으로 좁힌다(직원이 회사 카드를 들여다볼 이유가 없다).
--
-- 되돌리기: 아래 세 테이블을 drop 하면 종전 상태. 다른 테이블은 건드리지 않는다.

-- ══════════════════════════════════════════════════════════════════════
-- 1. gov_programs — 공용 카탈로그 (회사에 속하지 않는다)
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.gov_programs (
  id            uuid primary key default gen_random_uuid(),
  -- always = 공고가 아니라 늘 열려 있는 제도(고용장려금·두루누리·세액공제)
  source        text not null default 'always' check (source in ('always', 'bizinfo', 'kstartup', 'manual')),
  external_id   text,                       -- 기업마당 pblancId 등 원천 키 (source 안에서 유일)
  title         text not null,
  org           text,                       -- 주관·시행 기관
  field         text,                       -- 분야: 금융 · 인력 · 기술 · 수출 · 판로 · 창업 · 경영 · 세제
  support_type  text,                       -- 지원형태: 자금 · 바우처 · 인력지원 · 세액공제 · 보험료지원 · 융자 · 컨설팅
  summary       text,                       -- 한 줄 요약 (목록에 뜬다)
  requirement   text,                       -- 자격 요건 원문 요약 (상세 팝업)
  amount_text   text,                       -- 사람이 읽는 지원 규모 ("1인당 연 최대 720만원")
  amount_max    bigint,                     -- 정렬·합계용 상한 (모르면 null)
  detail_url    text,                       -- 공고·제도 원문 (최종 확인은 항상 여기서)
  apply_start   date,
  apply_end     date,                       -- null = 상시 (마감이 없다)
  -- 자격 스펙 — 코드가 회사 프로필과 대조하는 구조화 값.
  --   { regions:[], industries:[], min_employees, max_employees, max_years, requires:[] }
  eligibility   jsonb not null default '{}'::jsonb,
  -- 상시 제도의 계산 규칙 코드 — src/lib/support-programs.ts 의 RULES 키와 짝이다.
  rule_key      text,
  status        text not null default 'open' check (status in ('open', 'closed')),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists gov_programs_source_ext_uk
  on public.gov_programs (source, external_id) where external_id is not null;
create index if not exists gov_programs_status_idx on public.gov_programs (status, apply_end);
create index if not exists gov_programs_rule_idx   on public.gov_programs (rule_key) where rule_key is not null;

comment on table public.gov_programs is
  '정부 지원사업·상시 제도 공용 카탈로그 (2026-08-21). 회사에 속하지 않는다 — 공고 해석은 공고 1건당 1회.';

alter table public.gov_programs enable row level security;

-- 공용 자료라 회사 구분이 없다. 읽기는 로그인한 사람 누구나(화면 자체가 owner·admin 게이트).
drop policy if exists gov_programs_read on public.gov_programs;
create policy gov_programs_read on public.gov_programs
  for select to authenticated using (true);

-- 쓰기 경로는 앱에 없다. 수집 엣지 함수·마이그레이션(service_role)만 채운다.
drop policy if exists gov_programs_no_write_ins on public.gov_programs;
create policy gov_programs_no_write_ins on public.gov_programs
  as restrictive for insert to authenticated with check (false);
drop policy if exists gov_programs_no_write_upd on public.gov_programs;
create policy gov_programs_no_write_upd on public.gov_programs
  as restrictive for update to authenticated using (false);
drop policy if exists gov_programs_no_write_del on public.gov_programs;
create policy gov_programs_no_write_del on public.gov_programs
  as restrictive for delete to authenticated using (false);

-- ══════════════════════════════════════════════════════════════════════
-- 2. company_profile_ext — 회사 카드 7문항 (우리 DB로 알 수 없는 축만)
-- ══════════════════════════════════════════════════════════════════════
--   업종·소재지·규모·고용 4축은 companies·employees 에 이미 있다. 여기 담는 건 나머지 3축뿐.
create table if not exists public.company_profile_ext (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  open_date      date,           -- ① 개업일 — 창업 3년/7년 이내 판정. 홈택스 연동이 막혀 있어 사람이 넣는다
  size_class     text check (size_class in ('small_biz', 'small', 'medium')), -- ② 소상공인 · 소기업 · 중기업
  certifications text[] not null default '{}',  -- ③ venture · innobiz · mainbiz · lab · woman · disabled · social
  has_export     boolean,        -- ④ 수출 실적 유무 (null = 미입력)
  ksic_main      text,           -- ⑤ 주력 업종 (표준산업분류 대분류 코드)
  prior_grants   jsonb not null default '[]'::jsonb, -- ⑥ 최근 3년 수혜 이력 [{year, name}]
  interests      text[] not null default '{}',  -- ⑦ 관심 분야 — 추천 정렬에만 쓴다
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

comment on table public.company_profile_ext is
  '지원사업 판정용 회사 카드 7문항 (2026-08-21). 미입력이 기본값이고, 미입력 조건은 화면에서 ? 로 보인다.';

alter table public.company_profile_ext enable row level security;

drop policy if exists company_profile_ext_read on public.company_profile_ext;
create policy company_profile_ext_read on public.company_profile_ext
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );

drop policy if exists company_profile_ext_write on public.company_profile_ext;
create policy company_profile_ext_write on public.company_profile_ext
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );

drop policy if exists company_profile_ext_update on public.company_profile_ext;
create policy company_profile_ext_update on public.company_profile_ext
  for update to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  )
  with check (company_id = (select public.get_my_company_id()));

-- ══════════════════════════════════════════════════════════════════════
-- 3. gov_program_saved — 담아둔 것 / 신청 이력
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.gov_program_saved (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  program_id  uuid not null references public.gov_programs(id) on delete cascade,
  -- saved(관심) → preparing(준비 중) → applied(신청함) → selected(선정) | rejected(미선정) | dropped(접음)
  status      text not null default 'saved'
              check (status in ('saved', 'preparing', 'applied', 'selected', 'rejected', 'dropped')),
  memo        text,
  assignee_id uuid,   -- 담당자 (users.id)
  due_date    date,   -- 우리가 챙길 기한 — 공고 마감과 다를 수 있다(내부 준비 마감)
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, program_id)
);

create index if not exists gov_program_saved_company_idx on public.gov_program_saved (company_id, status);

comment on table public.gov_program_saved is
  '회사가 담아둔 지원사업과 그 진행 상태 (2026-08-21). 선정되면 자금 전망의 보조금/지원금과 이어진다.';

alter table public.gov_program_saved enable row level security;

drop policy if exists gov_program_saved_read on public.gov_program_saved;
create policy gov_program_saved_read on public.gov_program_saved
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );

drop policy if exists gov_program_saved_write on public.gov_program_saved;
create policy gov_program_saved_write on public.gov_program_saved
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );

-- ══════════════════════════════════════════════════════════════════════
-- 4. 상시 제도 카탈로그 시드 10건
-- ══════════════════════════════════════════════════════════════════════
--   ⚠️ 금액·요건은 **연도별 지침에 따라 바뀐다.** 화면에서는 전부 '예상'으로 표기하고
--     detail_url(관계 기관 원문)을 함께 띄운다. 우리가 최종 자격을 판정하지 않는다.
--   external_id 를 rule_key 와 같게 둬서 다시 돌려도 덮어쓰기(upsert)만 된다.

insert into public.gov_programs
  (source, external_id, title, org, field, support_type, summary, requirement, amount_text, amount_max, detail_url, rule_key, sort_order)
values
  ('always', 'youth_leap', '청년일자리도약장려금', '고용노동부', '인력', '인력지원',
   '만 34세 이하 청년을 신규 채용하고 6개월 이상 고용을 유지하면 인건비를 지원합니다.',
   '상시근로자 5인 이상 중소기업(성장유망업종·벤처기업·청년창업기업은 5인 미만도 가능) · 고용보험 가입 · 채용 전 3개월 내 인위적 감원 없음 · 최저임금 이상 지급',
   '1인당 연 최대 720만원', 7200000, 'https://www.work24.go.kr', 'youth_leap', 10),

  ('always', 'duruname', '두루누리 사회보험료 지원', '근로복지공단', '인력', '보험료지원',
   '10인 미만 사업장의 저임금 근로자 국민연금·고용보험료를 최대 80% 지원합니다.',
   '전년도 월평균 피보험자 10인 미만 · 월평균보수 270만원 미만 · 신규 가입 근로자 · 최대 36개월',
   '1인 월 최대 약 24만원', 240000, 'http://insurancesupport.or.kr/durunuri/intro.php', 'duruname', 20),

  ('always', 'integrated_tax_credit', '통합고용세액공제', '국세청', '세제', '세액공제',
   '전년보다 늘어난 상시근로자 1인당 법인세·소득세를 공제받습니다.',
   '상시근로자 수 순증 · 청년·장애인·60세 이상 등은 공제 단가가 더 높다 · 공제 후 인원이 줄면 추징',
   '순증 1인당 최대 1,450만원(수도권) · 1,550만원(수도권 밖)', 14500000, 'https://www.nts.go.kr', 'integrated_tax_credit', 30),

  ('always', 'regular_conversion', '정규직 전환 지원', '고용노동부', '인력', '인력지원',
   '기간제·파견·사내하도급 근로자를 정규직으로 전환하면 인건비를 지원합니다.',
   '6개월 이상 근속한 기간제 등을 정규직 전환 · 전환 후 6개월 이상 고용 유지 · 우선지원대상기업',
   '1인당 월 최대 50만원 (1년)', 6000000, 'https://www.work24.go.kr', 'regular_conversion', 40),

  ('always', 'flexible_work', '일·가정 양립 환경개선 지원 (유연근무 장려금)', '고용노동부', '인력', '인력지원',
   '재택·원격·선택근무를 도입해 활용하면 활용 근로자 수만큼 지원합니다.',
   '우선지원대상기업 · 근로자가 월 4일 이상 유연근무 활용 · 근태 기록으로 증빙',
   '재택·원격 월 20만원(연 최대 240만원) · 선택근무 월 30만원(연 최대 360만원)', 3600000, 'https://www.work24.go.kr', 'flexible_work', 50),

  ('always', 'parental_leave', '출산육아기 고용안정장려금', '고용노동부', '인력', '인력지원',
   '육아휴직·육아기 근로시간 단축을 허용한 사업주를 지원합니다.',
   '우선지원대상기업 · 근로자에게 육아휴직 또는 육아기 근로시간 단축을 30일 이상 허용 · 종료 후 고용 유지',
   '1인당 월 지원 (유형별 상이)', null, 'https://www.work24.go.kr', 'parental_leave', 60),

  ('always', 'substitute_worker', '대체인력지원금', '고용노동부', '인력', '인력지원',
   '출산휴가·육아휴직으로 빈 자리를 대체할 인력을 채용하면 지원합니다.',
   '우선지원대상기업 · 휴직 시작 전 2개월부터 대체인력 채용 · 휴직 종료 후 1개월 이상 고용 유지',
   '1인당 월 지원 (유형별 상이)', null, 'https://www.work24.go.kr', 'substitute_worker', 70),

  ('always', 'employment_promotion', '고용촉진장려금', '고용노동부', '인력', '인력지원',
   '취업지원 프로그램을 이수한 구직자를 채용하면 인건비를 지원합니다.',
   '고용노동부 지정 취업지원 프로그램 이수자를 채용 · 6개월 이상 고용 유지 · 채용 전 3개월 내 감원 없음',
   '1인당 연 최대 720만원', 7200000, 'https://www.work24.go.kr', 'employment_promotion', 80),

  ('always', 'young_income_tax', '중소기업 취업자 소득세 감면', '국세청', '세제', '세액공제',
   '청년·60세 이상·장애인 근로자의 소득세를 감면합니다 — 회사가 아니라 직원이 받는 혜택입니다.',
   '중소기업 취업 청년(만 15~34세)은 5년간 소득세 90% 감면 · 회사가 감면 신청서를 원천징수 관할 세무서에 제출',
   '직원 1인당 소득세 감면 (연 200만원 한도)', 2000000, 'https://www.nts.go.kr', 'young_income_tax', 90),

  ('always', 'disability_employment', '장애인 고용장려금', '한국장애인고용공단', '인력', '인력지원',
   '의무고용률을 넘겨 장애인을 고용하면 장려금을 받습니다.',
   '월별 상시근로자의 의무고용률을 초과해 장애인을 고용 · 고용보험 가입 · 최저임금 이상 지급',
   '1인당 월 지원 (장애 정도·성별에 따라 상이)', null, 'https://www.kead.or.kr', 'disability_employment', 100)
on conflict (source, external_id) where external_id is not null
do update set
  title        = excluded.title,
  org          = excluded.org,
  field        = excluded.field,
  support_type = excluded.support_type,
  summary      = excluded.summary,
  requirement  = excluded.requirement,
  amount_text  = excluded.amount_text,
  amount_max   = excluded.amount_max,
  detail_url   = excluded.detail_url,
  rule_key     = excluded.rule_key,
  sort_order   = excluded.sort_order,
  updated_at   = now();
