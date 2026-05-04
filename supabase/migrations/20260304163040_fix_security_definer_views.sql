-- Migration: fix_security_definer_views
-- Version: 20260304163040
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Fix security definer views
ALTER VIEW public.card_deduction_summary SET (security_invoker = on);
ALTER VIEW public.tax_invoice_monthly_summary SET (security_invoker = on);

-- Fix function search path
ALTER FUNCTION public.mark_dormant_deals() SET search_path = public;
