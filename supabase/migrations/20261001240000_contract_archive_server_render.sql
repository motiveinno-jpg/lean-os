-- 계약 보관본은 서버가 렌더링한다 (2026-10-01, 같은 날 20261001230000 후속).
--   20261001230000 의 archive_contract_pdf(원본, 이름, HTML) 는 HTML 을 브라우저에서 받았다 → 이제 /api/documents/archive-contract 가
--   원본 계약서·회사 정보를 DB 에서 읽어 서버에서 렌더링(contract-html.ts)하고 서비스 키로 저장한다. 그래서 RPC 는 없앤다(호출 0).
--   원본당 1건은 고유 색인으로 DB 가 보장한다(동시 호출 대비). 실측: 보관본 0건이라 색인 생성에 걸리는 데이터 없음.
drop function if exists public.archive_contract_pdf(uuid, text, text);
create unique index if not exists documents_contract_pdf_source_uniq
  on public.documents ((content_json ->> 'sourceDocumentId'))
  where content_type = 'contract_pdf';
