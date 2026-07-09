-- approval_requests.request_type CHECK 제거 (2026-07-09)
--   원인: request_type 은 앱에서 커스텀 결재양식 이름(selectedForm.name), 'form:<id>',
--         정책 document_type 등 임의 문자열로 생성됨. 고정 CHECK IN(...) 로는 동기화 불가라
--         지출결의서(expense_report)·품의서(approval_doc)·커스텀 양식 제출 시
--         "violates check constraint approval_requests_request_type_check" 로 실패.
--   조치: request_type 은 보안 경계가 아니고(회사격리=RLS) 표시/분류용이라 CHECK 를 제거해
--         오류를 원천 차단. 값 유효성은 앱(TypeScript RequestType union + 양식 빌더)이 관리.
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_request_type_check;
