// 작업일지/릴리즈 로그 자동 생성 (2026-07-28)
//   배경: 운영자 시스템 화면의 작업일지가 하드코딩 상수라 3월 12일에서 멈춰 있었다.
//   빌드 때마다 git 커밋 로그를 파싱해 JSON 으로 떨어뜨린다 — 배포가 곧 최신화.
//   Vercel 빌드 환경에도 .git 이 있어 그대로 동작(얕은 클론이어도 최근 커밋은 포함).
//
//   출력: src/generated/release-log.json  (초기 1회 커밋해 두고, 빌드 시 덮어씀 —
//   로컬 `npm run build` 후 이 파일 diff 는 커밋하지 않아도 된다)
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "generated", "release-log.json");

const TYPE_LABEL = {
  feat: "기능", fix: "수정", hotfix: "긴급수정", security: "보안", perf: "성능",
  refactor: "개선", style: "다듬기", copy: "문구", docs: "문서", chore: "정비", test: "테스트",
};

let entries = [];
try {
  const raw = execSync(
    "git log --no-merges -80 --date=format:'%Y-%m-%d' --pretty=format:'%h%x09%ad%x09%s'",
    { cwd: root, encoding: "utf8" },
  );
  entries = raw.split("\n").filter(Boolean).map((line) => {
    const [hash, date, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    // conventional commit 파싱: type(scope): 제목
    const m = subject.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/);
    const type = m ? m[1].toLowerCase() : "chore";
    return {
      hash,
      date,
      type,
      label: TYPE_LABEL[type] || "기타",
      scope: m?.[2] || null,
      title: m ? m[3] : subject,
    };
  });
} catch (e) {
  console.warn("[release-log] git log 실패 — 기존 JSON 유지:", e?.message);
  process.exit(0); // 빌드를 막지 않는다
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), entries }, null, 2));
console.log(`[release-log] ${entries.length}건 생성 → src/generated/release-log.json`);
