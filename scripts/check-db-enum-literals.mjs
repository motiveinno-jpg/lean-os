#!/usr/bin/env node
// DB CHECK 제약(허용값 목록)과 코드가 보내는 문자열 리터럴을 전수 대조한다.
//
// 왜: 역할 폐지(20260911) 때 앱은 employee_invitations.role 에 'member' 를 넣기 시작했는데
//   DB 제약은 ('employee','admin') 그대로여서 직원 초대가 전부 400 으로 거절됐다.
//   같은 모양의 사고가 marketing_events.event, employee_rrn_access_log.action 에서도 있었다.
//   값 어휘가 앱과 DB 두 곳에 따로 살아 있는 한 사람 눈으로는 못 막는다 — 기계가 대조한다.
//
// 무엇을 본다:
//   1) 운영 DB 의 public 스키마 CHECK 제약 중 "컬럼 = 값 목록" 꼴 전부 (pg_constraint)
//   2) 앱·엣지 함수 코드의 `.from("표").insert|upsert|update({ 컬럼: '값' })` 리터럴
//   3) DB 함수(pg_proc) 본문의 `insert into 표 (…) values ('값', …)` / `update 표 set 컬럼 = '값'` 리터럴
//   허용값 밖의 리터럴이 하나라도 있으면 실패(exit 1). preflight 에서 돈다.
//
// 못 보는 것: 변수로 넘어오는 값(`role: form.role`), jsonb 안의 값, RPC 파라미터.
//   그런 값은 각 화면의 select 옵션이 곧 어휘이므로 별도 테스트로 잡는다.
//
// 사용:
//   node scripts/check-db-enum-literals.mjs            # 운영 DB 에서 제약을 읽어 대조
//   node scripts/check-db-enum-literals.mjs --json     # 기계용 출력
//   특정 줄을 일부러 예외로 두려면 그 줄 끝에 `// db-enum-ok` 를 단다(사유 필수).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";

// ─────────────────────────────── DB 제약 읽기 ───────────────────────────────

export const CONSTRAINT_SQL = `
select c.relname as tbl, con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and con.contype = 'c'
order by 1, 2;`;

export const FUNCTION_SQL = `
select p.proname as name, p.prosrc as src
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
   or n.nspname = 'public' and p.prolang = (select oid from pg_language where lanname = 'sql')
order by 1;`;

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

async function query(pat, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

/**
 * pg_get_constraintdef 출력에서 "컬럼 = 허용값 목록" 을 뽑는다.
 * 다루는 꼴:
 *   CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))
 *   CHECK ((col = 'a'::text))
 *   CHECK (((col IS NULL) OR (col = ANY (ARRAY[...]))))
 *   CHECK (((col = ANY (ARRAY[...])) OR (col ~~ 'custom\_%'::text)))   → LIKE 는 prefix 허용
 * 그 외(두 컬럼 관계식, 숫자 배열 등)는 건너뛴다 — 값 어휘 제약이 아니다.
 * @returns {{ column: string, values: Set<string>, likes: RegExp[] } | null}
 */
export function parseCheckDef(def) {
  const body = def.replace(/^CHECK\s*\(/, "").replace(/\)\s*$/, "");
  const anyRe = /\(?\s*(\w+)\s*=\s*ANY\s*\(\s*ARRAY\[((?:'(?:[^']|'')*'::text\s*,?\s*)+)\]\s*\)\s*\)?/g;
  const eqRe = /\(\s*(\w+)\s*=\s*'((?:[^']|'')*)'::text\s*\)/g;
  const likeRe = /\(\s*(\w+)\s*~~\s*'((?:[^']|'')*)'::text\s*\)/g;
  const nullRe = /\(\s*(\w+)\s+IS\s+NULL\s*\)/g;

  let column = null;
  const values = new Set();
  const likes = [];
  let consumed = body;

  for (const m of body.matchAll(anyRe)) {
    if (column && column !== m[1]) return null;
    column = m[1];
    for (const v of m[2].matchAll(/'((?:[^']|'')*)'::text/g)) values.add(v[1].replace(/''/g, "'"));
    consumed = consumed.replace(m[0], " ");
  }
  for (const m of body.matchAll(eqRe)) {
    if (column && column !== m[1]) return null;
    column = m[1];
    values.add(m[2].replace(/''/g, "'"));
    consumed = consumed.replace(m[0], " ");
  }
  for (const m of body.matchAll(likeRe)) {
    if (column && column !== m[1]) return null;
    column = m[1];
    const pat = m[2].replace(/''/g, "'");
    likes.push(new RegExp("^" + pat.replace(/[.*+?^${}()|[\]]/g, "\\$&").replace(/\\_/g, "_").replace(/%/g, ".*") + "$"));
    consumed = consumed.replace(m[0], " ");
  }
  for (const m of body.matchAll(nullRe)) {
    if (column && column !== m[1]) return null;
    consumed = consumed.replace(m[0], " ");
  }
  if (!column || (values.size === 0 && likes.length === 0)) return null;
  // 남은 게 괄호·OR·공백뿐이어야 "값 어휘 제약" 이다. 다른 식이 섞이면 건너뛴다.
  if (/[^\s()]|(?<![A-Z])AND/.test(consumed.replace(/\bOR\b/g, "").replace(/\s+/g, " ").trim())) return null;
  return { column, values, likes };
}

/** @returns {Map<string, Map<string, {values:Set<string>, likes:RegExp[], conname:string}>>} 표 → 컬럼 → 허용값 */
export function buildAllowMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const parsed = parseCheckDef(r.def);
    if (!parsed) continue;
    if (!map.has(r.tbl)) map.set(r.tbl, new Map());
    const cols = map.get(r.tbl);
    const prev = cols.get(parsed.column);
    if (prev) {
      // 같은 컬럼에 제약이 둘이면 교집합만 통과한다 — 둘 다 만족해야 하니까.
      const inter = new Set([...prev.values].filter((v) => parsed.values.has(v)));
      cols.set(parsed.column, { values: inter, likes: [...prev.likes, ...parsed.likes], conname: prev.conname + "+" + r.conname });
    } else {
      cols.set(parsed.column, { values: parsed.values, likes: parsed.likes, conname: r.conname });
    }
  }
  return map;
}

function allowed(rule, value) {
  return rule.values.has(value) || rule.likes.some((re) => re.test(value));
}

// ─────────────────────────────── 코드 리터럴 스캔 ───────────────────────────────

/** 문자열·주석·템플릿을 건너뛰며 `open` 위치의 괄호와 짝이 맞는 닫는 괄호 위치를 돌려준다. */
function matchBracket(text, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [pairs[text[open]]];
  let i = open + 1;
  while (i < text.length && stack.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i); if (i < 0) return -1; i += 2; continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return stack.length ? -1 : i - 1;
}

function skipString(text, i) {
  const q = text[i];
  i++;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (q === "`" && text[i] === "$" && text[i + 1] === "{") { const e = matchBracket(text, i + 1); if (e < 0) return text.length; i = e + 1; continue; }
    if (text[i] === q) return i + 1;
    i++;
  }
  return i;
}

/**
 * 객체 리터럴 `{ ... }` 텍스트에서 1단계 `key: value` 쌍을 뽑는다.
 * @returns {{ key: string, value: string, offset: number }[]}
 */
export function topLevelPairs(objText) {
  const out = [];
  let i = 1; // '{' 다음
  const end = objText.length - 1;
  while (i < end) {
    // key 찾기
    const m = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:(['"])?([\w$]+)\1|\[[^\]]+\])\s*(\?)?\s*:/.exec(objText.slice(i, end));
    if (!m) {
      // 스프레드·단축 속성 등 — 다음 1단계 쉼표까지 건너뛴다
      const skipTo = nextTopComma(objText, i, end);
      if (skipTo < 0) break;
      i = skipTo + 1;
      continue;
    }
    const key = m[2] || null;
    const valueStart = i + m[0].length;
    const comma = nextTopComma(objText, valueStart, end);
    const valueEnd = comma < 0 ? end : comma;
    if (key) out.push({ key, value: objText.slice(valueStart, valueEnd).trim(), offset: valueStart });
    if (comma < 0) break;
    i = comma + 1;
  }
  return out;
}

function nextTopComma(text, from, end) {
  let i = from;
  while (i < end) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(text, i); continue; }
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i); if (i < 0) return -1; i += 2; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { const e = matchBracket(text, i); if (e < 0) return -1; i = e + 1; continue; }
    if (ch === ",") return i;
    i++;
  }
  return -1;
}

/**
 * 값 식에서 "이 컬럼에 실제로 들어갈 수 있는" 문자열 리터럴만 고른다.
 * 따옴표 리터럴·삼항·`||`·`??` 의 가지는 본다. 함수 호출 인자·괄호 안·템플릿·배열은 안 본다
 * (그 리터럴은 컬럼 값이 아니라 다른 것의 입력이다).
 */
export function candidateLiterals(valueExpr) {
  const out = [];
  // 삼항 `cond ? a : b` 에서 cond 안의 리터럴(`x === 'high'`)은 컬럼 값이 아니다.
  //   `?` 를 만나면 그 앞에 모아 둔 리터럴을 버리고, `:` 를 만나면 가지를 확정한다.
  let pending = [];
  let i = 0;
  const t = valueExpr;
  while (i < t.length) {
    const ch = t[i];
    if (ch === "'" || ch === '"') {
      const e = skipString(t, i);
      const raw = t.slice(i + 1, e - 1);
      pending.push(raw.replace(/\\(['"\\])/g, "$1"));
      i = e;
      continue;
    }
    if (ch === "`") { i = skipString(t, i); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { const e = matchBracket(t, i); if (e < 0) break; i = e + 1; continue; }
    if (ch === "?" && (t[i + 1] === "?" || t[i + 1] === ".")) { i += 2; continue; }   // `??` `?.` 는 삼항이 아니다
    if (ch === "?") { pending = []; i++; continue; }
    if (ch === ":") { out.push(...pending); pending = []; i++; continue; }
    if (ch === "=" && (t[i + 1] === "=")) {
      // `a === 'x'` 같은 비교식이 삼항 없이 값 자리에 오면 boolean 이다 — 리터럴은 값이 아니다
      pending = [];
      i += t[i + 2] === "=" ? 3 : 2;
      // 비교 대상 리터럴도 버린다
      const e = /^\s*(['"])(?:[^\\]|\\.)*?\1/.exec(t.slice(i));
      if (e) i += e[0].length;
      continue;
    }
    i++;
  }
  out.push(...pending);
  return out;
}

const CALL_RE = /\.from\(\s*(['"`])([\w.]+)\1\s*\)/g;

/**
 * 한 파일에서 `.from("표").insert|upsert|update(...)` 의 1단계 리터럴을 모은다.
 * @returns {{ table: string, column: string, value: string, line: number, op: string }[]}
 */
export function scanSource(text) {
  const found = [];
  for (const m of text.matchAll(CALL_RE)) {
    const table = m[2];
    let cursor = m.index + m[0].length;
    // .from("t") 뒤에 바로 오는 체인만 본다 (.select 로 시작하면 읽기)
    const chain = /^\s*\.(insert|upsert|update)\s*\(/.exec(text.slice(cursor, cursor + 200));
    if (!chain) continue;
    const open = cursor + chain[0].length - 1;
    const close = matchBracket(text, open);
    if (close < 0) continue;
    const args = text.slice(open + 1, close);
    // 첫 인자만: 객체 또는 객체 배열
    const objs = [];
    const first = args.trimStart();
    const firstOffset = open + 1 + (args.length - first.length);
    if (first.startsWith("{")) {
      const e = matchBracket(text, firstOffset);
      if (e > 0) objs.push({ text: text.slice(firstOffset, e + 1), offset: firstOffset });
    } else if (first.startsWith("[")) {
      const e = matchBracket(text, firstOffset);
      if (e > 0) {
        const inner = text.slice(firstOffset + 1, e);
        let j = 0;
        while (j < inner.length) {
          const k = inner.indexOf("{", j);
          if (k < 0) break;
          const oe = matchBracket(inner, k);
          if (oe < 0) break;
          objs.push({ text: inner.slice(k, oe + 1), offset: firstOffset + 1 + k });
          j = oe + 1;
        }
      }
    }
    for (const o of objs) {
      for (const p of topLevelPairs(o.text)) {
        const abs = o.offset + p.offset;
        const lineStart = text.lastIndexOf("\n", abs) + 1;
        const lineEnd = text.indexOf("\n", abs);
        const lineText = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
        if (/\/\/\s*db-enum-ok\b/.test(lineText)) continue;
        const line = text.slice(0, abs).split("\n").length;
        for (const v of candidateLiterals(p.value)) found.push({ table, column: p.key, value: v, line, op: chain[1] });
      }
    }
  }
  return found;
}

// ─────────────────────────────── DB 함수 본문 스캔 ───────────────────────────────

/**
 * plpgsql/sql 본문의 `insert into 표 (a, b) values ('x', …)` 와 `update 표 set a = 'x'` 리터럴.
 * 여러 values 묶음·select 형 insert·jsonb 는 건너뛴다.
 */
export function scanSqlBody(src) {
  const found = [];
  const clean = src.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const insRe = /insert\s+into\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s*values\s*\(/gi;
  for (const m of clean.matchAll(insRe)) {
    const table = m[1];
    const cols = m[2].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const open = m.index + m[0].length - 1;
    const close = matchSqlParen(clean, open);
    if (close < 0) continue;
    const vals = splitSqlTop(clean.slice(open + 1, close));
    if (vals.length !== cols.length) continue;
    vals.forEach((v, idx) => {
      const lit = /^'((?:[^']|'')*)'(?:::\w+)?$/.exec(v.trim());
      if (lit) found.push({ table, column: cols[idx], value: lit[1].replace(/''/g, "'"), line: lineOf(clean, m.index), op: "insert" });
    });
  }
  const updRe = /update\s+(?:public\.)?(\w+)\s+set\s+([\s\S]*?)(?:\s+where\b|\s+returning\b|;)/gi;
  for (const m of clean.matchAll(updRe)) {
    const table = m[1];
    for (const part of splitSqlTop(m[2])) {
      const a = /^\s*"?(\w+)"?\s*=\s*'((?:[^']|'')*)'(?:::\w+)?\s*$/.exec(part);
      if (a) found.push({ table, column: a[1], value: a[2].replace(/''/g, "'"), line: lineOf(clean, m.index), op: "update" });
    }
  }
  return found;
}

function matchSqlParen(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") { i = text.indexOf("'", i + 1); if (i < 0) return -1; i++; while (text[i] === "'") { i = text.indexOf("'", i + 1) + 1; } continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

function splitSqlTop(s) {
  const out = [];
  let depth = 0, cur = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") { const e = s.indexOf("'", i + 1); const seg = s.slice(i, e < 0 ? s.length : e + 1); cur += seg; i += seg.length; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function lineOf(text, idx) { return text.slice(0, idx).split("\n").length; }

// ─────────────────────────────── 파일 수집·대조 ───────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name === "node_modules" || name === ".next" || name === "__tests__") continue; walk(p, out); }
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name) && !p.endsWith("types/database.ts")) out.push(p);
  }
  return out;
}

export function checkFindings(findings, allow) {
  const bad = [];
  for (const f of findings) {
    const cols = allow.get(f.table);
    if (!cols) continue;
    const rule = cols.get(f.column);
    if (!rule) continue;
    if (!allowed(rule, f.value)) bad.push({ ...f, allowed: [...rule.values], conname: rule.conname });
  }
  return bad;
}

async function main() {
  const json = process.argv.includes("--json");
  const pat = readPat();
  if (!pat) {
    console.error("No PAT (set SUPABASE_ACCESS_TOKEN or .env.supabase.local).");
    process.exitCode = 2;
    return;
  }
  const rows = await query(pat, CONSTRAINT_SQL);
  const allow = buildAllowMap(rows);
  const ruleCount = [...allow.values()].reduce((n, m) => n + m.size, 0);

  const files = [...walk(resolve(REPO_ROOT, "src")), ...walk(resolve(REPO_ROOT, "supabase/functions"))];
  const bad = [];
  let literalCount = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes(".from(")) continue;
    const found = scanSource(text);
    literalCount += found.length;
    for (const b of checkFindings(found, allow)) bad.push({ where: relative(REPO_ROOT, f) + ":" + b.line, ...b });
  }

  const fns = await query(pat, FUNCTION_SQL);
  for (const fn of fns) {
    const found = scanSqlBody(fn.src || "");
    literalCount += found.length;
    for (const b of checkFindings(found, allow)) bad.push({ where: `db function ${fn.name} (line ${b.line})`, ...b });
  }

  if (json) { console.log(JSON.stringify({ rules: ruleCount, literals: literalCount, violations: bad }, null, 2)); }
  else {
    console.log(`CHECK 허용값 규칙 ${ruleCount}개 · 대조한 리터럴 ${literalCount}개`);
    if (bad.length === 0) console.log("✅ 코드가 보내는 값이 모두 DB 허용값 안에 있습니다.");
    else {
      console.log(`❌ DB 가 거부할 값 ${bad.length}건:`);
      for (const b of bad) console.log(`   - ${b.where}  ${b.table}.${b.column} = '${b.value}'  (허용: ${b.allowed.join(", ")}) [${b.conname}]`);
      console.log("\n고치는 법: 값을 바꿨으면 CHECK 제약을 같이 바꾸는 마이그레이션을 내고, DB 가 맞으면 코드를 고친다. 둘 다 아니면 사유를 달아 `// db-enum-ok`.");
    }
  }
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message || e); process.exitCode = 2; });
}
