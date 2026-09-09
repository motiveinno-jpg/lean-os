-- 보안 점검(2026-09-09) S11: 서명 토큰만으로 발송을 반복 요청하지 못하게.
--   send-contract-email 이 패키지별 마지막 발송 시각을 보고 10분 안 재요청과 완료·취소된 패키지 발송을 거부한다.
alter table public.hr_contract_packages add column if not exists last_mail_sent_at timestamptz;
