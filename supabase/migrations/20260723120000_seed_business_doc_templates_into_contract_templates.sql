-- 전자계약 양식 통합 Phase 1
-- business 표준 doc_templates(섹션형) 10종을 contract_templates 시스템 양식
-- (is_system=true, company_id=NULL, 전 회사 공유)으로 시드한다.
-- 원본 doc_templates는 절대 건드리지 않는다(Phase 4 롤백 대비).
-- content_json → body_html 변환은 실체화가 쓰는 docTemplateToHtml과 동일 규칙.
-- 멱등: 같은 이름의 is_system contract_template이 이미 있으면 skip.

-- HTML 이스케이프 (순서 중요: & 먼저)
create or replace function pg_temp.ctpl_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(
    coalesce(t, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;')
$$;

-- content_json { title, sections:[{title, content}] } → body_html
create or replace function pg_temp.ctpl_doc_to_html(cj jsonb, fallback_name text)
returns text language plpgsql immutable as $$
declare
  html  text := '';
  title text;
  sec   jsonb;
  line  text;
begin
  title := nullif(coalesce(cj->>'title', ''), '');
  if title is null then
    title := fallback_name;
  end if;

  -- 1) 제목
  html := '<p style="text-align: center;"><strong><span style="font-size: 18pt;">'
          || pg_temp.ctpl_esc(title)
          || '</span></strong></p><p>&nbsp;</p>';

  -- 2) 섹션
  for sec in
    select value from jsonb_array_elements(coalesce(cj->'sections', '[]'::jsonb))
  loop
    if nullif(coalesce(sec->>'title', ''), '') is not null then
      html := html || '<p><strong>' || pg_temp.ctpl_esc(sec->>'title') || '</strong></p>';
    end if;

    -- content를 개행(\n)으로 분리 (JS split('\n')과 동일: 빈 문자열도 1개 요소)
    foreach line in array regexp_split_to_array(coalesce(sec->>'content', ''), E'\n')
    loop
      if btrim(line) <> '' then
        html := html || '<p>' || pg_temp.ctpl_esc(line) || '</p>';
      else
        html := html || '<p>&nbsp;</p>';
      end if;
    end loop;

    html := html || '<p>&nbsp;</p>';
  end loop;

  return html;
end;
$$;

-- 시드 삽입 (이름별 대표 1개, sort_order 100부터 10씩, 멱등)
with src as (
  select distinct on (name) name, content_json, variables
  from doc_templates
  where coalesce(type, '') in ('quote', 'contract', 'nda', 'agreement')
  order by name, id
),
numbered as (
  select name, content_json, variables,
         row_number() over (order by name) as rn
  from src
)
insert into contract_templates
  (company_id, name, code, body_html, body_markdown, variables,
   is_system, is_active, sort_order, file_url, file_type, created_by)
select
  null,
  n.name,
  null,
  pg_temp.ctpl_doc_to_html(n.content_json, n.name),
  null,
  coalesce(n.variables, '[]'::jsonb),
  true,
  true,
  100 + (n.rn - 1) * 10,
  null,
  'html',
  null
from numbered n
where not exists (
  select 1 from contract_templates ct
  where ct.is_system and ct.name = n.name
);
