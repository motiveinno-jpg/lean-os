-- 프로젝트 v3 설문 2차 — 마감일·정원·1인 1회 (2026-09-01 사장님 승인)
--   1차: 20260901170000_project_surveys.sql (표·RLS·인덱스·트리거 완비)
--
--   왜 지금 이 세 칸이 필요한가: 1차 설문은 링크를 만들면 enabled 인 동안 무한정 열려 있다.
--   그런데 이건 회사 안 화면이 아니라 **외부로 발송하는 링크**다. 기한·정원 없이 상시 열려 있으면
--   ①행사·모집이 끝난 뒤에도 접수가 계속 들어와 담당자가 "이건 안 됩니다" 를 사람 손으로 돌려보내야 하고
--   ②링크 한 줄이 단체방에 돌면 같은 사람이 몇 번이고 다시 눌러 project_items 가 도배된다.
--   즉 막을 판단 기준을 사람 기억에 맡기지 말고 설문 설계에 못박는다.
--
--   판단 기준 3종 — 전부 project_surveys 가 담고, **집행은 엣지 함수 project-survey** 가 한다:
--     (1) closes_at 이 지났나        — 마감일
--     (2) response_count >= max_responses — 정원 도달(응답 수는 1차부터 이 표가 센다)
--     (3) 같은 IP 해시로 이미 냈나   — 1인 1회
--   왜 DB 제약(check·unique)이 아니라 엣지 함수인가:
--     · 마감 비교는 **한국 날짜 기준**이라야 한다. DB 의 now() 는 UTC 라 자정 전후 9시간이 어긋난다.
--       KST 로 자르는 판단을 엣지 한 곳에 두는 게 화면·API 어디서 봐도 같은 답이 나온다.
--     · 정원·중복은 거절 사유를 사람에게 **문장으로** 돌려줘야 한다(제약 위반 에러 문구는 못 보여준다).
--     · 응답 본체는 project_items 라 이 표에 unique 를 걸 대상이 없다.
--
--   anon 정책은 1차와 똑같이 **0개 유지** — token 이 곧 열쇠라 anon 에게 이 표를 열면 남의 회사
--   token 까지 긁힌다. 외부 조회·제출은 service role(엣지)이 token 으로 한 행만 찾아 처리한다.
--   RLS·인덱스·트리거 변경 없음(1차 그대로). 시드 없음 — 값은 사람이 설문 편집 화면에서 넣는다.
--   기존 데이터 처리: 세 칸 모두 null/false 기본값이라 이미 만든 설문은 지금까지와 동일하게
--   '상시·정원 없음·중복 허용' 으로 계속 동작한다(마이그레이션이 기존 링크를 막지 않는다).

alter table public.project_surveys
  add column if not exists closes_at date,
  add column if not exists max_responses int,
  add column if not exists prevent_dup boolean not null default false;

comment on column public.project_surveys.closes_at is
  '마감일 — 이 날까지 접수(당일 포함), null 이면 상시. 한국 날짜 기준 비교는 엣지 함수 project-survey 가 한다(DB now() 는 UTC 라 자정 전후가 어긋남).';
comment on column public.project_surveys.max_responses is
  '최대 응답 수 — null 이면 제한 없음. 도달 여부는 response_count >= max_responses 로 판단하며 거절은 엣지 함수 project-survey 가 문장으로 돌려준다.';
comment on column public.project_surveys.prevent_dup is
  '1인 1회 — 켜면 같은 IP 해시의 재제출을 거절한다. 완벽한 본인 식별이 아니다(공용 와이파이는 한 사람으로, 모바일 데이터는 다른 사람으로 보일 수 있음) — 이 한계를 응답 화면에 명시한다.';
