-- 프로젝트 소프트 삭제(deals.archived_at) 대응 — 직원용 RPC 에서도 삭제된 행 제외.
-- 기존 정의 그대로 + WHERE 절에 `AND d.archived_at IS NULL` 만 추가.

CREATE OR REPLACE FUNCTION public.get_my_assigned_deals()
RETURNS TABLE(id uuid, name text, status text, my_role text, created_at timestamp without time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    d.id,
    d.name,
    d.status,
    COALESCE(
      (SELECT da.role
         FROM deal_assignments da
        WHERE da.deal_id = d.id
          AND da.user_id = current_app_user_id()
          AND da.role IN ('manager', 'reviewer', 'participant')
          AND da.is_active = true
        ORDER BY da.assigned_at DESC
        LIMIT 1),
      CASE WHEN d.internal_manager_id = current_app_user_id()
           THEN 'manager' END
    ) AS my_role,
    d.created_at
  FROM deals d
  WHERE d.company_id = get_my_company_id()
    AND d.archived_at IS NULL  -- 2026-05-21 소프트 삭제 제외
    AND (
      EXISTS (
        SELECT 1
          FROM deal_assignments da
         WHERE da.deal_id = d.id
           AND da.user_id = current_app_user_id()
           AND da.role IN ('manager', 'reviewer', 'participant')
           AND da.is_active = true
      )
      OR d.internal_manager_id = current_app_user_id()
    )
  ORDER BY d.created_at DESC NULLS LAST;
$function$;

NOTIFY pgrst, 'reload schema';
