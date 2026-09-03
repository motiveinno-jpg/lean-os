#!/usr/bin/env node
/**
 * OwnerView — AI 참모용 "화면 지도" 생성기 (2026-09-03)
 *
 * 왜: 참모가 "연차 관리 어디서 해?" 같은 질문에 존재하지 않는 메뉴(인사 > 근태관리 > 휴가관리)를
 *     지어내던 사고(2026-08-20)의 근본 원인은 화면 구조 지식이 손으로 쓴 몇 줄뿐이었기 때문.
 *     사이드바 브레드크럼 사전(route-labels.ts)과 메뉴 도움말(menu-guides.ts)을 그대로
 *     Edge Function 이 읽는 상수로 뽑아 두 소스가 어긋나지 않게 한다.
 *
 * 실행: node scripts/gen-copilot-app-map.mjs   (→ supabase/functions/owner-copilot/app-map.ts 갱신)
 *       두 원본 파일을 고쳤으면 다시 실행해 커밋한다. (CI 검사 없음 — 잊지 말 것)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require(resolve(ROOT, "node_modules/typescript"));

function loadTs(rel) {
  const src = readFileSync(resolve(ROOT, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require });
  return { exports: mod.exports, src };
}

// route-labels.ts 는 ROUTE_LABELS 를 export 하지 않는다 — getRouteCrumb 만 export. 원문에서 경로 키를 뽑아 crumb 을 조회한다.
const rl = loadTs("src/lib/route-labels.ts");
const routeKeys = [...rl.src.matchAll(/^\s*"(\/[^"]*)":\s*\{/gm)].map((m) => m[1]);
const guides = loadTs("src/lib/menu-guides.ts").exports.MENU_GUIDES;

const HIDE_GROUPS = new Set(["운영"]);            // 운영자 전용 화면은 고객에게 안내하지 않는다
const HIDE_ROUTES = new Set(["/onboarding", "/copilot"]);

const lines = [];
const seen = new Set();
for (const path of routeKeys) {
  if (HIDE_ROUTES.has(path) || seen.has(path)) continue;
  seen.add(path);
  const crumb = rl.exports.getRouteCrumb(path);
  if (!crumb || HIDE_GROUPS.has(crumb.group ?? "")) continue;
  // 최장 prefix 매칭으로 도움말을 붙인다(도움말은 화면보다 적다).
  const guide = guides
    .filter((g) => path === g.match || path.startsWith(g.match + "/"))
    .sort((a, b) => b.match.length - a.match.length)[0];
  const head = `${crumb.group ? crumb.group + " › " : ""}${crumb.title}`;
  const desc = (guide && guide.match === path ? guide.tagline : crumb.desc) || (guide ? guide.tagline : "");
  const feats = guide && guide.match === path ? guide.features.slice(0, 5).map((f) => f.name).join("·") : "";
  lines.push(`- ${path} = ${head}${desc ? ` — ${desc}` : ""}${feats ? ` (기능: ${feats})` : ""}`);
}

const out = `// 자동 생성 — 손으로 고치지 말 것. 원본: src/lib/route-labels.ts + src/lib/menu-guides.ts
// 재생성: node scripts/gen-copilot-app-map.mjs   (생성 ${new Date().toISOString().slice(0, 10)})
export const APP_MAP = \`
${lines.join("\n").replace(/`/g, "'").replace(/\$\{/g, "\\${")}
\`;
`;
writeFileSync(resolve(ROOT, "supabase/functions/owner-copilot/app-map.ts"), out);
console.log(`app-map.ts: ${lines.length}개 화면, ${out.length}자`);
