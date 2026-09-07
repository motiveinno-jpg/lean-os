-- session_gate: 중복 로그인은 "가장 최근 로그인이 이긴다".
--   직전 판은 활성 세션 행이 내 것과 다르면 무조건 막았는데, 새 기기에서 로그인해도 화면(클라이언트 가드)이 행을 갱신하기 전에
--   미들웨어가 먼저 막아 아무 기기에서도 못 들어가는 잠금이 생긴다. 내 세션이 행보다 새로우면 행을 내 것으로 바꾸고 통과시킨다.
SET statement_timeout = '60000';

create or replace function public.session_gate(p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
        v_row record; v_active record; v_mine_created timestamptz; v_conf jsonb; v_ips text[]; v_master boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  select u.company_id, u.is_master into v_row from users u where u.auth_id = v_uid limit 1;
  v_master := coalesce(v_row.is_master, false);

  if v_sid <> '' then
    select s.session_id, s.updated_at into v_active from active_sessions s where s.auth_id = v_uid limit 1;
    if v_active.session_id is not null and v_active.session_id <> v_sid then
      begin
        select created_at into v_mine_created from auth.sessions where id = v_sid::uuid;
      exception when others then v_mine_created := null;
      end;
      if v_mine_created is not null and v_mine_created > coalesce(v_active.updated_at, 'epoch'::timestamptz) then
        -- 내가 더 최근 로그인 — 활성 세션을 내 것으로(이전 기기는 다음 화면 이동에서 밀려난다)
        update active_sessions set session_id = v_sid, updated_at = now() where auth_id = v_uid;
      else
        return jsonb_build_object('ok', false, 'reason', 'duplicate');
      end if;
    end if;
  end if;

  if v_row.company_id is not null and not v_master then
    select cs.settings -> 'ip_restriction' into v_conf from company_settings cs where cs.company_id = v_row.company_id limit 1;
    if v_conf is not null and coalesce((v_conf ->> 'enabled')::boolean, false) then
      select coalesce(array_agg(trim(x)), '{}') into v_ips from jsonb_array_elements_text(coalesce(v_conf -> 'ips', '[]'::jsonb)) x;
      if array_length(v_ips, 1) > 0 and not (coalesce(p_ip, '') = any(v_ips)) then
        return jsonb_build_object('ok', false, 'reason', 'ip');
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.session_gate(text) from public, anon;
grant execute on function public.session_gate(text) to authenticated, service_role;
