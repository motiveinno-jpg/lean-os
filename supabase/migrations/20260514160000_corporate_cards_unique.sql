-- Migration: 법인카드 중복 등록 방지 (company_id, card_name) UNIQUE
-- Version: 20260514160000

DO $$
BEGIN
  -- 기존 중복 카드 정리 (가장 오래된 row만 남기고 삭제)
  WITH dups AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, card_name ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.corporate_cards
  )
  DELETE FROM public.corporate_cards WHERE id IN (SELECT id FROM dups WHERE rn > 1);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corporate_cards_company_card_name_unique'
  ) THEN
    ALTER TABLE public.corporate_cards
      ADD CONSTRAINT corporate_cards_company_card_name_unique
      UNIQUE (company_id, card_name);
  END IF;
END $$;
