-- 결재허브 새 요청 — 요청 유형 즐겨찾기 (2026-09-02 사장님: "요청건들이 많으면 즐겨찾기")
--   기기별 localStorage 가 아니라 계정별 저장(사이드바 고정핀·탭 투어와 같은 기조). 값 = 유형 value 배열
--   (내장 유형 키 또는 'form:<양식id>'). 지워진 양식 값은 화면에서 무시한다.
alter table public.user_preferences
  add column if not exists approval_type_favorites jsonb not null default '[]'::jsonb;
