-- 중복 로그인 게이트 — "가장 나중에 로그인한 세션이 이긴다" 를 서버가 지킨다 (2026-09-07).
--
-- 왜: 2026-08-11 설계는 새 기기가 로그인하면 active_sessions 를 덮어쓰고 옛 기기가 밀려나는 것이다.
--     덮어쓰기를 화면(SingleSessionGuard)이 하는데, 오늘 들어간 서버 게이트(20260907120000)는 화면이
--     뜨기도 전에 "등록된 세션과 다르면 중복" 으로 새 세션을 돌려보냈다. 그래서 두 번째 기기는 옛 기기가
--     로그아웃하기 전엔 영영 못 들어왔다(사장님 PC 두 대가 바로 걸린다).
-- 규칙: 등록된 세션과 내 세션이 다르면 auth.sessions.created_at 을 비교해 내가 더 새로 로그인한 쪽이면
--       내가 등록(옛 기기는 Realtime·다음 게이트에서 밀려남), 내가 더 옛 세션이면 중복. 등록된 세션이
--       auth.sessions 에 없으면(로그아웃·만료) 그냥 내가 등록한다.
create or replace function public.session_gate(p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
        v_active text; v_row record; v_conf jsonb; v_ips text[]; v_master boolean := false;
        v_mine timestamptz; v_theirs timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  select u.company_id, u.is_master into v_row from users u where u.auth_id = v_uid limit 1;
  v_master := coalesce(v_row.is_master, false);

  -- 중복 로그인 — 나중에 로그인한 세션이 이긴다
  if v_sid <> '' then
    select s.session_id into v_active from active_sessions s where s.auth_id = v_uid limit 1;
    if v_active is null or v_active <> v_sid then
      select created_at into v_mine from auth.sessions where id::text = v_sid;
      if v_active is not null then select created_at into v_theirs from auth.sessions where id::text = v_active; end if;
      if v_active is not null and v_theirs is not null and v_mine is not null and v_mine < v_theirs then
        return jsonb_build_object('ok', false, 'reason', 'duplicate');
      end if;
      insert into active_sessions (auth_id, session_id, device_label, updated_at)
      values (v_uid, v_sid, 'server', now())
      on conflict (auth_id) do update set session_id = excluded.session_id, device_label = excluded.device_label, updated_at = now();
    end if;
  end if;

  -- 회사 IP 제한 (그대로)
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
