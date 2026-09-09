-- 보안 점검(2026-09-09) S07: 페이지에서만 걸리던 IP 제한·중복 로그인 차단을 데이터 API(PostgREST) 요청에도 건다.
--   브라우저는 Supabase REST/RPC 를 직접 부르므로 middleware 만으로는 막히지 않았다.
--   PostgREST 의 요청 전 훅(db_pre_request)에서 session_gate() 를 호출한다.
--   · authenticated 역할 요청만 검사(anon·service_role 제외) · 판정 오류는 열어 둔다(장애가 전원 잠금이 되면 안 됨)
--   · 차단 사유가 duplicate/ip 일 때만 403 (PostgREST 는 SQLSTATE PT403 → HTTP 403).
-- session_gate 는 판정과 세션 등록(active_sessions 쓰기)을 함께 했다. PostgREST 는 GET 을 읽기 전용 트랜잭션으로 돌리므로
-- 그 안에서 쓰기를 하면 예외가 나고 판정 전체가 무효가 된다. 등록 여부를 p_register 로 분리해 읽기 요청은 판정만 한다.
-- (미들웨어의 rpc('session_gate', {p_ip}) 호출은 기본값 true 라 그대로 동작한다.)
drop function if exists public.session_gate(text);
create or replace function public.session_gate(p_ip text, p_register boolean default true)
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
      if p_register then
        insert into active_sessions (auth_id, session_id, device_label, updated_at)
        values (v_uid, v_sid, 'server', now())
        on conflict (auth_id) do update set session_id = excluded.session_id, device_label = excluded.device_label, updated_at = now();
      end if;
    end if;
  end if;

  -- 회사 IP 제한
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
revoke all on function public.session_gate(text, boolean) from public, anon;
grant execute on function public.session_gate(text, boolean) to authenticated, service_role;

create or replace function public.pgrst_session_gate()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_headers jsonb;
  v_ip text;
  v_verdict jsonb;
begin
  if v_role <> 'authenticated' then return; end if;
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
    -- 접속 IP: Cloudflare 가 붙이는 cf-connecting-ip 가 기준. 없으면 X-Forwarded-For 의 마지막 홉(게이트웨이가 본 IP), 그다음 x-real-ip.
    v_ip := coalesce(
      nullif(v_headers ->> 'cf-connecting-ip', ''),
      nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', greatest(1, array_length(string_to_array(coalesce(v_headers ->> 'x-forwarded-for', ''), ','), 1)))), ''),
      nullif(v_headers ->> 'x-real-ip', ''), 'unknown');
    -- 읽기 전용 트랜잭션(GET)에서는 판정만, 쓰기 요청에서는 세션 등록까지
    v_verdict := public.session_gate(v_ip, coalesce(current_setting('transaction_read_only', true), 'off') = 'off');
  exception when others then
    return;   -- 판정 실패는 열어 둔다
  end;
  if coalesce((v_verdict ->> 'ok')::boolean, true) = false and (v_verdict ->> 'reason') in ('duplicate', 'ip') then
    raise exception 'session_gate:%', v_verdict ->> 'reason' using errcode = 'PT403';
  end if;
end;
$function$;
revoke all on function public.pgrst_session_gate() from public;
grant execute on function public.pgrst_session_gate() to authenticator, anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.pgrst_session_gate';
notify pgrst, 'reload config';
