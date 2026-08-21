-- company_settings 의 평문 자격증명 칸 — 쓰지 말라고 못 박는다 (2026-08-21)
--
-- 실측(2026-08-21 prod, company_settings 5행):
--   hometax_password 0건 · hometax_user_id 0건 · codef_client_secret 0건 · slack_webhook_url 0건.
--   **네 칸 모두 값이 하나도 없다.** 앱에도 이 칸에 쓰는 화면이 없다(grep 확인).
--   codef_* 만 엣지 함수 3곳(codef-sync·codef-transfer·hometax-issue)이 읽는데,
--   전부 `settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET")` 라 지금은 env 를 쓴다.
--
-- 그래서 "평문을 암호화로 옮기는" 작업은 **옮길 것이 없다.**
--   남은 위험은 지금 있는 평문이 아니라 **앞으로 평문이 들어갈 수 있는 통로**다.
--   칸을 지우는 건 읽는 코드가 있어 사장님 판단이 필요하므로, 여기서는 주석으로 못 박는다.
--
-- 새로 자격증명을 받아야 하면 **company_api_keys**(pgcrypto 암호화 + 연결 상태)를 쓴다.

comment on column public.company_settings.hometax_password is
  '⚠️ 쓰지 말 것 — 평문 칸이다. 2026-08-21 기준 값 0건이고 쓰는 화면도 없다. 자격증명은 company_api_keys(암호화)에 넣는다.';
comment on column public.company_settings.hometax_user_id is
  '⚠️ 쓰지 말 것 — 평문 칸이다. 2026-08-21 기준 값 0건. 자격증명은 company_api_keys(암호화)에 넣는다.';
comment on column public.company_settings.codef_client_secret is
  '⚠️ 쓰지 말 것 — 평문 칸이다. 2026-08-21 기준 값 0건이고 엣지 함수는 env(CODEF_CLIENT_SECRET)로 동작한다. 회사별로 받아야 하면 company_api_keys(암호화)를 쓴다.';
comment on column public.company_settings.slack_webhook_url is
  '⚠️ 웹훅 주소는 그 자체가 발송 권한이다 — 평문으로 두지 말 것. 2026-08-21 기준 값 0건.';
