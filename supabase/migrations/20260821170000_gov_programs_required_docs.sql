-- 지원사업 — 신청에 필요한 서류 (2026-08-21 사장님 지시:
--   "사업신청시 필요한 서류가 어떤 것인지, 회사에 등록된 서류가 있다면 자동으로 끌고오게")
--
-- 왜 컬럼으로 두나
--   서류 **목록**은 사업마다 다르다(제도별로 요구하는 게 다르다) → gov_programs 에 붙인다.
--   서류 **사전**(이름·발급처·발급 URL·유효기간)은 회사마다 다르지 않다 → 코드(lib/support-docs.ts)에 둔다.
--   DB 에 사전을 넣으면 링크 하나 고치는 데 마이그레이션이 필요해진다.
--
-- 값은 lib/support-docs.ts 의 DOC_CATALOG 키다(biz_license · tax_clear_national · …).
-- 비어 있으면 화면이 rule_key 별 기본 세트를 쓴다 — 수집형 공고는 공고문을 읽기 전까지 알 수 없어서다.

alter table public.gov_programs
  add column if not exists required_docs text[] not null default '{}';

comment on column public.gov_programs.required_docs is
  '신청에 필요한 서류 키 목록 (2026-08-21). lib/support-docs.ts 의 DOC_CATALOG 키. 비면 rule_key 기본 세트를 쓴다.';

-- ── 상시 제도 10건의 서류 (아는 것만 적는다 — 모르면 비워 두고 기본 세트가 받는다) ──
--   공통 바탕: 사업자등록증 · 국세/지방세 완납증명 · 중소기업확인서
--   고용장려금 계열은 4대보험 가입자명부와 고용보험 가입증명이 실제 심사 자료다.
update public.gov_programs set required_docs = t.docs
from (values
  ('youth_leap',            array['biz_license','sme_cert','insurance_roster','employment_cert','labor_contract','payroll']),
  ('duruname',              array['biz_license','insurance_roster','payroll']),
  ('integrated_tax_credit', array['biz_license','fin_statement','insurance_roster','payroll']),
  ('regular_conversion',    array['biz_license','insurance_roster','employment_cert','labor_contract','payroll']),
  ('flexible_work',         array['biz_license','insurance_roster','labor_contract','attendance_record']),
  ('parental_leave',        array['biz_license','insurance_roster','employment_cert','labor_contract']),
  ('substitute_worker',     array['biz_license','insurance_roster','employment_cert','labor_contract']),
  ('employment_promotion',  array['biz_license','insurance_roster','employment_cert','labor_contract','payroll']),
  ('young_income_tax',      array['biz_license','insurance_roster','labor_contract']),
  ('disability_employment', array['biz_license','insurance_roster','employment_cert'])
) as t(rule, docs)
where public.gov_programs.rule_key = t.rule
  and public.gov_programs.source = 'always';
