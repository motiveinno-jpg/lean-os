-- 결재 요청 유형 값 정규화 — 기본 유형의 한글 이름으로 저장된 행을 유형 키로 맞춘다.
--   요청 유형(request_type)은 기본 유형이면 키('expense_report'), 사용자 양식이면 양식 이름으로 저장된다.
--   기본 유형과 같은 이름('지출결의서')의 양식·직접 넣은 행이 섞이면 같은 유형이 두 값으로 갈려
--   결재 검색조건에 칩이 두 번 뜨고 한쪽만 걸러졌다. 새로 갈리는 원인(같은 이름 양식 저장)은 앱이 막는다
--   (saveApprovalForm). 여기서는 이미 갈린 행만 되돌린다.
--   request_type 에는 CHECK 가 없다(20260709153000 에서 제거) — 어휘 게이트 변경 없음.
--   휴가·초과근무는 양식 행이면 건드리지 않는다: 그 둘은 request_type 값으로 연차·근태 처리가 갈려
--   양식 행을 키로 바꾸면 승인 처리 경로가 달라진다.

update public.approval_requests r
   set request_type = m.key
  from (values
    ('expense', '경비 청구'),
    ('payment', '결제 요청'),
    ('leave', '휴가 신청'),
    ('overtime', '초과근무'),
    ('purchase', '구매 요청'),
    ('contract', '계약 체결'),
    ('travel', '출장 신청'),
    ('card_expense', '법인카드 사용'),
    ('equipment', '장비 요청'),
    ('approval_doc', '품의서'),
    ('expense_report', '지출결의서'),
    ('certificate', '증명서 발급'),
    ('custom', '기타')
  ) as m(key, label)
 where r.request_type = m.label
   and (r.form_id is null or m.key not in ('leave', 'overtime'));
