// 브라우저 기본 날짜 입력(<input type="date">)이 화면 코드에 들어오면 실패한다.
//   날짜 키보드 입력 해석(연도 4자리·실재 날짜·범위)은 src/components/date-field.tsx 한 곳이 맡는다.
//   기본 입력은 브라우저마다 연도 자릿수·형식이 달라 규칙이 갈라진다. 날짜 칸은 DateField 를 쓴다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../src/", import.meta.url).pathname;
const ALLOW = new Set(["components/date-field.tsx"]);
const hits = [];
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) { if (n !== "__tests__") walk(p); continue; } if (!/\.(tsx|jsx)$/.test(n)) continue; const rel = p.slice(root.length); if (ALLOW.has(rel)) continue; const lines = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n"); lines.forEach((l, i) => { const code = l.replace(/\/\/.*$/, "").replace(/\{?\/\*.*?\*\/\}?/g, ""); if (/<input\b[^>]*\btype\s*=\s*(["']date["']|\{[^}]*["']date["'][^}]*\})/.test(code)) hits.push(`${rel}:${i + 1}`); }); } };
walk(root);
if (hits.length) { console.error(`브라우저 기본 날짜 입력 ${hits.length}곳 — DateField 로 바꿔 주세요:\n  ` + hits.join("\n  ")); process.exit(1); }
console.log("native date input check: 0");
