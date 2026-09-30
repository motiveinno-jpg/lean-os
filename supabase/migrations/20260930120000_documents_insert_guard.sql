-- 새 문서(INSERT)를 처음부터 잠긴·직인·번호 달린 상태로 못 만들게 (2026-09-30, 사장님 승인 "추천 작업진행").
--
-- 왜: 20260930100000 의 documents_content_edit_guard 는 BEFORE UPDATE 라 '바꾸기'만 막는다.
--   INSERT 정책("Company members can insert documents", 20260929130000)은 company_id 만 본다.
--   그래서 같은 회사 구성원이 PostgREST 로 새 행을 넣으며
--   · seal_applied=true — 직인 PDF 렌더는 seal_applied 만 보므로 apply_document_seal 의
--     권한·잠금·월 한도·signature_requests 기록을 전부 건너뛴 직인 문서가 생긴다.
--   · status='executed'/'locked', locked_at/issued_at(과거 시각 포함) — 서명·발행된 적 없는 '잠긴 문서'.
--   · document_number='DOC-…' — 기존 번호 중복, 또는 DOC-YYYYMM-9999 로 issue_document 채번(max+1)을 밀어냄.
--   · created_by=남의 id — '본인 문서' 권한(수정·삭제)을 남에게 떠넘기거나 남인 척 문서를 만든다.
--   를 처음부터 넣을 수 있었다(security-reviewer W1, backlog 「INSERT created_by 사칭」).
--
-- 무엇: BEFORE INSERT 트리거 trg_documents_insert_guard → documents_insert_guard().
--   사용자 세션(current_user in authenticated/anon)에서만 본다 — UPDATE 가드와 같은 판정.
--   SECURITY DEFINER 함수(소유자 postgres 로 돈다 — 예: trg_auto_contract_on_approve)·service_role
--   (엣지 complete-signing)·크론·마이그레이션은 통과.
--   1) seal_applied = true → 거절. 직인은 만든 뒤 「직인 적용하기」(apply_document_seal)로만.
--   2) locked_at 또는 issued_at 이 있으면 → 거절.
--   3) status 는 null·'draft'·'review' 만. 예외: status='issued' + content_type='contract_pdf'
--      (deal-pipeline 계약 승인 시 자동 보관본 — locked_at·issued_at·번호·직인 없이 들어온다).
--   4) document_number 는 null 또는 견적 형식(nextQuoteNumber: ^\d{4}/\d{2}/\d{2}-\d+$)만.
--      DOC-… 는 「문서번호 발급」(issue_document)으로만.
--   5) created_by — null 이면 그대로(서식 공용 사본·일부 HR 경로). 값이 있고 current_app_user_id() 와
--      다르면 거절하지 않고 본인 id 로 바꾼다(본인 id 가 null 이면 null).
--   기존 데이터: 손대지 않는다(INSERT 에만 걸린다).
--
-- 판정 근거(2026-09-30 운영 확인):
--   · public 함수 중 documents 에 INSERT 하는 것은 trg_auto_contract_on_approve 하나 — SECURITY DEFINER,
--     소유자 postgres 라 current_user 가 postgres → 통과. 넣는 값도 draft·번호 없음이라 규칙에 안 걸린다.
--   · 현재 저장된 document_number 는 전부 'YYYY/MM/DD-N' 형식(invoice 18, quote 4).
--   · 최근 90일 문서 56건 중 created_by null 12, users.id 에 없는 created_by 0 (전체 기간도 0).
--     auth uid ≠ users.id 인 사용자 2명 — 그 사람들 문서 22건은 전부 users.id 로 저장돼 있고,
--     auth uid 로 저장된 문서는 0건. 앱은 users.id 를 쓴다 → current_app_user_id() 로 맞추는 게 일치.
--   · 최근 90일 locked 10건은 전부 만든 뒤 48~219초 후 UPDATE 로 잠겼다(INSERT 때 잠긴 것 아님).
--
-- 버린 안:
--   ① 전부 조용히 보정(seal=false, status=draft, 번호 null…) — 위조 시도가 눈에 안 띄고,
--      status 보정은 호출한 쪽이 기대한 동작을 바꾼다. 앱 정상 경로는 걸리지 않으므로 거절이 맞다.
--   ② contract_pdf 보관본도 draft 로 넣게 앱을 바꾸기 — 자동 보관본이 편집 가능한 문서가 된다.
--   ③ created_by 불일치 거절 — 앱이 auth uid 와 users.id 를 섞는 경로가 남아 있으면 기능이 깨진다.
--      같은 사람이면 보정 결과가 같으므로 보정이 안전하다.
--   ④ RLS with check 로 막기 — 거절 사유를 사람 말로 못 돌려주고, created_by 보정은 정책으로 불가.

begin;

create or replace function public.documents_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 1) 직인
  if coalesce(new.seal_applied, false) then
    raise exception '직인은 문서를 만든 뒤 「직인 적용하기」로만 찍을 수 있습니다.';
  end if;

  -- 2) 잠금·발행 시각
  if new.locked_at is not null or new.issued_at is not null then
    raise exception '새 문서는 잠긴 상태로 만들 수 없습니다.';
  end if;

  -- 3) 상태 — 초안·검토만, 자동 계약 보관본(issued + contract_pdf)만 예외
  if new.status is not null
     and new.status not in ('draft', 'review')
     and not (new.status = 'issued' and new.content_type is not distinct from 'contract_pdf') then
    raise exception '새 문서는 초안으로만 만들 수 있습니다.';
  end if;

  -- 4) 문서번호 — 견적 번호 형식만
  if new.document_number is not null
     and new.document_number !~ '^\d{4}/\d{2}/\d{2}-\d+$' then
    raise exception '문서번호는 「문서번호 발급」으로만 받을 수 있습니다.';
  end if;

  -- 5) 만든 사람 — 남의 id 는 본인 id 로
  if new.created_by is not null then
    v_me := public.current_app_user_id();
    if new.created_by is distinct from v_me then
      new.created_by := v_me;
    end if;
  end if;

  return new;
end;
$$;

-- 트리거 함수 — 직접 호출할 일이 없다. 발동 시에는 EXECUTE 를 보지 않는다.
revoke execute on function public.documents_insert_guard() from public, anon, authenticated;

drop trigger if exists trg_documents_insert_guard on public.documents;
create trigger trg_documents_insert_guard
  before insert on public.documents
  for each row execute function public.documents_insert_guard();

commit;
