-- 값 제약 전수 감사 (2026-08-20 사장님 지시: "이런류의 오류들 더 있는지 엄격하게 확인하고 수정해")
--   입사서류 사고(employee_files.category)와 같은 부류 — 화면이 제공하는 선택지를 DB 가 거부하는 곳.
--   프로덕션 106개 값-목록 제약을 코드와 1:1 대조해 나온 것들.

-- ① 휴가 유형 — 화면은 11종 + 회사 커스텀 유형을 주는데 제약은 6종만 허용했다.
--    증거: leave_requests 30건이 **전부 annual**. 나머지 10종은 저장 자체가 안 됐다.
--    결재허브 경로는 approval-workflow 의 catch 안이라 무음이었다 — 결재는 승인되는데
--    휴가 기록이 안 생겨 근태·연차 차감이 통째로 누락됐다.
--    커스텀 유형(custom_<시각>)은 회사가 만드는 값이라 열거할 수 없어 접두사로 허용한다.
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check CHECK (
    leave_type = ANY (ARRAY[
      'annual', 'sick', 'personal', 'maternity', 'paternity', 'compensation',
      'family_care', 'official', 'menstrual', 'compensatory', 'bereavement'
    ])
    OR leave_type LIKE 'custom\_%'   -- 구성원 > 휴가 탭에서 회사가 추가한 유형
  );

-- ② 휴가 상태 — 2단계 결재의 1차 승인이 'first_approved' 를 쓴다(hr.ts:1739). 조회측도
--    같은 값을 읽는데(hr.ts:1769, :1842) 제약에 없어 1차 승인이 400 으로 실패했다.
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_status_check CHECK (
    status = ANY (ARRAY['pending', 'first_approved', 'approved', 'rejected', 'cancelled'])
  );

-- ③ 서명 발송 실패 기록 — 반송·스팸 신고를 적는 유일한 경로(resend-webhook)가 'webhook' 을
--    쓰는데 제약에 없어, 발송 실패 패널에 반송·스팸 건이 영영 안 쌓였다.
ALTER TABLE public.signature_send_failures DROP CONSTRAINT IF EXISTS signature_send_failures_send_type_check;
ALTER TABLE public.signature_send_failures
  ADD CONSTRAINT signature_send_failures_send_type_check CHECK (
    send_type = ANY (ARRAY['initial', 'bulk_initial', 'reminder', 'webhook'])
  );
