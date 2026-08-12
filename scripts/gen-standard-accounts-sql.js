const fs = require("fs");
const std = require("C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/99aba45e-e8c5-4e4d-92b4-53d3c7a9ffbc/scratchpad/std474.json");
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const values = std.map((o) => `    (${q(o.code)}, ${q(o.name)}, ${q(o.type)})`).join(",\n");

const sql = `-- 계정과목표를 사장님이 준 표준(계정과목.xlsx)으로 맞춘다 (2026-08-12)
--
--   History: 2026-06-12 시드가 **101 을 보통예금**으로 잡았다. 한국 표준 계정체계는
--     101 현금 · 102 당좌예금 · 103 보통예금 이다. 그 뒤로 전표 엔진(find_account)·
--     vat-voucher.STD.bank·전표입력 화면이 전부 '101 = 통장'을 전제로 쌓였다.
--     2026-08-12 사장님이 표준 엑셀(839행 = 실계정 474 + '회사설정계정과목' 빈칸 365)을 주며
--     "이 리스트로 맞춰라 · 계정과목명에 띄어쓰기는 없이" 지시. 101 을 표준으로 옮기기로 확정.
--
--   ★ 이력 보존의 핵심: journal_lines 는 **account_id** 로 붙어 있다. 그래서 계정 '행'의
--     code 만 바꾸면 그 계정에 달린 전표가 통째로 따라온다. 새로 만들고 옮기는 게 아니다.
--
--   같이 바뀐 것(같은 커밋): post_bank/card/cash/settlement_voucher · generate_voucher_drafts
--     (find_account 가 코드를 우선하므로 '101' 그대로 두면 통장 대신 **현금**을 집는다),
--     src/lib/vat-voucher.ts STD.bank, 전표입력 화면의 code==='101', 안내 문구.
--
--   목록은 src/lib/standard-accounts.ts 와 **같은 원본(엑셀)**에서 뽑았다.
--   다시 뽑을 때는 scripts/gen-standard-accounts.js 를 쓴다.

-- ── 1) 표준 목록을 한 곳에 둔다 ─────────────────────────────────────────────
--   시드와 기존 회사 동기화가 같은 목록을 보게 한다 — 두 벌로 두면 반드시 어긋난다.
CREATE OR REPLACE FUNCTION public.standard_chart_of_accounts()
 RETURNS TABLE (code text, name text, account_type text)
 LANGUAGE sql IMMUTABLE
AS $function$
  VALUES
${values}
$function$;

COMMENT ON FUNCTION public.standard_chart_of_accounts() IS
  '표준 계정과목 474개 (사장님 제공 계정과목.xlsx, 2026-08-12). 계정과목명에 띄어쓰기 없음. src/lib/standard-accounts.ts 와 같은 원본.';

-- ── 2) 전표 엔진: 보통예금 101 → 103 ────────────────────────────────────────
--   본문을 다시 쓰지 않고 정의를 읽어 코드만 치환한다 — 손으로 옮기다 생기는 오타를 막는다.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('generate_voucher_drafts', 'post_bank_voucher',
                        'post_card_voucher', 'post_cash_voucher', 'post_settlement_voucher')
      AND pg_get_functiondef(p.oid) LIKE '%''101''%'
  LOOP
    EXECUTE replace(r.def, '''101''', '''103''');
  END LOOP;
END $$;

-- ── 3) 기존 회사 계정과목표를 표준으로 ──────────────────────────────────────
--   3-1. 쓰이고 있는 계정은 **행을 옮긴다**(코드만 변경 → 전표 이력 유지).
--        옮길 자리(103·930·960)는 지금 시드에 없어 비어 있다.
UPDATE public.chart_of_accounts SET code = '103' WHERE code = '101' AND name = '보통예금';
UPDATE public.chart_of_accounts SET code = '930' WHERE code = '901' AND name = '잡이익';
UPDATE public.chart_of_accounts SET code = '960' WHERE code = '980' AND name = '잡손실';

--   3-2. 표준에 없는 자리 정리 — 100 현금. 표준은 101 이 현금이다.
--        어디에도 안 쓰인 것만 지운다(전표·카드매핑·전표규칙·부모계정 전부 확인).
DELETE FROM public.chart_of_accounts a
WHERE a.code = '100' AND a.name = '현금'
  AND NOT EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.account_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM public.card_account_mappings m WHERE m.account_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM public.voucher_account_rules v WHERE v.account_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.parent_id = a.id);

--   3-3. 표준 474개를 모든 회사에 맞춘다 — 있으면 이름·성격 갱신, 없으면 추가.
--        is_system 은 건드리지 않는다(엔진이 물고 있다는 표시라 옮겨온 행의 값을 지켜야 한다).
INSERT INTO public.chart_of_accounts (company_id, code, name, account_type)
SELECT t.company_id, s.code, s.name, s.account_type
FROM (SELECT DISTINCT company_id FROM public.chart_of_accounts) t
CROSS JOIN public.standard_chart_of_accounts() s
ON CONFLICT (company_id, code) DO UPDATE
  SET name = EXCLUDED.name, account_type = EXCLUDED.account_type;

-- ── 4) 신규 회사 시드도 같은 목록을 쓴다 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._seed_chart_of_accounts_internal(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  IF p_company_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id = p_company_id) THEN
    RETURN 0;
  END IF;

  --   is_system = 전표 엔진이 코드로 직접 찾는 계정. 사람이 지우면 자동분개가 멈춘다.
  INSERT INTO public.chart_of_accounts (company_id, code, name, account_type, is_system)
  SELECT p_company_id, s.code, s.name, s.account_type,
         s.code = ANY (ARRAY['103','108','135','136','251','253','255','401','404','831'])
  FROM public.standard_chart_of_accounts() s
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
`;
fs.writeFileSync("supabase/migrations/20260812120000_standard_chart_of_accounts.sql", sql, "utf8");
console.log("written", sql.length, "bytes ·", std.length, "accounts");
