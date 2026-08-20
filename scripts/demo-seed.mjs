#!/usr/bin/env node
/**
 * OwnerView — 소개서 캡처용 **시연 회사(오너뷰)** 시드 (2026-08-20 사장님 지시)
 *
 *   투자자·사용자 공용 소개서(PPT)에 들어갈 화면을 찍으려면 실회사 데이터를 쓸 수 없다
 *   ((주)모티브이노베이션은 거래 7,217건·거래처 727곳의 실데이터).
 *   그래서 **가상 회사 '오너뷰'** 를 만들고 형식만 유효한 가짜 값으로 채운다.
 *   사장님: "데이터는 마이그레이션 쳐도 됨(모티브의 실질정보가 드러나면 안 되기 때문)".
 *
 * 실행:
 *   node scripts/demo-seed.mjs         — 생성(있으면 정보만 출력)
 *   node scripts/demo-seed.mjs status  — 존재 확인
 *   node scripts/demo-seed.mjs teardown— 시연 회사와 딸린 데이터 삭제
 *
 * ⚠️ prod DB 를 변경한다 — 두 PC 동시 DB 작업 금지.
 * 안전장치: demo-ov-*@mo-tive.com 계정과 그 회사에만 손댄다. 실회사 이름·사업자번호·계좌는 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const OWNER_EMAIL = "demo-ov-owner@mo-tive.com";
const STAFF_EMAIL = "demo-ov-staff@mo-tive.com";
const PASSWORD = "OvDemo!2026";
const COMPANY_NAME = "오너뷰";

function readPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const raw = readFileSync(resolve(REPO_ROOT, ".env.supabase.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^(?:SUPABASE_ACCESS_TOKEN\s*=\s*)?(.+)$/);
      if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* fall through */ }
  return null;
}
const PAT = readPat();
if (!PAT) { console.error("❌ SUPABASE_ACCESS_TOKEN 없음 (.env.supabase.local)"); process.exit(1); }

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`SQL 실패 (${res.status}): ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}
async function serviceKey() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`api-keys 조회 실패 (${res.status})`);
  const keys = await res.json();
  const svc = keys.find((k) => k.name === "service_role" || k.id === "service_role");
  if (!svc?.api_key) throw new Error("service_role 키를 찾지 못했습니다.");
  return svc.api_key;
}
async function status() {
  return sql(`select u.email, u.company_id, c.name as company
    from users u left join companies c on c.id = u.company_id
    where u.email in ('${OWNER_EMAIL}','${STAFF_EMAIL}') order by u.email;`);
}

const q = (s) => String(s).replace(/'/g, "''");

async function seed() {
  const existing = await status();
  if (existing.length > 0) {
    console.log("✅ 시연 회사가 이미 있습니다:");
    for (const r of existing) console.log(`   ${r.email} → ${r.company} (${r.company_id})`);
    console.log(`   비밀번호: ${PASSWORD}`);
    return existing[0].company_id;
  }
  console.log("⚠️  prod DB 에 시연 회사(오너뷰)를 만듭니다 — 다른 PC 에서 DB 작업 중이면 중단하세요.");
  const svc = await serviceKey();
  const mk = async (email, name) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`auth 생성 실패 (${email}): ${res.status} ${JSON.stringify(body)}`);
    return body.id;
  };
  const ownerId = await mk(OWNER_EMAIL, "정한결");
  const staffId = await mk(STAFF_EMAIL, "서지우");

  await sql(`
    do $$
    declare cid uuid;
    begin
      insert into companies (name, industry, business_number, representative, address, phone, business_type, business_category)
        values ('${COMPANY_NAME}', 'it/소프트웨어', '000-00-00000', '정한결',
                '서울특별시 강남구 테헤란로 000, 00층', '0200000000', '정보통신업', '소프트웨어 개발')
        returning id into cid;
      insert into users (id, auth_id, company_id, email, name, role, is_master) values
        ('${ownerId}', '${ownerId}', cid, '${OWNER_EMAIL}', '정한결', 'owner', true),
        ('${staffId}', '${staffId}', cid, '${STAFF_EMAIL}', '서지우', 'employee', false);
      insert into company_settings (company_id, work_start_time, work_end_time, lunch_minutes, late_grace_minutes, workdays_mask)
        values (cid, '09:00', '18:00', 60, 5, 31);
      insert into subscriptions (company_id, plan_id, plan_slug, status, current_period_start, current_period_end)
        select cid, id, slug, 'active', now(), now() + interval '30 days'
        from subscription_plans where slug = 'standard';
    end $$;`);
  const made = await status();
  const cid = made[0].company_id;
  console.log(`✅ 회사 생성: ${COMPANY_NAME} (${cid})`);
  return cid;
}

/** 시드 본체 — 거래처 · 통장 · 카드 · 거래 · 세금계산서 · 직원 */
async function fill(cid) {
  console.log("… 데이터 시딩");

  //   두 번 돌려도 같은 결과가 되도록 **이 회사의 시드 데이터만** 비우고 다시 채운다
  //   (2026-08-20: 재실행으로 거래처 150·거래 475건까지 불어난 사고 후 추가).
  await sql(`
    delete from journal_lines where company_id='${cid}';
    delete from journal_entries where company_id='${cid}';
    delete from bank_transactions where company_id='${cid}';
    delete from card_transactions where company_id='${cid}';
    delete from tax_invoices where company_id='${cid}';
    delete from bank_accounts where company_id='${cid}';
    delete from corporate_cards where company_id='${cid}';
    delete from employees where company_id='${cid}';
    delete from partners where company_id='${cid}';`);

  // ── 거래처 30곳 (가공 상호 — 실재 회사와 겹치지 않게 조합) ──
  const PARTNERS = [
    ["가온컴퍼니", "client"], ["나린테크", "client"], ["다온커머스", "client"], ["라온디자인", "client"],
    ["마루소프트", "client"], ["바로랩스", "client"], ["새롬미디어", "client"], ["아라솔루션", "client"],
    ["자연커뮤니케이션", "client"], ["하늘물산", "client"], ["온새미로", "client"], ["빛가람스튜디오", "client"],
    ["푸른들유통", "client"], ["한올패키지", "client"], ["미르시스템", "client"],
    ["가람오피스", "vendor"], ["누리클라우드", "vendor"], ["도담물류", "vendor"], ["로하스인쇄", "vendor"],
    ["모아소재", "vendor"], ["바다상사", "vendor"], ["산들네트웍스", "vendor"], ["여울광고", "vendor"],
    ["초록마루", "vendor"], ["터전건설", "vendor"], ["푸실산업", "vendor"], ["해든에이전시", "vendor"],
    ["윤슬컨설팅", "vendor"], ["아름드리교육", "vendor"], ["별하늘렌탈", "vendor"],
  ];
  const pv = PARTNERS.map(([n, t], i) =>
    `('${cid}','${q(n)}','${t}','${String(100 + i).padStart(3, "0")}-${String(80 + (i % 10))}-${String(10000 + i * 37).slice(0, 5)}')`).join(",");
  await sql(`insert into partners (company_id, name, type, business_number) values ${pv}
             on conflict do nothing;`);

  // ── 통장 3 · 카드 2 ──
  await sql(`
    insert into bank_accounts (company_id, bank_name, account_number, alias, role, balance, is_primary) values
      ('${cid}','국민은행','000-00-0000-000','주거래 통장','operating', 68390000, true),
      ('${cid}','기업은행','000-000000-00-000','급여 통장','payroll', 21500000, false),
      ('${cid}','신한은행','000-000-000000','세금 통장','tax', 9800000, false)
    on conflict do nothing;
    insert into corporate_cards (company_id, card_name, card_number, card_company, holder_name, monthly_limit, is_active, payment_day) values
      ('${cid}','법인카드(운영)','0000-0000-0000-0000','신한카드','정한결', 20000000, true, 25),
      ('${cid}','법인카드(마케팅)','0000-0000-0000-0001','국민카드','서지우', 10000000, true, 25)
    on conflict do nothing;`);

  // ── 통장 거래 ~180건 (최근 90일) ──
  await sql(`
    do $$
    declare
      cid uuid := '${cid}';
      acc uuid; pay uuid; taxa uuid;
      d date; i int; amt numeric; pname text; bal numeric := 68390000;
      sales text[] := array['가온컴퍼니','나린테크','다온커머스','라온디자인','마루소프트','바로랩스','새롬미디어','아라솔루션','자연커뮤니케이션','하늘물산','온새미로','빛가람스튜디오','푸른들유통','한올패키지','미르시스템'];
      buys  text[] := array['가람오피스','누리클라우드','도담물류','로하스인쇄','모아소재','바다상사','산들네트웍스','여울광고','초록마루','터전건설','푸실산업','해든에이전시','윤슬컨설팅','아름드리교육','별하늘렌탈'];
    begin
      select id into acc from bank_accounts where company_id=cid and role='operating' limit 1;
      select id into pay from bank_accounts where company_id=cid and role='payroll' limit 1;
      select id into taxa from bank_accounts where company_id=cid and role='tax' limit 1;
      for i in 0..89 loop
        d := current_date - i;
        if extract(dow from d) between 1 and 5 then
          -- 입금 (매출 수금)
          if i % 3 = 0 then
            amt := (round((random()*90+15))::int) * 100000;
            pname := sales[1 + (i % array_length(sales,1))];
            insert into bank_transactions (company_id, bank_account_id, transaction_date, amount, type, counterparty, description, classification, mapping_status, source, balance_after, partner_id)
              values (cid, acc, d, amt, 'income', pname, pname || ' 대금 입금', 'sales', case when i%7=0 then 'unmapped' else 'auto_mapped' end, 'demo', bal, (select id from partners where company_id=cid and name=pname limit 1));
          end if;
          -- 출금 (매입·경비)
          amt := (round((random()*40+3))::int) * 100000;
          pname := buys[1 + (i % array_length(buys,1))];
          insert into bank_transactions (company_id, bank_account_id, transaction_date, amount, type, counterparty, description, classification, mapping_status, source, balance_after, partner_id)
            values (cid, acc, d, amt, 'expense', pname, pname || ' 결제', 'purchase', case when i%5=0 then 'unmapped' else 'auto_mapped' end, 'demo', bal, (select id from partners where company_id=cid and name=pname limit 1));
        end if;
        -- 급여 (매월 25일)
        if extract(day from d) = 25 then
          insert into bank_transactions (company_id, bank_account_id, transaction_date, amount, type, counterparty, description, classification, mapping_status, source, is_fixed_cost)
            values (cid, pay, d, 38400000, 'expense', '급여이체', '2026년 급여 지급', 'payroll', 'auto_mapped', 'demo', true);
        end if;
        -- 임대료 (매월 5일)
        if extract(day from d) = 5 then
          insert into bank_transactions (company_id, bank_account_id, transaction_date, amount, type, counterparty, description, classification, mapping_status, source, is_fixed_cost)
            values (cid, acc, d, 3300000, 'expense', '터전건설', '사무실 임대료', 'rent', 'auto_mapped', 'demo', true);
        end if;
        -- 부가세·원천세 (매월 10일)
        if extract(day from d) = 10 then
          insert into bank_transactions (company_id, bank_account_id, transaction_date, amount, type, counterparty, description, classification, mapping_status, source, is_fixed_cost)
            values (cid, taxa, d, 4820000, 'expense', '국세청', '원천세 납부', 'tax', 'auto_mapped', 'demo', true);
        end if;
      end loop;
    end $$;`);

  // ── 카드 거래 ~120건 ──
  await sql(`
    do $$
    declare
      cid uuid := '${cid}'; c1 uuid; c2 uuid; d date; i int;
      m text[] := array['쿠팡','네이버클라우드','스타벅스','GS25','배달의민족','아마존웹서비스','올리브영','이마트','한국철도공사','대한항공','메가박스','다이소','교보문고','현대오일뱅크','노션랩스'];
      cat text[] := array['소모품비','지급수수료','복리후생비','복리후생비','복리후생비','지급수수료','복리후생비','소모품비','여비교통비','여비교통비','복리후생비','소모품비','도서인쇄비','차량유지비','지급수수료'];
    begin
      select id into c1 from corporate_cards where company_id=cid and card_name like '%운영%' limit 1;
      select id into c2 from corporate_cards where company_id=cid and card_name like '%마케팅%' limit 1;
      for i in 0..89 loop
        d := current_date - i;
        if extract(dow from d) between 1 and 5 then
          insert into card_transactions (company_id, card_id, transaction_date, merchant_name, amount, category, classification, mapping_status, source, is_deductible, card_name)
            values (cid, case when i%2=0 then c1 else c2 end, d,
                    m[1 + (i % array_length(m,1))],
                    (round((random()*25+2))::int) * 10000,
                    cat[1 + (i % array_length(cat,1))], 'expense',
                    case when i%6=0 then 'unmapped' else 'auto_mapped' end, 'demo', true,
                    case when i%2=0 then '법인카드(운영)' else '법인카드(마케팅)' end);
        end if;
      end loop;
    end $$;`);

  // ── 세금계산서 (매출 40 · 매입 30) — 일부는 미수 ──
  await sql(`
    do $$
    declare
      cid uuid := '${cid}'; i int; sup numeric; d date; pn text;
      sales text[] := array['가온컴퍼니','나린테크','다온커머스','라온디자인','마루소프트','바로랩스','새롬미디어','아라솔루션','자연커뮤니케이션','하늘물산'];
      buys  text[] := array['가람오피스','누리클라우드','도담물류','로하스인쇄','모아소재','바다상사','산들네트웍스','여울광고','초록마루','터전건설'];
    begin
      for i in 0..39 loop
        d := current_date - (i*3);
        pn := sales[1 + (i % array_length(sales,1))];
        sup := (round((random()*80+20))::int) * 100000;
        insert into tax_invoices (company_id, type, counterparty_name, counterparty_bizno, supply_amount, tax_amount, total_amount, issue_date, status, partner_id, item_name, settlement_status, settled_amount)
          values (cid, 'sales', pn, '000-00-00000', sup, round(sup*0.1), round(sup*1.1), d,
                  'issued', (select id from partners where company_id=cid and name=pn limit 1),
                  '용역 대금', case when i%3=0 then 'open' else 'settled' end,
                  case when i%3=0 then 0 else round(sup*1.1) end);
      end loop;
      for i in 0..29 loop
        d := current_date - (i*4);
        pn := buys[1 + (i % array_length(buys,1))];
        sup := (round((random()*40+5))::int) * 100000;
        insert into tax_invoices (company_id, type, counterparty_name, counterparty_bizno, supply_amount, tax_amount, total_amount, issue_date, status, partner_id, item_name, settlement_status, settled_amount)
          values (cid, 'purchase', pn, '000-00-00000', sup, round(sup*0.1), round(sup*1.1), d,
                  'issued', (select id from partners where company_id=cid and name=pn limit 1),
                  '자재/용역', 'settled', round(sup*1.1));
      end loop;
    end $$;`);

  // ── 직원 8명 (가명) ──
  await sql(`
    insert into employees (company_id, name, status, hire_date, position, department, employment_type, salary, work_start_time, work_end_time) values
      ('${cid}','정한결','active','2021-09-27','대표이사','경영','regular', 0, '09:00','18:00'),
      ('${cid}','서지우','active','2023-03-02','팀장','세일즈','regular', 4200000, '09:00','18:00'),
      ('${cid}','한도윤','active','2024-01-08','매니저','마케팅','regular', 3600000, '09:00','18:00'),
      ('${cid}','노아린','active','2024-07-01','매니저','재무','regular', 3800000, '09:00','18:00'),
      ('${cid}','문시현','active','2025-02-17','사원','세일즈','regular', 3000000, '09:00','18:00'),
      ('${cid}','오채원','active','2025-06-02','사원','마케팅','regular', 2900000, '09:00','18:00'),
      ('${cid}','임하준','active','2026-01-05','사원','개발','regular', 3400000, '09:00','18:00'),
      ('${cid}','강유진','active','2026-04-01','사원','운영','regular', 2800000, '09:00','18:00')
    on conflict do nothing;
    update employees set user_id = (select id from users where email='${STAFF_EMAIL}')
      where company_id='${cid}' and name='서지우';`);

  // ── 확정 전표 — 손익계산서·재무상태표·경영요약이 **전표만** 읽는다 (2026-08-11 규칙) ──
  //   매출 세금계산서 → (차)외상매출금 / (대)매출·부가세예수금
  //   매입 세금계산서 → (차)비용·부가세대급금 / (대)외상매입금
  //   카드 사용     → (차)비용 / (대)미지급금
  await sql(`
    do $$
    declare
      cid uuid := '${cid}';
      a_ar uuid; a_sales uuid; a_vat_out uuid; a_ap uuid; a_vat_in uuid;
      a_cost uuid; a_fee uuid; a_welfare uuid; a_unpaid uuid;
      r record; eid uuid; vno int := 1;
    begin
      -- 계정은 **코드**로 잡는다(이름은 제조/판관에 중복으로 존재 — 511·611·711·811 복리후생비)
      select id into a_ar      from chart_of_accounts where company_id=cid and code='108' limit 1;  -- 외상매출금
      select id into a_sales   from chart_of_accounts where company_id=cid and code='404' limit 1;  -- 제품매출
      select id into a_vat_out from chart_of_accounts where company_id=cid and code='255' limit 1;  -- 부가세예수금
      select id into a_ap      from chart_of_accounts where company_id=cid and code='251' limit 1;  -- 외상매입금
      select id into a_vat_in  from chart_of_accounts where company_id=cid and code='135' limit 1;  -- 부가세대급금
      select id into a_cost    from chart_of_accounts where company_id=cid and code='831' limit 1;  -- 지급수수료(판관비)
      select id into a_fee     from chart_of_accounts where company_id=cid and code='833' limit 1;  -- 광고선전비
      select id into a_welfare from chart_of_accounts where company_id=cid and code='811' limit 1;  -- 복리후생비(판관비)
      select id into a_unpaid  from chart_of_accounts where company_id=cid and code='253' limit 1;  -- 미지급금

      -- 매출 계산서 전표
      for r in select * from tax_invoices where company_id=cid and type='sales' order by issue_date loop
        insert into journal_entries (company_id, entry_date, description, status, source, voucher_no, voucher_type, entry_kind, supply_amount, vat_amount, linked_invoice_id)
          values (cid, r.issue_date, r.counterparty_name || ' 매출', 'confirmed', 'rule', vno, null, 'sale_purchase', r.supply_amount, r.tax_amount, r.id)
          returning id into eid;
        insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
          (eid, cid, a_ar,      r.total_amount, 0, '외상매출금', r.partner_id),
          (eid, cid, a_sales,   0, r.supply_amount, '매출', r.partner_id),
          (eid, cid, a_vat_out, 0, r.tax_amount, '부가세예수금', r.partner_id);
        update tax_invoices set journal_entry_id = eid where id = r.id;
        vno := vno + 1;
      end loop;

      -- 매입 계산서 전표
      for r in select * from tax_invoices where company_id=cid and type='purchase' order by issue_date loop
        insert into journal_entries (company_id, entry_date, description, status, source, voucher_no, voucher_type, entry_kind, supply_amount, vat_amount, linked_invoice_id)
          values (cid, r.issue_date, r.counterparty_name || ' 매입', 'confirmed', 'rule', vno, null, 'sale_purchase', r.supply_amount, r.tax_amount, r.id)
          returning id into eid;
        insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
          (eid, cid, a_cost,   r.supply_amount, 0, '외주·용역', r.partner_id),
          (eid, cid, a_vat_in, r.tax_amount, 0, '부가세대급금', r.partner_id),
          (eid, cid, a_ap,     0, r.total_amount, '외상매입금', r.partner_id);
        update tax_invoices set journal_entry_id = eid where id = r.id;
        vno := vno + 1;
      end loop;

      -- 카드 사용 전표 (복리후생비/지급수수료로 단순화)
      for r in select * from card_transactions where company_id=cid order by transaction_date loop
        insert into journal_entries (company_id, entry_date, description, status, source, voucher_no, voucher_type, entry_kind)
          values (cid, r.transaction_date, r.merchant_name || ' 카드', 'confirmed', 'rule', vno, 'cash_out', 'general')
          returning id into eid;
        insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
          (eid, cid, coalesce(a_welfare, a_fee), r.amount, 0, r.merchant_name),
          (eid, cid, a_unpaid, 0, r.amount, '미지급금(카드)');
        update card_transactions set journal_entry_id = eid where id = r.id;
        vno := vno + 1;
      end loop;
    end $$;`);

  const counts = await sql(`select
      (select count(*) from partners where company_id='${cid}') partners,
      (select count(*) from bank_transactions where company_id='${cid}') bank_tx,
      (select count(*) from card_transactions where company_id='${cid}') card_tx,
      (select count(*) from tax_invoices where company_id='${cid}') invoices,
      (select count(*) from employees where company_id='${cid}') emps;`);
  console.log("✅ 시딩 완료:", counts[0]);
}

async function teardown() {
  const existing = await status();
  if (existing.length === 0) { console.log("✅ 시연 회사 없음."); return; }
  console.log("⚠️  prod DB 에서 시연 회사를 삭제합니다.");
  const svc = await serviceKey();
  await sql(`
    do $$
    declare cid uuid; stranger int;
    begin
      select company_id into cid from users where email='${OWNER_EMAIL}' limit 1;
      if cid is null then return; end if;
      select count(*) into stranger from users where company_id=cid and email not like 'demo-ov-%@mo-tive.com';
      if stranger > 0 then raise exception 'SAFETY: 시연 회사가 아닙니다 (외부 계정 %명)', stranger; end if;
      delete from bank_transactions where company_id=cid;
      delete from card_transactions where company_id=cid;
      delete from tax_invoices where company_id=cid;
      delete from bank_accounts where company_id=cid;
      delete from corporate_cards where company_id=cid;
      delete from employees where company_id=cid;
      delete from partners where company_id=cid;
      delete from company_settings where company_id=cid;
      delete from subscriptions where company_id=cid;
      delete from users where company_id=cid;
      delete from companies where id=cid;
    end $$;`);
  for (const r of existing) {
    const uid = (await sql(`select id from auth.users where email='${r.email}'`))[0]?.id;
    if (uid) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` },
    });
  }
  console.log("✅ 삭제 완료");
}

const cmd = process.argv[2] || "seed";
if (cmd === "status") { console.log(await status()); }
else if (cmd === "teardown") { await teardown(); }
else {
  const cid = await seed();
  await fill(cid);
  console.log(`\n로그인: ${OWNER_EMAIL} / ${PASSWORD}`);
}
