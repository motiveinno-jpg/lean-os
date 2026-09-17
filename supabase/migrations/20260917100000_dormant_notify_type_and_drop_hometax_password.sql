-- 알림 타입 정리 + 죽은 평문 비밀번호 컬럼 제거 (2026-09-17)
--   백로그 전수 실측에서 남은 '진짜 할 일' 두 건.

-- ============================================================
-- 1) 휴면 감지 알림이 제 이름을 갖게 한다
--   automation.ts 가 휴면 프로젝트·휴면 거래처 알림을 보낼 때 type 을 'system' 으로 넣고 있었다.
--   notifications_type_check 에 맞는 값이 없어서 우회한 것인데, 그 대가로
--   알림 화면에서 종류가 전부 '시스템' 으로 뭉쳐 무슨 알림인지 구분되지 않는다.
--   ⚠️ 값을 늘리면 읽는 화면도 같이 고쳐야 한다 — notifications/page.tsx 의 TYPE_LABEL 에
--      '휴면 프로젝트'·'휴면 거래처' 를 함께 넣었다(없으면 '기타' 로 뜬다).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'deal_update', 'expense_request', 'contract_expiry', 'signature_request', 'payment_due',
    'system', 'document', 'approval', 'chat', 'overtime_auto_clockout', 'project_checkin_due',
    'overtime_request', 'overtime_approved', 'overtime_rejected', 'company_join_request',
    'approval_request', 'approval_approved', 'approval_rejected', 'approval_reference',
    'billing', 'board_post', 'contract_renewal', 'hr_contract_package', 'leave_request', 'inventory',
    -- 2026-09-17 추가
    'dormant_deal', 'dormant_partner'
  ]::text[])
);

-- ============================================================
-- 2) company_settings.hometax_password 삭제
--   평문 비밀번호를 담으려고 만든 칸인데, 읽거나 쓰는 코드가 한 곳도 없고 값도 0행이다.
--   (2026-09-17 실측: 전체 5행 중 값 있는 행 0. 저장소 전수 검색 결과 참조는 마이그레이션·주석뿐.)
--   비어 있는 지금이 지우기 가장 쉬운 때다 — 값이 들어가기 시작하면 이관 절차가 필요해진다.
--
--   ⚠️ codef_client_secret 은 **지우지 않는다.** 값은 0행이지만
--      supabase/functions/codef-sync·hometax-issue 가 "회사별 키가 있으면 그걸, 없으면 환경변수" 로 읽는다.
--      죽은 칸이 아니라 설계된 회사별 자격증명 자리이므로, 삭제가 아니라 **암호화**가 맞는 방향이다(별건).
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS hometax_password;
