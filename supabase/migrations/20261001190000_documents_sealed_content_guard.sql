-- 문서 보안 W2 — 직인이 찍힌 문서는 내용을 고칠 수 없다 (2026-10-01 사장님: "직인 찍은 뒤에는 수정 안 되게").
--   History: documents_content_edit_guard 의 내용 동결은 잠금(locked_at·locked/executed/issued)만 봤다 → 직인 뒤에도 본문·금액을 고칠 수 있었다.
--   규칙: old.seal_applied 이면 잠긴 문서와 같은 기준으로 내용 변경 거부 — 진행 칸(상태·잠금·직인·문서번호·발행·원본 연결·수정 시각·작성자)은 그대로,
--         비어 있던 계약 기간·금액·거래처를 처음 채우는 것('기간 채우기')과 정기 청구 칸·version 은 잠금과 같은 예외.
--   상태 진행(서명 요청·잠금)은 막지 않는다. 고쳐야 하면 개정본. 직인 해제 기능은 없다.
--   같이 바꾼 것: 견적→계약 자동 생성 계약서는 만들 때가 아니라 보낼 때 직인(signatures.ts sealAutoContractOnSend) — 보내기 전엔 고칠 수 있게.
--   기존 함수(documents_content_edit_guard)는 그대로 두고 트리거를 더한다. 기존 데이터 무변경(직인·미잠금 문서 1건, 모티브 초안).
create or replace function public.documents_sealed_content_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_progress text[] := array['status', 'locked_at', 'seal_applied', 'document_number', 'issued_at', 'source_document_id', 'updated_at', 'created_by'];
  v_exempt text[] := array['billing_day', 'billing_amount', 'contract_start_date', 'contract_end_date', 'contract_amount', 'partner_id', 'version'];
  v_new jsonb; v_old jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not coalesce(old.seal_applied, false) then return new; end if;
  v_new := to_jsonb(new) - v_progress;
  v_old := to_jsonb(old) - v_progress;
  if v_new is not distinct from v_old then return new; end if;
  if ((v_new - v_exempt) || jsonb_build_object('content_json', new.content_json - array['contractStart', 'contractEnd']))
       is distinct from
     ((v_old - v_exempt) || jsonb_build_object('content_json', old.content_json - array['contractStart', 'contractEnd']))
     or (new.contract_start_date is distinct from old.contract_start_date and old.contract_start_date is not null)
     or (new.contract_end_date   is distinct from old.contract_end_date   and old.contract_end_date   is not null)
     or (new.contract_amount     is distinct from old.contract_amount     and old.contract_amount     is not null)
     or (new.partner_id          is distinct from old.partner_id          and old.partner_id          is not null)
     or ((new.content_json -> 'contractStart') is distinct from (old.content_json -> 'contractStart') and coalesce(old.content_json ->> 'contractStart', '') <> '')
     or ((new.content_json -> 'contractEnd') is distinct from (old.content_json -> 'contractEnd') and coalesce(old.content_json ->> 'contractEnd', '') <> '') then
    raise exception '직인이 찍힌 문서는 내용을 고칠 수 없습니다. 고쳐야 하면 새 문서(개정본)를 만드세요.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_documents_sealed_content_guard on public.documents;
create trigger trg_documents_sealed_content_guard before update on public.documents
  for each row execute function public.documents_sealed_content_guard();
