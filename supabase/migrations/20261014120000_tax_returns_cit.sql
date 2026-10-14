-- 세무 마감 신고본(tax_returns)에 법인세(cit) 추가 — 2026-10-14 세무 2차 (docs/20261012_PLAN_tax_closing_v2.md)
--
-- 왜: 법인세 신고서도 낸 숫자를 신고본으로 남겨 수정신고 비교 기준을 가져야 한다. kind CHECK 에 'cit' 이 없어 마감할 수 없었다.
--
-- 규칙: kind 에 'cit' 추가(제약 이름 tax_returns_kind_check 그대로).
--       period_key 는 사업연도 'YYYY' 만 — 기존 period_key 제약이 종류별 case 라 'cit' 줄을 명시로 넣는다(^\d{4}$).
--       그대로 두면 '그 밖' 규칙(^\d{4}(-영숫자1~8)?$)에 걸려 '2026-1' 같은 모양도 들어가 같은 연도가 두 열쇠로 갈린다.
--       그 밖의 종류 규칙은 20261012110000 그대로.
--
-- 기존 데이터: tax_returns 0건(2026-10-14) — 제약 재생성이 걸릴 줄 없음.
-- 버린 안: 법인세용 표를 따로 — 마감·차수·불변 규칙이 신고본과 같다. 종류 하나 더하는 게 맞다.

alter table public.tax_returns drop constraint if exists tax_returns_kind_check;
alter table public.tax_returns add constraint tax_returns_kind_check check (
  kind in ('vat', 'wht', 'simple_statement', 'annual_statement', 'daily_work_report', 'insurance_report', 'cit')
);

alter table public.tax_returns drop constraint if exists tax_returns_period_key_check;
alter table public.tax_returns add constraint tax_returns_period_key_check check (
  case
    when kind = 'vat' then period_key ~ '^\d{4}-(1p|1c|1h|2p|2c|2h)$'
    when kind in ('wht', 'daily_work_report') then period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'
    when kind = 'cit' then period_key ~ '^\d{4}$'
    else period_key ~ '^\d{4}(-[0-9A-Za-z]{1,8})?$'
  end
);
