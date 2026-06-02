-- 채권 대사 매칭 엔진 — 처리 범위 확대 대응.
-- UI 가 p_days=1095(3년) 로 호출(180일이면 1년 넘은 미매칭 건 누락 — 엑스플라이어 등).
-- 미정산 거래 전량(약 5천건) 1회 처리 시 authenticated 기본 statement_timeout(8s) 초과 가능 →
-- 함수 단위 timeout 상향(트리거 아닌 호출형 RPC 라 안전).
alter function public.generate_settlement_suggestions(int) set statement_timeout = '170s';
