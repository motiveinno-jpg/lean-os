-- 알림 발송 로그 (2026-07-29) — 카카오 알림톡 연동 1단계
--   send-kakao-alimtalk 엣지 함수가 이 테이블에 insert 하는데 테이블이 없어서
--   .then(()=>{},()=>{}) 로 오류를 삼키고 있었다 — 발송 기록이 통째로 사라지던 상태.
--   컬럼은 그 함수가 실제로 넣는 키(company_id·channel·template_code·recipient·
--   title·body·status·external_id·metadata)에 정확히 맞춰 검증했다.
--
--   채널을 kakao 로 한정하지 않는다 — 이메일/SMS 도 같은 표에 쌓아 "이 고객에게
--   무엇이 언제 나갔는지"를 한 곳에서 보게 하려는 목적.
--
--   검증(2026-07-29): 함수가 넣는 9개 키 전부 컬럼 존재 확인 → 동일 형태 insert 성공 →
--   운영자 조회 2건/외부 사용자 0건/양쪽 쓰기 불가(정책 없음 = service_role 전용) 확인.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

create table if not exists public.notification_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete set null,
  channel       text not null,                 -- kakao_alimtalk | email | sms ...
  template_code text,
  recipient     text not null,                 -- 전화번호 또는 이메일
  title         text,
  body          text,
  status        text not null default 'queued',-- queued|sent|failed|skipped
  external_id   text,                          -- 중계사 messageId (조회·CS 대응용)
  error_message text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.notification_logs is
  '알림 발송 로그(카카오 알림톡·이메일 등). recipient 는 연락처라 개인정보 — 운영자/본인 회사만 조회.';

create index if not exists notification_logs_company_idx on public.notification_logs (company_id, created_at desc);
create index if not exists notification_logs_created_idx on public.notification_logs (created_at desc);
create index if not exists notification_logs_status_idx  on public.notification_logs (status, created_at desc)
  where status <> 'sent';   -- 실패 건 추적용 부분 인덱스

alter table public.notification_logs enable row level security;

-- 조회: 자기 회사 것 + 운영자는 전체. 쓰기 정책은 두지 않는다 —
--   기록은 엣지 함수(service_role)만 남기며, service_role 은 RLS 를 우회한다.
--   즉 클라이언트는 어떤 경로로도 로그를 위조/수정할 수 없다.
drop policy if exists notification_logs_select on public.notification_logs;
create policy notification_logs_select on public.notification_logs
  for select to authenticated
  using (company_id = (select public.get_my_company_id()) or (select public.is_platform_operator()));
