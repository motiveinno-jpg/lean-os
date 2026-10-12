-- 세무 마감 신고본(tax_returns) 보강 — 2026-10-12 보안 검토 후속 (20261012100000_tax_returns.sql)
--
-- 왜: ① closed_by·cancelled_by 는 users FK on delete set null 이다. 사용자 행을 지우면 FK 가 이 표를 UPDATE 하는데,
--       tax_returns_guard 가 'closed → cancelled' 말고는 전부 거절해서 사용자 삭제 자체가 실패했다.
--     ② 칸 길이·jsonb 크기 상한이 없어 한 줄에 큰 값을 밀어 넣을 수 있었다.
--     ③ period_key 가 자유 문자라 같은 기간이 두 모양('2026-09'·'2026-9')으로 갈려 차수·수정신고 비교가 어긋날 수 있었다.
--
-- 규칙:
--   ① UPDATE 에서 '다른 칸은 전부 그대로, status 그대로, closed_by·cancelled_by 만 값 → NULL' 은 통과시킨다.
--      단 사용자 직접 쓰기(current_user = 'authenticated')는 통과시키지 않는다 — FK 동작은 표 주인 권한으로 돌기 때문에
--      사용자 삭제는 이 길로 통과하고, 화면이 작성자를 지우는 길은 열리지 않는다.
--   ② note ≤ 2000자 · cancel_reason ≤ 500자 · figures/manual < 64KB · schedules/source_ids < 1MB.
--   ③ period_key 모양
--        vat                       YYYY-(1p|1c|1h|2p|2c|2h)   — 기수(1·2) + 예정(p)·확정(c)·반기(h)
--        wht · daily_work_report   YYYY-MM
--        그 밖                      YYYY 또는 YYYY-영숫자 1~8자
--   ④ tax_returns_update 정책은 칸 보호를 트리거에 맡긴다 — 정책 주석으로 둘이 한 몸임을 남긴다.
--
-- 기존 데이터: 운영 0건(2026-10-12 확인) — 제약이 기존 줄에 걸릴 일 없음.
-- 버린 안: FK 를 on delete restrict 로 바꾸기 — 마감한 직원이 퇴사해도 사용자 행을 못 지우게 된다(신고본은 작성자 없이도 남아야 한다).
--          / 트리거를 SECURITY DEFINER 로 바꿔 예외 처리 — current_user 로 '사용자 직접'을 가르는 근거가 사라진다.

-- ── ① 칸 보호 트리거: FK set null 허용 ──────────────────────────────────
create or replace function public.tax_returns_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_next int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'closed' then
      raise exception '신고본은 마감(closed) 상태로만 만들 수 있습니다.' using errcode = 'P0001';
    end if;
    if new.cancelled_by is not null or new.cancelled_at is not null or new.cancel_reason is not null then
      raise exception '새 신고본에 취소 정보를 넣을 수 없습니다.' using errcode = 'P0001';
    end if;
    -- 같은 회사·종류·기간 마감을 한 줄로 세운다(동시에 두 사람이 마감해도 차수가 겹치지 않게)
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || '|' || new.kind || '|' || new.period_key, 0));
    select coalesce(max(revision) + 1, 0) into v_next
      from public.tax_returns
     where company_id = new.company_id and kind = new.kind and period_key = new.period_key;
    if new.revision is distinct from v_next then
      raise exception '차수가 맞지 않습니다 — 이 기간의 다음 차수는 %입니다(받은 값 %).', v_next, new.revision using errcode = 'P0001';
    end if;
    new.closed_at := now();
    new.created_at := now();
    return new;
  end if;

  -- UPDATE ① 사용자 삭제에 따른 FK set null — 작성자·취소자 칸만 값 → NULL, 나머지 전부 그대로
  if current_user <> 'authenticated'
     and new.status = old.status
     and (new.closed_by is not distinct from old.closed_by or new.closed_by is null)
     and (new.cancelled_by is not distinct from old.cancelled_by or new.cancelled_by is null)
     and row(new.id, new.company_id, new.kind, new.period_key, new.revision, new.figures, new.schedules,
             new.source_ids, new.manual, new.note, new.closed_at, new.created_at,
             new.cancelled_at, new.cancel_reason)
         is not distinct from
         row(old.id, old.company_id, old.kind, old.period_key, old.revision, old.figures, old.schedules,
             old.source_ids, old.manual, old.note, old.closed_at, old.created_at,
             old.cancelled_at, old.cancel_reason)
  then
    return new;
  end if;

  -- UPDATE ② closed → cancelled 한 번만, 취소 정보만
  if old.status <> 'closed' or new.status <> 'cancelled' then
    raise exception '신고본은 고칠 수 없습니다 — 마감본을 취소하는 것만 됩니다.' using errcode = 'P0001';
  end if;
  if row(new.id, new.company_id, new.kind, new.period_key, new.revision, new.figures, new.schedules,
         new.source_ids, new.manual, new.note, new.closed_by, new.closed_at, new.created_at)
     is distinct from
     row(old.id, old.company_id, old.kind, old.period_key, old.revision, old.figures, old.schedules,
         old.source_ids, old.manual, old.note, old.closed_by, old.closed_at, old.created_at)
  then
    raise exception '신고본 내용은 바꿀 수 없습니다 — 취소 후 새 차수로 마감해 주세요.' using errcode = 'P0001';
  end if;
  if current_user = 'authenticated' then
    new.cancelled_by := public.current_app_user_id();   -- 화면 값을 믿지 않는다
  end if;
  new.cancelled_at := now();
  return new;
end $$;

revoke execute on function public.tax_returns_guard() from public, anon, authenticated;

-- ── ② 길이·크기 상한 ────────────────────────────────────────────────────
alter table public.tax_returns drop constraint if exists tax_returns_size_check;
alter table public.tax_returns add constraint tax_returns_size_check check (
  length(coalesce(note, '')) <= 2000
  and length(coalesce(cancel_reason, '')) <= 500
  and pg_column_size(figures) < 65536
  and pg_column_size(schedules) < 1048576
  and pg_column_size(source_ids) < 1048576
  and pg_column_size(manual) < 65536
);

-- ── ③ period_key 모양 ───────────────────────────────────────────────────
alter table public.tax_returns drop constraint if exists tax_returns_period_key_check;
alter table public.tax_returns add constraint tax_returns_period_key_check check (
  case
    when kind = 'vat' then period_key ~ '^\d{4}-(1p|1c|1h|2p|2c|2h)$'
    when kind in ('wht', 'daily_work_report') then period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'
    else period_key ~ '^\d{4}(-[0-9A-Za-z]{1,8})?$'
  end
);

-- ── ④ 정책 주석 ─────────────────────────────────────────────────────────
comment on policy tax_returns_update on public.tax_returns is
  '회사+세무 신고 권한만 본다. 칸 불변(closed→cancelled 만 허용)은 트리거 tax_returns_guard 가 단독으로 지킨다 — 둘은 함께 유지할 것(트리거를 지우거나 바꾸면 신고본이 고쳐진다).';
