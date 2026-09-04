#!/usr/bin/env node
// 블로그 캡처용 자료 — QA 시드 회사(스크린샷 전용, 개인정보 없음)의 근태 기록을 채운다.
//   글에 "연차·반차·지각이 쌓인다" 고 써 놓고 화면이 전부 0 이면 글과 그림이 어긋난다(2026-09-04 사장님 지적).
//   다른 회사는 절대 건드리지 않는다 — company_id 를 이름으로 한 번 더 확인하고 그 회사만 지우고 다시 넣는다.
//   실행: node scripts/blog-shot-seed.mjs        (토큰은 ~/motive-lean-os-qa/.env.supabase.local)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const envFile = path.join(os.homedir(), "motive-lean-os-qa", ".env.supabase.local");
const PAT = process.env.SUPABASE_ACCESS_TOKEN || (fs.existsSync(envFile) ? (fs.readFileSync(envFile, "utf8").match(/SUPABASE_ACCESS_TOKEN=(.+)/) || [])[1]?.trim().replace(/^"|"$/g, "") : null);
if (!PAT) { console.error("SUPABASE_ACCESS_TOKEN 이 없습니다."); process.exit(1); }

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`SQL 실패 (${res.status}): ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

const COMPANY = "4d2157e8-35a2-4a78-8c6d-c774475ab110";   // QA 시드 주식회사
const rows = await sql(`select id, name from companies where id = '${COMPANY}'`);
if (!rows.length || !/QA/i.test(rows[0].name)) { console.error("QA 시드 회사가 아닙니다. 중단합니다:", JSON.stringify(rows)); process.exit(1); }
console.log("대상 회사:", rows[0].name);

//   이번 달 근무일(월~금)에 출근을 만들고, 그 위에 지각·재택·반차·연차를 얹는다.
await sql(`
do $$
declare cid uuid := '${COMPANY}';
  d date; emp record; i int;
begin
  delete from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date;
  delete from leave_requests where company_id = cid and start_date >= date_trunc('month', current_date)::date;

  -- 재직자 전원, 이번 달 1일부터 오늘까지의 평일에 정상 출근(09:00~18:00, 점심 60분)
  for emp in select id, name, row_number() over (order by name) as n from employees where company_id = cid and status not in ('invited','inactive','resigned') loop
    d := date_trunc('month', current_date)::date;
    while d <= current_date loop
      if extract(dow from d) between 1 and 5 then
        insert into attendance_records (company_id, employee_id, date, check_in, check_out, work_hours, status, attendance_type, is_late, late_minutes, regular_minutes)
        values (cid, emp.id, d, (d + time '09:00') at time zone 'Asia/Seoul', (d + time '18:00') at time zone 'Asia/Seoul', 8, 'present', 'normal', false, 0, 480)
        on conflict (employee_id, date) do nothing;
      end if;
      d := d + 1;
    end loop;
  end loop;

  -- 사람마다 다른 일이 하나씩 — 한 사람에게 몰리면 화면이 부자연스럽다
  --   이름순 번호: 1 김대표 · 2 박서연 · 3 이준호 · 4 정우성 · 5 최민아 · 6 한지은
  with e as (select id, row_number() over (order by name) n from employees where company_id = cid and status not in ('invited','inactive','resigned')),
       d2 as (select date, row_number() over (order by date) k from (select distinct date from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date) t)
  update attendance_records r set status = 'late', is_late = true, late_minutes = 22, note = '지하철 지연',
         check_in = (r.date + time '09:22') at time zone 'Asia/Seoul', work_hours = 7.6, regular_minutes = 458
    from e, d2 where r.company_id = cid and r.employee_id = e.id and r.date = d2.date and e.n = 3 and d2.k = 2;

  with e as (select id, row_number() over (order by name) n from employees where company_id = cid and status not in ('invited','inactive','resigned')),
       d2 as (select date, row_number() over (order by date) k from (select distinct date from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date) t)
  update attendance_records r set status = 'late', is_late = true, late_minutes = 8, note = '병원 들렀다 출근',
         check_in = (r.date + time '09:08') at time zone 'Asia/Seoul', work_hours = 7.9, regular_minutes = 472
    from e, d2 where r.company_id = cid and r.employee_id = e.id and r.date = d2.date and e.n = 6 and d2.k = 4;

  with e as (select id, row_number() over (order by name) n from employees where company_id = cid and status not in ('invited','inactive','resigned')),
       d2 as (select date, row_number() over (order by date) k from (select distinct date from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date) t)
  update attendance_records r set status = 'remote', attendance_type = 'remote', note = '재택 근무'
    from e, d2 where r.company_id = cid and r.employee_id = e.id and r.date = d2.date and e.n = 2 and d2.k = 3;

  with e as (select id, row_number() over (order by name) n from employees where company_id = cid and status not in ('invited','inactive','resigned')),
       d2 as (select date, row_number() over (order by date) k from (select distinct date from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date) t)
  update attendance_records r set status = 'half_day', work_hours = 4, regular_minutes = 240, note = '오후 반차',
         check_out = (r.date + time '13:30') at time zone 'Asia/Seoul'
    from e, d2 where r.company_id = cid and r.employee_id = e.id and r.date = d2.date and e.n = 5 and d2.k = 3;

  insert into leave_requests (company_id, employee_id, leave_type, start_date, end_date, days, reason, status, approved_at)
  select cid, r.employee_id, 'annual', r.date, r.date, 0.5, '오후 반차', 'approved', now()
    from attendance_records r where r.company_id = cid and r.status = 'half_day' and r.date >= date_trunc('month', current_date)::date;

  -- 연차 하루 — 정우성(4번), 마지막 평일. 그 날 출근 기록은 지운다
  insert into leave_requests (company_id, employee_id, leave_type, start_date, end_date, days, reason, status, approved_at)
  select cid, e.id, 'annual', d2.date, d2.date, 1, '개인 연차', 'approved', now()
    from (select id, row_number() over (order by name) n from employees where company_id = cid and status not in ('invited','inactive','resigned')) e,
         (select date, row_number() over (order by date desc) k from (select distinct date from attendance_records where company_id = cid and date >= date_trunc('month', current_date)::date) t) d2
   where e.n = 4 and d2.k = 1;
  delete from attendance_records r using leave_requests l
   where r.company_id = cid and l.company_id = cid and l.days = 1 and r.employee_id = l.employee_id and r.date = l.start_date;
end $$;
`);
const chk = await sql(`select status, count(*) from attendance_records where company_id = '${COMPANY}' and date >= date_trunc('month', current_date)::date group by status order by 1`);
const lv = await sql(`select leave_type, days, start_date from leave_requests where company_id = '${COMPANY}' and start_date >= date_trunc('month', current_date)::date order by start_date`);
console.log("근태:", JSON.stringify(chk));
console.log("휴가:", JSON.stringify(lv));
