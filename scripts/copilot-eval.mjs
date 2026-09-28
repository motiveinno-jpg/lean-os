#!/usr/bin/env node
/**
 * OwnerView — AI 참모 골든 질문 평가 (2026-08-11 AI 하네스: 평가 단계)
 *
 * 프롬프트·툴을 바꿀 때마다 "감"이 아니라 숫자로 회귀를 잡는다.
 * qa:seed 가 만드는 결정적(deterministic) 회사 데이터를 정답지로 쓰므로,
 * 반드시 `npm run qa:seed` 후에 실행한다. 실제 Claude 를 호출하므로 토큰이 든다
 * (질문 24개 ≈ 수십만 토큰 — 일부만 돌리려면 --only "미수").
 *
 * 실행:
 *   npm run qa:seed && node scripts/copilot-eval.mjs
 *
 * 채점 방식: respond 구조화 응답(JSON 전체 문자열)에 대해
 *   · expect  — 반드시 포함되어야 하는 패턴(전부 만족해야 PASS)
 *   · reject  — 있으면 실패인 패턴(환각·권한 누설 감지)
 * LLM 답변은 비결정적이므로 패턴은 "사실이 맞는지"만 검사할 만큼 느슨하게 유지한다.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const OWNER_EMAIL = "qa-seed-owner@mo-tive.com";
const MEMBER_EMAIL = "qa-seed-member@mo-tive.com";
const PASSWORD = process.env.QA_SEED_PASSWORD;   // 저장소에 적지 않는다
if (!PASSWORD) { console.error("QA_SEED_PASSWORD 환경변수가 필요합니다."); process.exit(1); }

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
if (!PAT) { console.error("❌ SUPABASE_ACCESS_TOKEN 없음"); process.exit(1); }

async function projectKeys() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`api-keys 조회 실패 (${res.status})`);
  const keys = await res.json();
  const anon = keys.find((k) => k.name === "anon" || /anon/.test(k.description || ""));
  if (!anon?.api_key) throw new Error("anon 키를 찾지 못했습니다.");
  return { anon: anon.api_key, service: keys.find((k) => k.name === "service_role")?.api_key ?? null };
}

// 비밀번호 로그인이 막히면(시드 비밀번호가 바뀐 경우) 관리 키로 일회용 매직링크를 만들어 세션을 받는다.
//   비밀번호는 다른 캡처·QA 스크립트도 쓰므로 여기서 바꾸지 않는다.
async function login(keys, email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: keys.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => null);
  if (res.ok) return body.access_token;
  if (!keys.service) throw new Error(`로그인 실패 (${email}): ${res.status} — qa:seed 를 먼저 실행했는지 확인`);
  const link = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: keys.service, Authorization: `Bearer ${keys.service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  }).then((r) => r.json());
  const hash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!hash) throw new Error(`로그인 실패 (${email}): 비밀번호 ${res.status}, 매직링크 생성 실패`);
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: keys.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hash }),
  });
  const vb = await v.json().catch(() => null);
  if (!v.ok || !vb?.access_token) throw new Error(`로그인 실패 (${email}): 매직링크 확인 ${v.status}`);
  console.log(`  (${email}: 비밀번호 로그인 실패 → 매직링크로 로그인)`);
  return vb.access_token;
}

async function ask(keys, jwt, question) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/owner-copilot`, {
    method: "POST",
    headers: { apikey: keys.anon, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`참모 호출 실패 (${res.status}): ${JSON.stringify(body)?.slice(0, 200)}`);
  return body;
}

// ── 정답지 — 실행할 때마다 DB 에서 직접 계산한다 ─────────────────────────────
//   돈 숫자는 화면과 같은 기준 함수(copilot_finance_facts) 값이 정답이다. 참모가 다른 기준으로
//   계산하면(발행 누계를 미수라 하거나, 상위 N건을 더해 합계를 만들면) 숫자가 어긋나 FAIL 이 난다.
//   종전 채점은 '원' 글자만 보면 통과라 숫자가 틀려도 잡지 못했다.
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`정답지 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function loadTruth() {
  const [row] = await sql(`
    with c as (select company_id id from public.users where email = '${OWNER_EMAIL}'),
         m as (select date_trunc('month', (now() at time zone 'Asia/Seoul'))::date ms)
    select c.id,
      public.copilot_finance_facts(c.id) f,
      public.copilot_finance_facts(c.id, to_char((select ms from m) - interval '1 month', 'YYYY-MM')) lf,
      (select count(*) from public.tax_invoices t where t.company_id = c.id and t.type = 'sales'
         and t.status <> 'cancelled' and t.original_invoice_id is null and t.issue_date >= (select ms from m)) sales_cnt,
      (select b.total_days - b.used_days from public.leave_balances b join public.employees e on e.id = b.employee_id
        where b.company_id = c.id and e.name = '정우성'
          and b.year = extract(year from (now() at time zone 'Asia/Seoul'))::int) leave_jung
    from c`);
  if (!row?.id) throw new Error("QA 시드 회사를 찾지 못했습니다 — qa:seed 를 먼저 실행하세요.");
  const f = row.f, lf = row.lf;
  return {
    ar: Number(f.receivables.balance),
    arTop: f.receivables.top_partners?.[0]?.name ?? null,
    arUnposted: Number(f.receivables.unposted_sales_invoices.count),
    ap: Number(f.payables.balance),
    cash: Number(f.cash.total),
    revenue: Number(f.month_pnl.revenue),
    net: Number(f.month_pnl.net_profit),
    unpostedMonth: Object.values(f.month_pnl.unposted_in_month).reduce((s, n) => s + Number(n), 0),
    lastOperating: Number(lf.month_pnl.operating_profit),
    lastTopExpense: lf.month_pnl.top_expense_accounts?.[0]?.name ?? null,
    salesCount: Number(row.sales_cnt),
    leaveJung: row.leave_jung == null ? null : Number(row.leave_jung),
  };
}

// "3억 4,427만 원", "3.44억", "34,426만 8천 원", "344,268,000원" 을 전부 원 단위 숫자로 뽑는다.
function amountsIn(text) {
  const t = text.replace(/\\n/g, " ");
  const num = (x) => Number(String(x).replace(/,/g, ""));
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*억(?:\s*(\d[\d,]*(?:\.\d+)?)\s*만)?(?:\s*(\d[\d,]*)\s*천)?|(\d[\d,]*(?:\.\d+)?)\s*만(?:\s*(\d[\d,]*)\s*천)?|(\d{1,3}(?:,\d{3})+|\d{4,})/g;
  for (const m of t.matchAll(re)) {
    if (m[1]) out.push(num(m[1]) * 1e8 + (m[2] ? num(m[2]) * 1e4 : 0) + (m[3] ? num(m[3]) * 1e3 : 0));
    else if (m[4]) out.push(num(m[4]) * 1e4 + (m[5] ? num(m[5]) * 1e3 : 0));
    else out.push(num(m[6]));
  }
  return out;
}
// 반올림 표기("약 3.4억")를 허용하되 기준이 다른 숫자는 걸러지게 ±2%.
const hasAmount = (text, want) => want === 0
  ? /0\s*원|없습니다|없어요|없음/.test(text)
  : amountsIn(text).some((a) => Math.abs(a - want) <= Math.abs(want) * 0.02);
const fmt = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;

// 되묻거나 못 본다고 넘기는 답 — 툴이 있는 주제에서 나오면 오답.
const DODGE = /확인할 수 없|접근할 수 없|볼 수 없|포함되어 있지 않|이름을 알려주시면|개인별 조회가 필요|직접 확인하셔야/;

// 휴가를 근태 메뉴로 안내하는 답 — "근태 관리 메뉴에서는 안 됩니다" 같은 부정문은 걸리지 않게 '에서 + 하다' 꼴만.
const WRONG_LEAVE_MENU = /근태\s*(관리)?\s*(화면|메뉴)?\s*(에서|로)\s+(처리|등록|하실|관리|할 수|가능|확인)|인사\s*[>›]\s*근태|근태관리\s*[>›]\s*휴가/;

// ── 골든 질문 세트 — QA 시드 회사(4d2157e8…) ──
//   static: 시드에 고정된 사실(직원·연차·메뉴 위치)
//   amount: 정답지 숫자 — 답에 그 금액이 ±2% 로 있어야 PASS
//   from: 모티브 실사용에서 틀렸던 질문이면 그 날짜 (같은 유형 재발 감시)
const CASES = [
  // 사람·근태
  { who: "owner", q: "우리 회사 직원 몇 명이야?", expect: [/6\s*명/], why: "재직 6명" },
  { who: "owner", q: "이준호 어느 부서 소속이야?", expect: [/개발/], reject: [/확인하지 못했|알려주시면/], why: "find_employee — 되묻지 말고 바로" },
  { who: "owner", q: "이번 달 지각한 직원 있어?", expect: [/없|0\s*명|지각/], reject: [DODGE], why: "get_attendance_summary 한 번으로 전원 집계" },
  { who: "owner", q: "저번달에 지각한사람 누구야?", expect: [/지각|없/], reject: [DODGE], from: "08-07", why: "전원 집계 — '이름 알려주면 찾아드림' 금지" },
  { who: "owner", q: "오늘 직원들 근태기록 나타내줘", expect: [/출근|근태/], reject: [DODGE], from: "08-03", why: "회사 전원 오늘 근태 — '개인별 조회 필요' 금지" },
  { who: "owner", q: "정우성 연차 며칠 남았어?", reject: [DODGE, /별도 확인|시스템에서 확인/],
    expectFn: (t) => t.leaveJung == null ? [/연차/] : t.leaveJung >= 0
      ? [new RegExp(`${t.leaveJung}\\s*일`)]
      : [new RegExp(`${Math.abs(t.leaveJung)}\\s*일`), /초과|마이너스|-\s*\d/],
    why: "get_leave_status balances — 부여−사용(음수면 초과 사용이라고 말해야)" },
  { who: "owner", q: "이준호 월급 얼마야?", expect: [/원|급여|월급/], reject: [DODGE], from: "08-07", why: "get_payroll — 급여 없다고 회피 금지" },

  // 돈 — 정답지 숫자와 맞아야 한다
  { who: "owner", q: "현재 미수금이 얼마야", amount: (t) => t.ar, reject: [DODGE], from: "08-04", why: "장부 외상매출금 잔액(재무상태표와 같음)" },
  { who: "owner", q: "받을 돈 총 얼마 남았어?", amount: (t) => t.ar, reject: [DODGE], why: "다른 말로 물어도 같은 숫자여야 — 일관성" },
  { who: "owner", q: "미수금 제일 많은 거래처가 어디야?", expectFn: (t) => t.arTop ? [new RegExp(t.arTop.replace(/[()]/g, "."))] : [], reject: [DODGE], why: "list_receivables top_partners[0]" },
  { who: "owner", q: "외상매입금 얼마야?", amount: (t) => t.ap, reject: [DODGE], why: "장부 외상매입금 잔액" },
  { who: "owner", q: "지금 우리 통장 잔고 얼마야?", amount: (t) => t.cash, reject: [DODGE], why: "경영요약과 같은 현금 합계" },
  { who: "owner", q: "지금 현금흐름 상태를 진단해줘", amount: (t) => t.cash, reject: [/권한이 없|조회할 권한/], from: "09-16", why: "진단에 현금 합계가 정답 숫자로 들어가야 · 대표에게 권한 없다고 하면 안 됨" },
  { who: "owner", q: "지금 우리회사 손익알려줘", amount: (t) => t.revenue, expectFn: (t) => t.unpostedMonth > 0 ? [/전표|미처리/] : [], reject: [DODGE], from: "07-29", why: "이번 달 확정 전표 손익 + 전표 안 친 자료가 있으면 같이 말해야" },
  { who: "owner", q: "지난달 영업이익 얼마야?", amount: (t) => t.lastOperating, reject: [DODGE], why: "get_month_summary pnl — 통장 입출금을 이익이라 하면 틀림" },
  { who: "owner", q: "지난달 비용 어디에 제일 많이 썼어?", expectFn: (t) => t.lastTopExpense ? [new RegExp(t.lastTopExpense)] : [], reject: [DODGE, /통장 이체내역|회계 모듈에 없/], from: "08-12", why: "계정과목 기준으로 답해야(통장 상대방 나열 금지)" },
  { who: "owner", q: "복리후생비 올해 얼마 썼어?", expect: [/복리후생|계정|전표/], reject: [/회계 모듈에 없|분개는 .*없습니다/], from: "08-12", why: "get_expense_by_account" },
  { who: "owner", q: "이번 달 매출 세금계산서 총 몇건이야?", expectFn: (t) => [new RegExp(`${t.salesCount}\\s*건`)], reject: [DODGE], from: "07-29", why: "정상 발행분 건수(수정·취소 제외)" },

  // 거래처·기타
  { who: "owner", q: "우리 거래처 목록 알려줘", expect: [/하늘건설/, /미래테크/], reject: [/조회하지 못했|조회하지 않았/], why: "find_partner" },
  { who: "owner", q: "우리 회사에 연결된 세무사 있어?", expect: [/세무/], reject: [/박세무|거래처 목록|거래처 데이터/], from: "08-12", why: "get_tax_advisors — 거래처를 뒤지지 말 것" },

  // 화면 위치
  { who: "owner", q: "직원 연차 관리는 어디서 해?", expect: [/휴가/, /구성원/], reject: [WRONG_LEAVE_MENU], from: "08-20", why: "구성원 › 휴가 탭" },
  { who: "owner", q: "이 구성원 휴가등록 버튼 어디있는지 알려줘", expect: [/휴가/, /구성원|결재/], reject: [WRONG_LEAVE_MENU], from: "08-07", why: "구성원 › 휴가 탭 '+ 휴가 신청'" },

  // 권한 경계(직원 계정)
  { who: "member", q: "우리 회사 이번 달 매출이랑 현금 잔고 알려줘", expect: [/권한|대표|관리자/], reject: [/[1-9][0-9]{5,}\s*원/], why: "직원은 회사 재무 불가" },
  { who: "member", q: "나 오늘 출근 기록 있어?", expect: [/출근|기록/], reject: [/지각\s*[1-9]|지각했/], why: "본인 근태 — 기록 없음을 지각으로 지어내면 안 됨" },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const cases = only ? CASES.filter((c) => c.q.includes(only)) : CASES;

const keys = await projectKeys();
const truth = await loadTruth();
console.log(`정답지: 미수 ${fmt(truth.ar)} · 미지급 ${fmt(truth.ap)} · 현금 ${fmt(truth.cash)} · 이달 매출 ${fmt(truth.revenue)} · 지난달 영업이익 ${fmt(truth.lastOperating)} · 이달 매출 계산서 ${truth.salesCount}건`);
console.log("로그인 중…");
const tokens = {
  owner: await login(keys, OWNER_EMAIL),
  member: await login(keys, MEMBER_EMAIL),
};

let pass = 0, fail = 0;
const failures = [];
for (const [i, c] of cases.entries()) {
  process.stdout.write(`[${i + 1}/${cases.length}] (${c.who}) ${c.q} … `);
  try {
    const res = await ask(keys, tokens[c.who], c.q);
    const text = JSON.stringify(res.answer ?? res);
    const expect = [...(c.expect ?? []), ...(c.expectFn ? c.expectFn(truth) : [])];
    const missing = expect.filter((re) => !re.test(text)).map(String);
    const hit = (c.reject ?? []).filter((re) => re.test(text)).map(String);
    if (c.amount) {
      const want = c.amount(truth);
      if (!hasAmount(text, want)) missing.push(`금액 ${fmt(want)} (답에 나온 금액: ${amountsIn(text).slice(0, 6).map(fmt).join(", ") || "없음"})`);
    }
    if (missing.length === 0 && hit.length === 0) {
      pass++; console.log("PASS");
    } else {
      fail++; console.log("FAIL");
      failures.push({ case: c, missing, hit, snippet: text.slice(0, 400) });
    }
  } catch (e) {
    fail++; console.log(`ERROR — ${e.message}`);
    failures.push({ case: c, error: e.message });
  }
}

console.log(`\n결과: ${pass}/${cases.length} PASS`);
for (const f of failures) {
  console.log(`\n✗ (${f.case.who}) ${f.case.q} — ${f.case.why}${f.case.from ? ` [실사용 ${f.case.from}]` : ""}`);
  if (f.error) { console.log(`  에러: ${f.error}`); continue; }
  if (f.missing?.length) console.log(`  빠진 것: ${f.missing.join(" · ")}`);
  if (f.hit?.length) console.log(`  금지 패턴 검출: ${f.hit.join(" · ")}`);
  console.log(`  응답 일부: ${f.snippet}`);
}
process.exit(fail ? 1 : 0);
