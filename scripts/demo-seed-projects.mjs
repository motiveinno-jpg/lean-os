#!/usr/bin/env node
/**
 * OwnerView — 시연 회사(오너뷰)의 **프로젝트 보드** 시드 (2026-08-20 소개서 캡처용)
 *
 *   소개서 15번 장표("일마다 맞는 화면")가 템플릿 8종 · 회의→할 일 · 매출 파이프라인 ·
 *   계약 만기 네 조각을 각각 캡처해 쓴다. 그 화면을 시연 데이터로 찍기 위한 시드.
 *   칸 구성은 src/lib/project-boards.ts 의 템플릿 정의와 같은 모양으로 맞췄다.
 *
 * 실행: node scripts/demo-seed-projects.mjs        (두 번 돌려도 같은 결과 — 기존 보드 지우고 다시)
 * ⚠️ prod DB 변경 — 두 PC 동시 DB 작업 금지.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
function readPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const raw = readFileSync(resolve(REPO_ROOT, ".env.supabase.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(?:SUPABASE_ACCESS_TOKEN\s*=\s*)?(.+)$/);
    if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const PAT = readPat();
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`SQL 실패 (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  return Array.isArray(body) ? body : [];
}
const J = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const C = { gray: "#C4C4C4", indigo: "#748FFC", blue: "#4DABF7", purple: "#9775FA", green: "#51CF66", orange: "#F59F00", red: "#FF6B6B" };
const FLOW = (options) => ({ options, flow: true });

/** 템플릿 정의 — lib/project-boards.ts 와 같은 칸 구성 */
const TEMPLATES = {
  todo: {
    name: "할 일 · 진행", nameLabel: "작업",
    columns: [
      { name: "상태", type: "status", settings: FLOW([{ id: "todo", label: "할 일", color: C.indigo }, { id: "doing", label: "진행 중", color: C.orange }, { id: "done", label: "완료", color: C.green }]) },
      { name: "담당", type: "person" }, { name: "마감", type: "date" },
      { name: "우선순위", type: "status", settings: { options: [{ id: "high", label: "높음", color: C.red }, { id: "mid", label: "보통", color: C.indigo }, { id: "low", label: "낮음", color: C.blue }] } },
    ],
    groups: [{ name: "할 일 목록", color: C.indigo }],
  },
  meeting: {
    name: "회의 · 결정", nameLabel: "안건",
    columns: [
      { name: "상태", type: "status", settings: FLOW([{ id: "open", label: "논의 중", color: C.gray }, { id: "decided", label: "결정", color: C.indigo }, { id: "hold", label: "보류", color: C.red }, { id: "done", label: "완료", color: C.green }]) },
      { name: "회의일", type: "date" }, { name: "결정 내용", type: "text" }, { name: "담당", type: "person" }, { name: "기한", type: "date" },
    ],
    groups: [{ name: "이번 회의", color: C.indigo }, { name: "8/13 주간회의", color: C.blue }],
  },
  revenue: {
    name: "매출 흐름", nameLabel: "건",
    columns: [
      { name: "단계", type: "status", settings: FLOW([{ id: "review", label: "검토", color: C.gray }, { id: "proposal", label: "제안", color: C.indigo }, { id: "contract", label: "계약", color: C.blue }, { id: "issued", label: "발행", color: C.purple }, { id: "paid", label: "입금", color: C.green }]) },
      { name: "거래처", type: "partner" }, { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "입금", type: "number", settings: { unit: "원" } }, { name: "예정일", type: "date" },
      { name: "담당", type: "person" }, { name: "비고", type: "text" },
    ],
    groups: [{ name: "매출 목록", color: C.indigo }],
  },
  contract: {
    name: "계약 · 갱신", nameLabel: "계약",
    columns: [
      { name: "상태", type: "status", settings: FLOW([{ id: "review", label: "검토", color: C.gray }, { id: "signed", label: "체결", color: C.indigo }, { id: "running", label: "이행 중", color: C.blue }, { id: "renew", label: "갱신 예정", color: C.orange }, { id: "closed", label: "종료", color: C.green }]) },
      { name: "거래처", type: "partner" }, { name: "계약금액", type: "number", settings: { unit: "원" } },
      { name: "시작", type: "date" }, { name: "만기", type: "date" }, { name: "담당", type: "person" }, { name: "비고", type: "text" },
    ],
    groups: [{ name: "계약 목록", color: C.indigo }],
  },
  spend: {
    name: "예산 · 지출", nameLabel: "항목",
    columns: [
      { name: "구분", type: "status", settings: { options: [{ id: "out", label: "외주", color: C.indigo }, { id: "buy", label: "구매", color: C.blue }, { id: "ad", label: "광고", color: C.purple }, { id: "etc", label: "기타", color: C.gray }] } },
      { name: "거래처", type: "partner" }, { name: "예산", type: "number", settings: { unit: "원" } },
      { name: "집행", type: "number", settings: { unit: "원" } }, { name: "결제일", type: "date" }, { name: "담당", type: "person" },
    ],
    groups: [{ name: "지출 목록", color: C.indigo }],
  },
};

const D = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

async function main() {
  const [{ id: cid }] = await sql(`select c.id from companies c join users u on u.company_id=c.id where u.email='demo-ov-owner@mo-tive.com' limit 1;`);
  const users = await sql(`select id, name from users where company_id='${cid}';`);
  const partners = await sql(`select id, name from partners where company_id='${cid}' order by name;`);
  const pid = (n) => partners.find((p) => p.name === n)?.id || partners[0]?.id;
  const uid = (n) => users.find((u) => u.name === n)?.id || users[0]?.id;
  console.log(`회사 ${cid} · 구성원 ${users.length} · 거래처 ${partners.length}`);

  // 기존 시드 프로젝트 정리 (멱등)
  await sql(`
    do $$ declare d uuid;
    begin
      for d in select id from deals where company_id='${cid}' loop
        delete from project_board_items where board_id in (select id from project_boards where deal_id=d);
        delete from project_board_columns where board_id in (select id from project_boards where deal_id=d);
        delete from project_board_groups where board_id in (select id from project_boards where deal_id=d);
        delete from project_boards where deal_id=d;
        delete from deals where id=d;
      end loop;
    end $$;`);

  // 프로젝트(딜) 3건 — 목록 화면이 비어 보이지 않게
  const deals = [
    { name: "브랜드몰 리뉴얼", total: 68000000, partner: "가온컴퍼니", start: D(-40), end: D(50) },
    { name: "정기 유지보수 계약", total: 24000000, partner: "나린테크", start: D(-120), end: D(240) },
    { name: "신규 서비스 런칭", total: 45000000, partner: "다온커머스", start: D(-15), end: D(75) },
  ];
  const dealIds = [];
  for (const d of deals) {
    const [row] = await sql(`insert into deals (company_id, name, contract_total, status, start_date, end_date, partner_id)
      values ('${cid}','${d.name}', ${d.total}, 'active', '${d.start}', '${d.end}', '${pid(d.partner)}') returning id;`);
    dealIds.push(row.id);
  }
  const mainDeal = dealIds[0];
  console.log("프로젝트 3건 생성");

  // 메인 프로젝트에 보드 5종
  const boardIds = {};
  let pos = 0;
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const [b] = await sql(`insert into project_boards (company_id, deal_id, name, template_key, position, name_label)
      values ('${cid}','${mainDeal}','${t.name}','${key}', ${pos++}, '${t.nameLabel}') returning id;`);
    boardIds[key] = b.id;
    let cp = 0;
    for (const c of t.columns) {
      await sql(`insert into project_board_columns (board_id, name, type, settings, position)
        values ('${b.id}','${c.name}','${c.type}', ${J(c.settings || {})}, ${cp++});`);
    }
    let gp = 0;
    for (const g of t.groups) {
      await sql(`insert into project_board_groups (board_id, name, color, position) values ('${b.id}','${g.name}','${g.color}', ${gp++});`);
    }
  }
  console.log("보드 5종 생성");

  const colsOf = async (bid) => sql(`select id, name, type from project_board_columns where board_id='${bid}' order by position;`);
  const groupsOf = async (bid) => sql(`select id, name from project_board_groups where board_id='${bid}' order by position;`);
  const addItem = async (bid, gid, name, values, position) =>
    sql(`insert into project_board_items (board_id, group_id, name, values, position) values ('${bid}','${gid}','${name.replace(/'/g, "''")}', ${J(values)}, ${position});`);

  // ── 할 일 ──
  {
    const cols = await colsOf(boardIds.todo); const [g] = await groupsOf(boardIds.todo);
    const c = (n) => cols.find((x) => x.name === n).id;
    const rows = [
      ["상세페이지 시안 검토", "doing", "한도윤", D(3), "high"],
      ["결제 모듈 연동 테스트", "todo", "임하준", D(6), "high"],
      ["상품 데이터 1차 업로드", "doing", "강유진", D(2), "mid"],
      ["배송 정책 문구 확정", "todo", "오채원", D(8), "mid"],
      ["오픈 이벤트 기획안", "todo", "문시현", D(11), "low"],
      ["관리자 계정 권한 정리", "done", "서지우", D(-2), "mid"],
    ];
    let i = 0;
    for (const [n, st, who, due, pr] of rows) {
      await addItem(boardIds.todo, g.id, n, { [c("상태")]: st, [c("담당")]: uid(who), [c("마감")]: due, [c("우선순위")]: pr }, i++);
    }
  }
  // ── 회의 · 결정 ──
  {
    const cols = await colsOf(boardIds.meeting); const gs = await groupsOf(boardIds.meeting);
    const c = (n) => cols.find((x) => x.name === n).id;
    const rows = [
      ["브랜드몰 오픈일 확정", "decided", D(0), "9/15 오픈 · 사전예약 8/25 시작", "서지우", D(5)],
      ["결제대행사 선정", "decided", D(0), "수수료·정산주기 비교 후 A사로 결정. 계약은 이번 주 발송.", "노아린", D(3)],
      ["상세페이지 촬영 일정", "open", D(0), "스튜디오 3곳 견적 비교 중 — 이동거리·장비 포함 여부 확인 필요", "한도윤", D(7)],
      ["CS 응대 매뉴얼 담당", "open", D(0), "초안은 오채원 · 검수는 서지우", "오채원", D(9)],
    ];
    let i = 0;
    for (const [n, st, md, txt, who, due] of rows) {
      await addItem(boardIds.meeting, gs[0].id, n, { [c("상태")]: st, [c("회의일")]: md, [c("결정 내용")]: txt, [c("담당")]: uid(who), [c("기한")]: due }, i++);
    }
    await addItem(boardIds.meeting, gs[1].id, "물류 위탁 범위 합의", { [c("상태")]: "done", [c("회의일")]: D(-7), [c("결정 내용")]: "포장까지 위탁, 반품은 자체 처리", [c("담당")]: uid("강유진") }, 0);
  }
  // ── 매출 흐름 ──
  {
    const cols = await colsOf(boardIds.revenue); const [g] = await groupsOf(boardIds.revenue);
    const c = (n) => cols.find((x) => x.name === n).id;
    const rows = [
      ["브랜드몰 구축 3차(중도금)", "issued", "가온컴퍼니", 18000000, 0, D(8), "서지우", ""],
      ["정기 리포트 구독(6개월)", "paid", "나린테크", 3600000, 3600000, D(-3), "노아린", "자동 갱신"],
      ["상세페이지 추가 제작", "proposal", "다온커머스", 4500000, 0, D(14), "한도윤", ""],
      ["오픈 기념 라이브커머스", "contract", "라온디자인", 5500000, 2000000, D(20), "문시현", "잔금 오픈 후"],
      ["인플루언서 캠페인 대행", "review", "마루소프트", 7200000, 0, D(26), "오채원", ""],
      ["유지보수 연장(1년)", "paid", "바로랩스", 12000000, 12000000, D(-12), "서지우", ""],
    ];
    let i = 0;
    for (const [n, st, pn, amt, paid, due, who, memo] of rows) {
      await addItem(boardIds.revenue, g.id, n, { [c("단계")]: st, [c("거래처")]: pid(pn), [c("금액")]: amt, [c("입금")]: paid, [c("예정일")]: due, [c("담당")]: uid(who), [c("비고")]: memo }, i++);
    }
  }
  // ── 계약 · 갱신 ──
  {
    const cols = await colsOf(boardIds.contract); const [g] = await groupsOf(boardIds.contract);
    const c = (n) => cols.find((x) => x.name === n).id;
    const rows = [
      ["서버 호스팅", "renew", "누리클라우드", 2400000, D(-350), D(15), "임하준", "1년 선결제 시 10% 할인"],
      ["쇼핑몰 솔루션 라이선스", "renew", "미르시스템", 3600000, D(-330), D(35), "임하준", "연 단위 · 자동갱신 아님"],
      ["사무실 임대차", "running", "터전건설", 36000000, D(-540), D(190), "노아린", "자동갱신"],
      ["물류 위탁 계약", "running", "도담물류", 12000000, D(-80), D(285), "강유진", "3개월 전 통보"],
      ["디자인 외주 계약", "signed", "라온디자인", 15000000, D(-30), D(60), "한도윤", "산출물 인수 후 잔금"],
      ["유지보수 계약(구)", "closed", "미르시스템", 4800000, D(-720), D(-20), "임하준", "만기 지남 — 갱신 협의 필요"],
    ];
    let i = 0;
    for (const [n, st, pn, amt, from, to, who, memo] of rows) {
      await addItem(boardIds.contract, g.id, n, { [c("상태")]: st, [c("거래처")]: pid(pn), [c("계약금액")]: amt, [c("시작")]: from, [c("만기")]: to, [c("담당")]: uid(who), [c("비고")]: memo }, i++);
    }
  }
  // ── 예산 · 지출 ──
  {
    const cols = await colsOf(boardIds.spend); const [g] = await groupsOf(boardIds.spend);
    const c = (n) => cols.find((x) => x.name === n).id;
    const rows = [
      ["상세페이지 촬영", "out", "여울광고", 9000000, 8500000, D(-9), "한도윤"],
      ["촬영 소품 구매", "buy", "모아소재", 2000000, 1720000, D(-4), "오채원"],
      ["패키지 디자인 인쇄", "buy", "로하스인쇄", 3500000, 3180000, D(-6), "강유진"],
      ["네이버 검색광고", "ad", "여울광고", 6000000, 2780000, D(-1), "문시현"],
      ["인스타 광고", "ad", "여울광고", 4000000, 1250000, D(-1), "문시현"],
      ["법무 자문(약관 검토)", "etc", "윤슬컨설팅", 1500000, 1200000, D(-12), "노아린"],
      ["오픈 이벤트 경품", "buy", "바다상사", 5000000, 0, D(12), "오채원"],
    ];
    let i = 0;
    for (const [n, kind, pn, plan, real, day, who] of rows) {
      await addItem(boardIds.spend, g.id, n, { [c("구분")]: kind, [c("거래처")]: pid(pn), [c("예산")]: plan, [c("집행")]: real, [c("결제일")]: day, [c("담당")]: uid(who) }, i++);
    }
  }

  const [n] = await sql(`select
    (select count(*) from deals where company_id='${cid}') deals,
    (select count(*) from project_boards where company_id='${cid}') boards,
    (select count(*) from project_board_items i join project_boards b on b.id=i.board_id where b.company_id='${cid}') items;`);
  console.log("✅ 프로젝트 시딩 완료:", n);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
