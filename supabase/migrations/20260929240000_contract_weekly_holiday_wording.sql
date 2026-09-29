-- 근로계약서 기본 문구의 휴일 표기 바로잡기
--   주휴일은 1주에 1일(근로기준법 제55조)이다. 기본 서식이 "토·일요일 주휴일", "주휴일은 토, 일요일"로
--   두 날을 모두 주휴일(유급)로 적어, 그대로 서명하면 토요일까지 유급휴일로 약정한 계약서가 된다.
--   → 주휴일은 일요일(유급), 토요일은 무급휴무일로 적는다.
--   기본 문구를 그대로 쓰는 서식만 바꾼다(회사가 고친 문장은 글자가 달라 걸리지 않는다).

update public.doc_templates
   set content_json = replace(
         replace(content_json::text,
           '주 5일 근무 (토·일요일 주휴일)',
           '주 5일(월~금요일) 근무 · 주휴일: 일요일(유급) · 토요일: 무급휴무일'),
         '1. 주휴일: 1주 개근 시 1일 유급 부여',
         '1. 주휴일(일요일): 1주 소정근로일을 개근하면 유급으로 부여 (근로기준법 제55조)'
       )::jsonb
 where content_json::text like '%주 5일 근무 (토·일요일 주휴일)%'
    or content_json::text like '%1. 주휴일: 1주 개근 시 1일 유급 부여%';

update public.doc_templates
   set content_json = replace(content_json::text,
         '주휴일은 토, 일요일로 한다.',
         '주휴일은 일요일(유급)로 하고 토요일은 무급휴무일로 한다.')::jsonb
 where content_json::text like '%주휴일은 토, 일요일로 한다.%';
