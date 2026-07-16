-- Migration: add_fields_to_approval_policies
--
-- 결재관리 > 양식 관리에서 기본 제공 요청 유형(경비청구/휴가신청 등, approval_policies)도
-- 커스텀 결재 양식(approval_forms)처럼 입력 필드를 정의할 수 있게 fields 컬럼을 추가한다.
-- 순수 additive: 기존 행은 전부 빈 배열('[]')로 채워지며 기존 동작(승인선/자동승인 등)에는 영향 없음.

ALTER TABLE public.approval_policies
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.approval_policies.fields IS
  '기본 제공 요청 유형의 커스텀 입력 필드 정의(approval_forms.fields 와 동일 구조: key/label/type/required/options 등). 빈 배열이면 기존처럼 설명+금액만 사용.';
