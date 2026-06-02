-- 보안 정리 — 이번 작업으로 추가한 SECURITY DEFINER 함수의 과대 권한 회수.
-- Supabase 는 public 스키마 함수 생성 시 anon/authenticated 에 EXECUTE 를 자동 부여하므로
-- PUBLIC 뿐 아니라 anon/authenticated 도 명시적으로 회수해야 함.
-- 트리거 함수: 직접 호출 불필요(트리거가 definer 권한으로 실행) → 전 role 회수.
-- RPC: 인증 사용자만 호출 → anon 회수, authenticated 유지.
revoke execute on function public.trg_link_invoice_partner() from public, anon, authenticated;
revoke execute on function public.trg_link_card_tx() from public, anon, authenticated;

revoke execute on function public.link_invoice_partners() from public, anon;
revoke execute on function public.delete_document(uuid) from public, anon;

grant execute on function public.link_invoice_partners() to authenticated;
grant execute on function public.delete_document(uuid) to authenticated;
