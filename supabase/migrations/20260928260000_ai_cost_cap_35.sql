-- AI 비용 안전 상한 회사당 월 $10·$12 → $35 (2026-09-28)
--   질문 1회 실측 평균 $0.20 · 상위10% $0.25(최근 45일 48건). '오너뷰 월 100회'를 다 쓰면 ~$25 + 매일 브리핑 ~$1.7.
--   종전 상한(엣지 기본 $12, 운영자 화면 표기 $10)이면 유료 고객이 약 58번째 질문에서 '이번 달 AI 사용 한도'로 막혀
--   요금제 표의 100회를 못 채웠다. 상한은 남용 방지용 안전망 — 약속한 횟수 안에서는 걸리지 않게 둔다.
--   엣지 쪽 값은 _shared/claude.ts MONTHLY_COST_CAP_USD(환경변수 AI_MONTHLY_COST_CAP_USD, 기본 35).
CREATE OR REPLACE FUNCTION public.platform_ai_costs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'month', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'),
    'total_usd', coalesce((select round(sum(cost_usd_estimate)::numeric, 4) from ai_usage_log where created_at >= month_start), 0),
    'total_calls', coalesce((select count(*) from ai_usage_log where created_at >= month_start), 0),
    'companies', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.usd desc)
      from (
        select c.name as company, l.company_id,
               round(sum(l.cost_usd_estimate)::numeric, 4) as usd,
               count(*) as calls,
               sum(l.input_tokens + l.output_tokens) as tokens,
               jsonb_object_agg(l.feature, f.usd_by_feature) as by_feature
        from ai_usage_log l
        left join companies c on c.id = l.company_id
        join lateral (
          select round(sum(l2.cost_usd_estimate)::numeric, 4) as usd_by_feature
          from ai_usage_log l2
          where l2.company_id = l.company_id and l2.feature = l.feature and l2.created_at >= month_start
        ) f on true
        where l.created_at >= month_start
        group by c.name, l.company_id
      ) x
    ), '[]'::jsonb),
    'cap_usd', 35
  ) into result;

  return result;
end;
$function$;
