-- has_perm — 지금 소속 회사(users.company_id)에서 받은 권한만 본다 (2026-10-01).
--   History: member_permissions 에 company_id 가 있는데 has_perm 은 회사를 보지 않았다. 사용자 한 명 = 회사 하나(users.company_id)라
--   평소엔 같은 값이지만, A 회사를 떠나 B 회사에 합류하면 A 에서 받은 권한 행이 남아 B 의 RLS(has_perm 을 쓰는 모든 정책)에서도 통했다.
--   실측(적용 전): 로그인 가능한 계정의 권한 590행 중 회사가 어긋난 행 0 — 지금 쓰는 사람의 권한은 하나도 안 바뀐다.
--   어긋난 19행은 탈퇴 처리된 계정(auth 없음) 1명의 모티브 권한 — 데이터는 그대로 둔다(지우지 않음).
--   화면 쪽 currentUserIsManager 는 이미 company_id 로 거른다 — DB 를 같은 기준으로 맞춘다. 시그니처·마스터 규칙 그대로.
create or replace function public.has_perm(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.auth_id = (select auth.uid())
      and (u.is_master
           or exists (select 1 from member_permissions mp
                      where mp.user_id = u.id and mp.company_id = u.company_id and mp.perm_key = p_key))
  );
$$;
