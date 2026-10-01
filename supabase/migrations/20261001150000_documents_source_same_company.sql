-- 문서 보안 ② — 원본 문서 연결(source_document_id)은 같은 회사 문서만 (2026-10-01, 9/30 미룬 항목).
--   History: 20260701 견적→계약 자동 생성용으로 source_document_id(FK, on delete set null)를 만들었는데 회사 확인이 없었다.
--   documents_content_edit_guard 도 이 칸을 '진행 칸'으로 허용해, 같은 회사 사용자가 다른 회사 문서 id 를 넣어
--   그 문서를 원본으로 끌어올 수 있었다(화면이 원본을 따라 읽는 곳이 생기면 회사 경계가 새는 구멍).
--   현황(적용 전): 연결 4건 · 다른 회사 0 · 끊긴 연결 0 → 기존 데이터 무변경, 넣거나 바꿀 때만 검사.
--   누가 쓰든(사용자·서버·자동 계약 생성) 같은 규칙 — 회사 경계는 역할과 무관하다.
create or replace function public.documents_source_same_company()
returns trigger language plpgsql security definer set search_path = public as $$   -- 원본 문서가 호출자 RLS 에 안 보여도 회사만 비교
begin
  if new.source_document_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.source_document_id is not distinct from old.source_document_id
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;
  if not exists (select 1 from public.documents s where s.id = new.source_document_id and s.company_id = new.company_id) then
    raise exception '같은 회사 문서만 원본으로 연결할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_documents_source_same_company on public.documents;
create trigger trg_documents_source_same_company
  before insert or update on public.documents
  for each row execute function public.documents_source_same_company();
