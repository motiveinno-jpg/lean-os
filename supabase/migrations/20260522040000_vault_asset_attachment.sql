-- 자산/구독 재설계 PR2b — 자산 증빙 문서 첨부 (제거한 문서 탭 기능 흡수).
-- vault_assets 에 첨부 URL 1개. 기존 데이터 보존, RLS 무변경.

ALTER TABLE public.vault_assets
  ADD COLUMN IF NOT EXISTS attachment_url text;

COMMENT ON COLUMN public.vault_assets.attachment_url IS '자산 증빙 문서(영수증·계약서 등) 파일 URL. 단건.';

NOTIFY pgrst, 'reload schema';
