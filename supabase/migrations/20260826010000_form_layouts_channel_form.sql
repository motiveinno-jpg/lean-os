-- 채널 주문 가져오기도 격자 양식(form_layouts)을 쓴다 (2026-08-26 사장님 지시)
--   판매·구매·생산과 같은 입력기(doc-editor)로 바꾸면서 양식 열쇠 'channel' 이 필요해졌다.
alter table public.form_layouts drop constraint if exists form_layouts_form_key_check;
alter table public.form_layouts add constraint form_layouts_form_key_check
  check (form_key = any (array['order'::text, 'sale'::text, 'buy'::text, 'make'::text, 'channel'::text]));
