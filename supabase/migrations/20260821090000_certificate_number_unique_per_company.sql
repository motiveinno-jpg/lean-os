-- 증명서 번호 유니크를 회사 단위로 (2026-08-21 감사)
--   채번은 회사별이다: 자기 회사 이력에서 그 달 마지막 번호를 찾아 +1 한다(RLS 가 자기 회사만 보여줌).
--   그런데 UNIQUE 는 전역(certificate_number)이라, 회사 A 가 CERT-EMP-202609-0001 을 쓰면
--   회사 B 는 그 달 내내 0001 을 다시 계산해 23505 로 **영구 실패**한다. 재시도해도 같은 번호다.
--   지금은 발급 회사가 한 곳뿐이라 아직 안 터졌을 뿐 — 두 번째 회사가 발급하는 달에 터진다.
--   업무 규칙(회사별 채번)에 맞게 (company_id, certificate_number) 로 넓힌다.

ALTER TABLE public.certificate_logs
  DROP CONSTRAINT IF EXISTS certificate_logs_certificate_number_key;

ALTER TABLE public.certificate_logs
  ADD CONSTRAINT certificate_logs_company_number_key UNIQUE (company_id, certificate_number);
