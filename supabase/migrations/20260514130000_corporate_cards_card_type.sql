-- Migration: 법인카드 종류 (신용/체크/직불) 컬럼 추가
-- Version: 20260514130000
-- 이용대금 청구서는 신용카드만 표시 (체크/직불은 즉시 출금 → 청구 사이클 개념 없음)

ALTER TABLE public.corporate_cards ADD COLUMN IF NOT EXISTS card_type text DEFAULT 'credit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corporate_cards_card_type_check'
  ) THEN
    ALTER TABLE public.corporate_cards
      ADD CONSTRAINT corporate_cards_card_type_check
      CHECK (card_type IN ('credit', 'check', 'debit', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.corporate_cards.card_type IS '신용(credit)/체크(check)/직불(debit)/기타(other). 이용대금 청구는 신용카드만.';
