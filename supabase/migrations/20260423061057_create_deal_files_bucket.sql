-- Migration: create_deal_files_bucket
-- Version: 20260423061057
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- deal-files 스토리지 버킷 생성 (파일 첨부 기능용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('deal-files', 'deal-files', true, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

-- 인증된 유저가 자기 회사 딜 파일을 업로드할 수 있도록 RLS
CREATE POLICY "deal_files_upload" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'deal-files');

CREATE POLICY "deal_files_read" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'deal-files');

CREATE POLICY "deal_files_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'deal-files');