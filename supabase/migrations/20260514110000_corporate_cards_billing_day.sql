-- Migration: 법인카드 이용대금 결제일 + 사용내역 마감일
-- Version: 20260514110000

ALTER TABLE public.corporate_cards ADD COLUMN IF NOT EXISTS payment_day integer;
ALTER TABLE public.corporate_cards ADD COLUMN IF NOT EXISTS billing_day integer;

COMMENT ON COLUMN public.corporate_cards.payment_day IS '매월 이용대금 자동출금 일자 (1~31)';
COMMENT ON COLUMN public.corporate_cards.billing_day IS '매월 사용내역 마감 일자 (1~31). 마감일+1 부터 다음 사이클.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corporate_cards_payment_day_check'
  ) THEN
    ALTER TABLE public.corporate_cards
      ADD CONSTRAINT corporate_cards_payment_day_check
      CHECK (payment_day IS NULL OR (payment_day BETWEEN 1 AND 31));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corporate_cards_billing_day_check'
  ) THEN
    ALTER TABLE public.corporate_cards
      ADD CONSTRAINT corporate_cards_billing_day_check
      CHECK (billing_day IS NULL OR (billing_day BETWEEN 1 AND 31));
  END IF;
END $$;
