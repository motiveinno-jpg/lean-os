-- 에러 운영 정리 (2026-08-20 사장님: "이미 처리된 것들인데 대시보드에 계속 쌓인다")
--   1) 일괄 해결 RPC — 지금은 상세 패널에서 한 건씩만 눌러 해결할 수 있어, 고쳐 놓고도
--      아무도 표시를 안 해 대시보드에 계속 남았다.
--   2) 중복 접기 트리거의 범위를 '미해결 행'으로 좁힌다. 종전엔 해결 처리한 행에도 dup_count 만
--      올려서, 같은 에러가 재발해도 영영 안 보였다(= 해결 표시가 영구 음소거였다).
--      이제 해결 처리 후 재발하면 새 행으로 다시 뜬다.

-- 1) 일괄 해결
CREATE OR REPLACE FUNCTION public.operator_resolve_errors(
  p_ids uuid[],
  p_resolved boolean DEFAULT true
) RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE error_logs
     SET resolved = p_resolved
   WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.operator_resolve_errors(uuid[], boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.operator_resolve_errors(uuid[], boolean) TO authenticated;

-- 2) 중복 접기는 미해결 행에만
CREATE OR REPLACE FUNCTION public.error_logs_dedup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id
    FROM error_logs
   WHERE message = NEW.message
     AND coalesce(url, '') = coalesce(NEW.url, '')
     AND created_at > now() - interval '24 hours'
     AND resolved = false   -- 해결 처리된 건에 접으면 재발을 영영 못 본다 (2026-08-20)
   ORDER BY created_at DESC
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE error_logs
       SET dup_count = dup_count + 1,
           last_seen_at = now()
     WHERE id = existing_id;
    RETURN NULL; -- swallow the duplicate row
  END IF;

  NEW.last_seen_at = now();
  RETURN NEW;
END;
$function$;
