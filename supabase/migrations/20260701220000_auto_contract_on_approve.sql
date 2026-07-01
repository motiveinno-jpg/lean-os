-- 견적 승인 시 계약서 자동 생성 (2026-07-01, projecthub 수익형 흐름 Phase 3)
--   quote_approvals 가 estimate 단계에서 approved 로 전환되는 순간, 회사 토글이 켜져 있으면
--   계약 documents(content_type='contract') 를 자동 생성. payload(발송 스냅샷)에서 거래처·품목 이월.
--   submit_quote_decision(12-param, 고객 승인 경로)은 건드리지 않고 격리된 AFTER UPDATE 트리거로 처리(안전).
--   토글: company_settings.settings->>'auto_contract_on_approve' = 'true'. 중복 방지 가드 포함.

create or replace function public.trg_auto_contract_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_src uuid;
begin
  if new.status = 'approved'
     and (old.status is distinct from 'approved')
     and new.stage in ('estimate', '견적') then

    select coalesce((cs.settings->>'auto_contract_on_approve')::boolean, false)
      into v_enabled
      from company_settings cs
      where cs.company_id = new.company_id;

    if coalesce(v_enabled, false) then
      -- 이 승인으로 이미 만든 계약이 있으면 재생성 안 함
      if not exists (
        select 1 from documents d
        where d.deal_id = new.deal_id
          and d.content_type = 'contract'
          and d.content_json->>'_auto_from_approval' = new.id::text
      ) then
        -- 원본 견적 문서 링크(있으면)
        select d.id into v_src
          from documents d
          where d.deal_id = new.deal_id and d.content_type in ('invoice', 'quote')
          order by d.created_at desc
          limit 1;

        insert into documents (
          company_id, deal_id, sub_deal_id, name, status, content_type, content_json, source_document_id, version, created_by
        ) values (
          new.company_id, new.deal_id, new.sub_deal_id,
          '계약서 (견적 승인 자동생성)', 'draft', 'contract',
          jsonb_build_object(
            'title', '계약서',
            'header', coalesce(new.payload->'header', '{}'::jsonb),
            'items', coalesce(new.payload->'items', '[]'::jsonb),
            'sections', jsonb_build_array(
              jsonb_build_object('title', '계약 내용', 'content', '견적 승인에 근거해 자동 생성된 계약서 초안입니다. 세부 조항을 편집기에서 작성하세요.')
            ),
            '_auto_from_approval', new.id::text
          ),
          v_src, 1, new.created_by
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists auto_contract_on_approve on public.quote_approvals;
create trigger auto_contract_on_approve
  after update on public.quote_approvals
  for each row execute function public.trg_auto_contract_on_approve();
