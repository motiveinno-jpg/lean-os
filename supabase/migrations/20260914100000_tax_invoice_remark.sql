--   세금계산서 '전체 비고' — 계산서 한 장에 붙는 비고 한 줄.
--
--   품목 줄마다 붙는 비고는 items(jsonb)의 remark 로 이미 홈택스에 나가는데
--   (hometax-issue 의 detailList remark), 장 단위 비고를 담을 칸이 없었다.
--   홈택스 전송 규격의 remark1 이 이 값을 받는다 — 지금은 label(영수/청구 토글)이
--   잘못 들어가고 있어 그것도 같이 바로잡는다.

alter table public.tax_invoices
  add column if not exists remark text;

comment on column public.tax_invoices.remark is
  '계산서 한 장에 붙는 비고(홈택스 remark1). 품목 줄별 비고는 items[].remark 에 있다.';
