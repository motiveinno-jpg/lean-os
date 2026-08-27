-- 통장·카드 수집도 서버 job 으로 (2026-08-27 사장님 "전표 수집 시 백그라운드 수집이 안 됨" 후속) — hometax_sync_jobs 를 재사용, job_type 에 bank·card 추가
--   결정 87 — 통장·카드는 홈택스처럼 job 행을 만들고 엣지가 waitUntil 로 끝까지 돈다(한 회사 통장 ~24s·카드 ~28s, 엣지 150s 안). 탭을 닫아도 서버가 끝낸다.
--   화면(collect-run)은 jobId 만 받아 기다린다 — 새로고침 뒤에도 이어 본다.
alter table public.hometax_sync_jobs drop constraint if exists hometax_sync_jobs_job_type_check;
alter table public.hometax_sync_jobs add constraint hometax_sync_jobs_job_type_check
  check (job_type = any (array['tax_invoice'::text, 'cash_receipt'::text, 'exempt_invoice'::text, 'bank'::text, 'card'::text]));
