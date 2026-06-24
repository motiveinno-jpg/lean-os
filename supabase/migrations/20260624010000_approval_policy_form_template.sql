-- 결재 양식 관리: approval_policies 를 '양식' 레지스트리로 확장.
--   label              : 양식 표시 이름(새 요청 유형 선택에 노출). null 이면 name/기본 라벨 사용.
--   description_template: 양식 선택 시 설명란에 자동 입력되는 템플릿.
-- 둘 다 nullable → 기존 정책/흐름 100% 하위호환. 단계별 특정 인물 승인자는 stages(jsonb)에 보관(스키마 변경 없음).
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS description_template text;
