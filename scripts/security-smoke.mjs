#!/usr/bin/env node
// 보안 경계 스모크 — 로컬 Supabase(또는 테스트 프로젝트)에 대해 "되어야 할 것"과 "거부돼야 할 것"을 같이 확인한다.
//   대상: 2026-09-09 보안 점검 S01·S02·S03·S04·S06·S07·S10·S13.
//   실행: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/security-smoke.mjs
//   ⚠️ 운영 프로젝트에 돌리지 말 것 — 시험용 회사·계정·직원 행을 만든다(접두사 smoke_).
import { randomUUID } from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!URL_ || !ANON || !SERVICE) { console.error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 필요"); process.exit(2); }
if (/supabase\.co/.test(URL_) && !process.env.SMOKE_ALLOW_REMOTE) { console.error("원격 프로젝트에는 SMOKE_ALLOW_REMOTE=1 없이는 돌리지 않는다"); process.exit(2); }

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); }

async function rest(path, { method = "GET", token = ANON, body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const rpc = (fn, args, opts = {}) => rest(`/rest/v1/rpc/${fn}`, { method: "POST", body: args, ...opts });
const svc = (path, opts = {}) => rest(path, { ...opts, token: SERVICE });
async function insert(table, row) { const r = await svc(`/rest/v1/${table}`, { method: "POST", body: row, headers: { Prefer: "return=representation" } }); if (r.status >= 300) throw new Error(`insert ${table}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); return Array.isArray(r.json) ? r.json[0] : r.json; }
async function createUser(email, password) {
  const r = await svc(`/auth/v1/admin/users`, { method: "POST", body: { email, password, email_confirm: true } });
  if (r.status >= 300) throw new Error(`createUser ${email}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.id;
}
async function login(email, password) {
  const r = await rest(`/auth/v1/token?grant_type=password`, { method: "POST", body: { email, password } });
  if (r.status >= 300) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.access_token;
}
const isDenied = (r) => r.status === 401 || r.status === 403 || r.status === 404 || (r.status >= 400 && /permission denied|forbidden|unauthenticated|42501|서버를 통해서만|읽기 전용|권한이 없습니다/i.test(JSON.stringify(r.json)));

const tag = randomUUID().slice(0, 8);
const pw = "Smoke!2026pass";
const ids = {};

async function setup() {
  const coA = await insert("companies", { name: `smoke_A_${tag}` });
  const coB = await insert("companies", { name: `smoke_B_${tag}` });
  ids.coA = coA.id; ids.coB = coB.id;
  const mk = async (label, company, role, extra = {}) => {
    const email = `smoke_${label}_${tag}@example.test`;
    const authId = await createUser(email, pw);
    const u = await insert("users", { id: authId, auth_id: authId, email, name: label, company_id: company, role, ...extra });
    const emp = await insert("employees", { company_id: company, user_id: authId, name: label, email, hire_date: "2025-01-02", status: "joined" });
    return { email, authId, userId: u.id, empId: emp.id };
  };
  ids.ownerA = await mk("ownerA", ids.coA, "owner", { is_master: true });
  ids.staffA = await mk("staffA", ids.coA, "employee");
  ids.ownerB = await mk("ownerB", ids.coB, "owner", { is_master: true });
  ids.tok = { ownerA: await login(ids.ownerA.email, pw), staffA: await login(ids.staffA.email, pw), ownerB: await login(ids.ownerB.email, pw) };
  // 세무사(읽기 전용) — A 회사에 연결
  const advEmail = `smoke_advisor_${tag}@example.test`; const advAuth = await createUser(advEmail, pw);
  const adv = await insert("tax_advisors", { auth_id: advAuth, name: "smoke advisor", email: advEmail, status: "active" });
  await insert("advisor_company_links", { advisor_id: adv.id, company_id: ids.coA, status: "active" });
  await insert("advisor_active_company", { auth_id: advAuth, company_id: ids.coA });
  ids.advisor = { email: advEmail, authId: advAuth }; ids.tok.advisor = await login(advEmail, pw);
  // 근태 기록(B 직원) · 가입 요청(A) · 서명 요청(A)
  ids.attB = await insert("attendance_records", { company_id: ids.coB, employee_id: ids.ownerB.empId, date: "2026-09-01", check_in: "2026-09-01T00:30:00Z", status: "present" });
  const reqEmail = `smoke_req_${tag}@example.test`; const reqAuth = await createUser(reqEmail, pw);
  await insert("users", { id: reqAuth, auth_id: reqAuth, email: reqEmail, name: "req", company_id: null, role: "employee" });
  ids.join = await insert("company_join_requests", { company_id: ids.coA, requester_auth_id: reqAuth, requester_email: reqEmail, requester_name: "req", status: "pending" });
  ids.signToken = `smoke_${randomUUID().replace(/-/g, "")}`;
  ids.sig = await insert("signature_requests", { company_id: ids.coA, title: "smoke 계약", signer_name: "을", signer_email: "smoke-signer@example.com", status: "sent", sign_token: ids.signToken, template_snapshot_html: '<p>계약 {{?텍스트:비고}}</p><span class="sig-box" data-role="을"></span>', created_by: ids.ownerA.userId });
}

async function tests() {
  // S01 — 익명·일반 로그인은 실행 불가, 서버만 가능(승인자 사칭 불가)
  record("S01 익명 rpc resolve_company_join_request 거부", isDenied(await rpc("resolve_company_join_request", { p_request_id: ids.join.id, p_action: "reject", p_role: "employee", p_reason: null, p_resolver_user_id: ids.ownerA.userId })));
  record("S01 로그인(대표) 직접 rpc 거부", isDenied(await rpc("resolve_company_join_request", { p_request_id: ids.join.id, p_action: "reject", p_role: "employee", p_reason: null, p_resolver_user_id: ids.ownerA.userId }, { token: ids.tok.ownerA })));
  const r01 = await rpc("resolve_company_join_request", { p_request_id: ids.join.id, p_action: "reject", p_role: "employee", p_reason: "smoke", p_resolver_user_id: ids.ownerB.userId }, { token: SERVICE });
  record("S01 서버 호출이라도 타사 관리자를 승인자로 지정하면 거부", r01.status === 200 && r01.json?.error === "forbidden_other_company", JSON.stringify(r01.json));
  const r01b = await rpc("resolve_company_join_request", { p_request_id: ids.join.id, p_action: "reject", p_role: "employee", p_reason: "smoke", p_resolver_user_id: ids.ownerA.userId }, { token: SERVICE });
  record("S01 서버 + 자사 관리자 → 정상 처리", r01b.status === 200 && r01b.json?.ok === true, JSON.stringify(r01b.json));

  // S02 — 전 회사 근태 재계산은 서버만
  record("S02 익명 recalculate_late_status_recent 거부", isDenied(await rpc("recalculate_late_status_recent", { p_days: 7, p_company_id: null })));
  record("S02 로그인(대표) recalculate 거부", isDenied(await rpc("recalculate_late_status_recent", { p_days: 7, p_company_id: null }, { token: ids.tok.ownerA })));
  const r02 = await rpc("recalculate_late_status_recent", { p_days: 7, p_company_id: ids.coB }, { token: SERVICE });
  record("S02 서버 호출은 정상", r02.status === 200, JSON.stringify(r02.json).slice(0, 120));
  record("S02 기간 상한(366일) 초과 거부", isDenied(await rpc("recalculate_late_status_recent", { p_days: 4000, p_company_id: ids.coB }, { token: SERVICE })) || (await rpc("recalculate_late_status_recent", { p_days: 4000, p_company_id: ids.coB }, { token: SERVICE })).status >= 400);

  // S03 — 타사 근태
  record("S03 A 대표가 B 직원 근태 판정 거부", isDenied(await rpc("mark_attendance_late", { p_employee_id: ids.ownerB.empId, p_date: "2026-09-01", p_is_late: true, p_late_minutes: 5 }, { token: ids.tok.ownerA })));
  const r03 = await rpc("mark_attendance_late", { p_employee_id: ids.ownerB.empId, p_date: "2026-09-01", p_is_late: true, p_late_minutes: 5 }, { token: ids.tok.ownerB });
  record("S03 B 대표가 자기 회사 직원 근태 판정 정상", r03.status === 200, JSON.stringify(r03.json));
  record("S03 익명 거부", isDenied(await rpc("mark_attendance_late", { p_employee_id: ids.ownerB.empId, p_date: "2026-09-01", p_is_late: true, p_late_minutes: 5 })));

  // S04 — 서명 제출은 서버만 · 원문 해시 대조
  record("S04 익명 submit_signature_by_token 거부", isDenied(await rpc("submit_signature_by_token", { p_token: ids.signToken, p_signature_data: { type: "type", data: "x" }, p_signed_contract_html: "<p>바꿔치기</p>" })));
  record("S04 익명 save_signer_inputs_by_token 거부", isDenied(await rpc("save_signer_inputs_by_token", { p_token: ids.signToken, p_inputs: { a: "b" } })));
  const bad = await rpc("submit_signature_by_token", { p_token: ids.signToken, p_signature_data: { type: "type", data: "x" }, p_signed_contract_html: "<p>x</p>", p_snapshot_sha256: "0".repeat(64) }, { token: SERVICE });
  record("S04 서버라도 원문 해시가 다르면 거부", bad.status >= 400 && /원문이 보관본과/.test(JSON.stringify(bad.json)), JSON.stringify(bad.json).slice(0, 100));
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update('<p>계약 {{?텍스트:비고}}</p><span class="sig-box" data-role="을"></span>').digest("hex");
  const good = await rpc("submit_signature_by_token", { p_token: ids.signToken, p_signature_data: { type: "type", data: "홍길동" }, p_signed_contract_html: "<p>서버 합성본</p>", p_signature_method: "type", p_ip: "203.0.113.5", p_snapshot_sha256: hash, p_user_agent: "smoke" }, { token: SERVICE });
  record("S04 서버 + 올바른 해시 → 서명 완료", good.status === 200 && good.json?.ok === true, JSON.stringify(good.json));
  const sigRow = await svc(`/rest/v1/signature_requests?id=eq.${ids.sig.id}&select=status,snapshot_sha256,signed_sha256,ip_address`);
  record("S04 해시·서버 IP 보관", sigRow.json?.[0]?.status === "signed" && sigRow.json?.[0]?.snapshot_sha256 === hash && !!sigRow.json?.[0]?.signed_sha256 && sigRow.json?.[0]?.ip_address === "203.0.113.5", JSON.stringify(sigRow.json?.[0]));

  // S06 — 세무사 읽기 전용
  const advSel = await rest(`/rest/v1/employees?select=id&limit=1`, { token: ids.tok.advisor });
  record("S06 세무사는 A 회사 직원을 읽을 수 있다(읽기 정상)", advSel.status === 200, `status ${advSel.status}`);
  const advIns = await rest(`/rest/v1/tax_deadline_checks`, { method: "POST", token: ids.tok.advisor, body: { company_id: ids.coA, check_key: `smoke_${tag}`, checked: true } });
  record("S06 세무사 tax_deadline_checks 쓰기 거부", advIns.status >= 400, `status ${advIns.status} ${JSON.stringify(advIns.json).slice(0, 80)}`);
  const advUp = await fetch(`${URL_}/storage/v1/object/employee-files/${ids.coA}/smoke_${tag}.txt`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.advisor}`, "Content-Type": "text/plain" }, body: "x" });
  record("S06 세무사 Storage 업로드 거부", advUp.status >= 400, `status ${advUp.status}`);
  const ownUp = await fetch(`${URL_}/storage/v1/object/employee-files/${ids.coA}/smoke_${tag}.txt`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.ownerA}`, "Content-Type": "text/plain" }, body: "x" });
  record("S06 대표 Storage 업로드 정상", ownUp.status < 300, `status ${ownUp.status} ${(await ownUp.text()).slice(0, 80)}`);
  const staffDel = await fetch(`${URL_}/storage/v1/object/employee-files/${ids.coA}/smoke_${tag}.txt`, { method: "DELETE", headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.staffA}` } });
  const stillThere = await svc(`/rest/v1/rpc/storage_object_company`, { method: "POST", body: { bucket: "employee-files", object_name: `${ids.coA}/smoke_${tag}.txt` } });
  const objRow = await fetch(`${URL_}/storage/v1/object/info/authenticated/employee-files/${ids.coA}/smoke_${tag}.txt`, { headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.ownerA}` } });
  record("S06 권한 없는 직원의 남의 파일 삭제 거부(파일 유지)", objRow.status === 200, `delete ${staffDel.status}, info ${objRow.status}`);
  const advDel = await fetch(`${URL_}/storage/v1/object/employee-files/${ids.coA}/smoke_${tag}.txt`, { method: "DELETE", headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.advisor}` } });
  const objRow2 = await fetch(`${URL_}/storage/v1/object/info/authenticated/employee-files/${ids.coA}/smoke_${tag}.txt`, { headers: { apikey: ANON, Authorization: `Bearer ${ids.tok.ownerA}` } });
  record("S06 세무사 파일 삭제 거부(파일 유지)", objRow2.status === 200, `delete ${advDel.status}, info ${objRow2.status}`);

  // S10 — 타사 집계 노출
  const r10 = await rpc("get_monthly_issue_usage", { p_company_id: ids.coB }, { token: ids.tok.ownerA });
  record("S10 타사 발행량 조회 → 0 또는 거부", isDenied(r10) || (r10.status === 200 && JSON.stringify(r10.json).includes('"total_count":0')), JSON.stringify(r10.json).slice(0, 100));
  record("S10 익명 ai_cost_used_this_month 거부", isDenied(await rpc("ai_cost_used_this_month", { p_company_id: ids.coB })));
  record("S10 타사 storage_quota_params 거부", isDenied(await rpc("storage_quota_params", { p_company: ids.coB }, { token: ids.tok.ownerA })));
  const r10b = await rpc("leave_used_from_requests", { p_employee: ids.ownerB.empId, p_year: 2026 }, { token: ids.tok.ownerA });
  record("S10 타사 직원 연차 사용량 → 0 또는 거부", isDenied(r10b) || r10b.json === 0 || r10b.json === "0", JSON.stringify(r10b.json));

  // S13 — 원가 재생성 권한
  record("S13 권한 없는 직원 rebuild_my_stock_costs 거부", isDenied(await rpc("rebuild_my_stock_costs", {}, { token: ids.tok.staffA })));
  record("S13 세무사 make_my_cogs_voucher_draft 거부", isDenied(await rpc("make_my_cogs_voucher_draft", { p_from: "2026-09-01", p_to: "2026-09-30" }, { token: ids.tok.advisor })));
  const r13 = await rpc("rebuild_my_stock_costs", {}, { token: ids.tok.ownerA });
  record("S13 대표는 원가 재계산 실행 가능(권한 검사 통과)", !isDenied(r13), `status ${r13.status} ${JSON.stringify(r13.json).slice(0, 80)}`);

  // 트리거는 PUBLIC 회수 뒤에도 돈다 — 대표가 근태를 넣으면 판정 트리거가 status 를 채운다
  const trg = await rest(`/rest/v1/attendance_records`, { method: "POST", token: ids.tok.ownerA, headers: { Prefer: "return=representation" }, body: { company_id: ids.coA, employee_id: ids.ownerA.empId, date: "2026-09-02", check_in: "2026-09-02T02:30:00Z" } });
  record("트리거(근태 판정) 정상 동작", trg.status < 300 && !!trg.json?.[0]?.status, `status ${trg.status} ${JSON.stringify(trg.json?.[0]?.status)}`);

  // S07 — 데이터 API 에도 IP 제한
  await svc(`/rest/v1/company_settings`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { company_id: ids.coA, settings: { ip_restriction: { enabled: true, ips: ["198.51.100.9"] } } } });
  const gateBlocked = await rest(`/rest/v1/employees?select=id&limit=1`, { token: ids.tok.staffA, headers: { "cf-connecting-ip": "203.0.113.7" } });
  record("S07 회사 IP 제한 밖에서의 데이터 API 요청 거부", gateBlocked.status === 403 && /session_gate:ip/.test(JSON.stringify(gateBlocked.json)), `status ${gateBlocked.status} ${JSON.stringify(gateBlocked.json).slice(0, 80)}`);
  const gateOk = await rest(`/rest/v1/employees?select=id&limit=1`, { token: ids.tok.staffA, headers: { "cf-connecting-ip": "198.51.100.9" } });
  record("S07 허용 IP 에서는 정상", gateOk.status === 200, `status ${gateOk.status}`);
  const gateMaster = await rest(`/rest/v1/employees?select=id&limit=1`, { token: ids.tok.ownerA, headers: { "cf-connecting-ip": "203.0.113.7" } });
  record("S07 마스터 계정은 IP 제한을 받지 않는다", gateMaster.status === 200, `status ${gateMaster.status}`);
  const gateOther = await rest(`/rest/v1/employees?select=id&limit=1`, { token: ids.tok.ownerB, headers: { "cf-connecting-ip": "203.0.113.7" } });
  record("S07 제한 없는 회사는 영향 없음", gateOther.status === 200, `status ${gateOther.status}`);
  await svc(`/rest/v1/company_settings?company_id=eq.${ids.coA}`, { method: "PATCH", body: { settings: { ip_restriction: { enabled: false, ips: [] } } } });
  const staffOld = ids.tok.staffA; const staffNew = await login(ids.staffA.email, pw);
  await rpc("session_gate", { p_ip: "127.0.0.1" }, { token: staffNew });   // 미들웨어가 페이지 진입 때 하는 세션 등록
  const dupNew = await rest(`/rest/v1/employees?select=id&limit=1`, { token: staffNew });
  const dupOld = await rest(`/rest/v1/employees?select=id&limit=1`, { token: staffOld });
  record("S07 나중 로그인이 이기고 옛 세션의 데이터 API 는 거부", dupNew.status === 200 && dupOld.status === 403, `new ${dupNew.status}, old ${dupOld.status} ${JSON.stringify(dupOld.json).slice(0, 60)}`);
}

try { await setup(); await tests(); } catch (e) { console.error("SMOKE ERROR:", e.message); process.exitCode = 2; }
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exitCode = 1;
