-- 참모가 대화에서 스스로 골라 저장한 메모(source='auto') 허용 (2026-09-03 사장님: "내가 말한 걸 자동으로 학습")
alter table public.ai_copilot_notes drop constraint if exists ai_copilot_notes_source_check;
alter table public.ai_copilot_notes add constraint ai_copilot_notes_source_check
  check (source in ('user','feedback','copilot','auto'));
