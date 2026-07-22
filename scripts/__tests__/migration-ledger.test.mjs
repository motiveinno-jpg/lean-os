// 마이그레이션 reconcile 회귀 — 거짓 실패(공식엔 있는데 형식달라 pending) / 거짓 성공(어디에도 없는데 통과) 방지.
import { describe, it, expect } from "vitest";
import { reconcile, timestampOf, nameOf } from "../migration-ledger.mjs";

const BOOT = "20260520010000_applied_migrations_ledger";

describe("timestampOf / nameOf", () => {
  it("파일명에서 타임스탬프 프리픽스 추출", () => {
    expect(timestampOf("20260722043006_foo_bar")).toBe("20260722043006");
    expect(timestampOf("nope")).toBe(null);
  });
  it("파일 접미사(=schema_migrations.name) 추출", () => {
    expect(nameOf("20260722160000_project_tasks_completed_at")).toBe("project_tasks_completed_at");
    expect(nameOf("no_timestamp")).toBe("no_timestamp");
  });
});

describe("reconcile — schema_migrations.name(파일 접미사) 매칭", () => {
  it("version(타임스탬프)이 달라도 name(접미사)이 공식 ledger 에 있으면 applied", () => {
    const files = ["20260722160000_project_tasks_completed_at"];
    // Supabase 는 version 을 적용시각으로 기록(파일 타임스탬프와 다름), name 은 접미사.
    const schemaVersions = new Set(["20260722043006"]); // 파일 타임스탬프(20260722160000)와 불일치
    const schemaNames = new Set(["project_tasks_completed_at"]); // 접미사 매칭
    const r = reconcile(files, schemaVersions, new Set(), "20260101000000_x", false, schemaNames);
    expect(r.ok).toBe(true);
    expect(r.pending).toEqual([]);
  });
});

describe("reconcile — 단일 신뢰기준(공식 schema_migrations)", () => {
  const files = [
    "20260520010000_applied_migrations_ledger",
    "20260601120000_a",
    "20260722043006_b",
  ];

  it("거짓 실패 없음: 공식 ledger(타임스탬프)에 있으면 커스텀(파일명)에 없어도 applied", () => {
    const schema = new Set(["20260520010000", "20260601120000", "20260722043006"]);
    const applied = new Set(); // 커스텀 비어도
    const r = reconcile(files, schema, applied, BOOT);
    expect(r.ok).toBe(true);
    expect(r.pending).toEqual([]);
    // 공식엔 있으나 커스텀 미기록 → drift.schema_only 로 보고(정상)
    expect(r.drift.schema_only.length).toBe(3);
  });

  it("거짓 성공 없음: 공식·커스텀 어디에도 없으면 pending", () => {
    const schema = new Set(["20260520010000", "20260601120000"]); // b 없음
    const applied = new Set();
    const r = reconcile(files, schema, applied, BOOT);
    expect(r.ok).toBe(false);
    expect(r.pending).toEqual(["20260722043006_b"]);
  });

  it("커스텀(파일명)만 있어도 applied 로 인정(레거시 보조)", () => {
    const schema = new Set(["20260520010000"]);
    const applied = new Set(["20260601120000_a", "20260722043006_b"]);
    const r = reconcile(files, schema, applied, BOOT);
    expect(r.ok).toBe(true);
  });

  it("커스텀엔 있으나 공식엔 없음 = 충돌 보고(applied_only)", () => {
    const schema = new Set(["20260520010000"]);
    const applied = new Set(["20260601120000_a"]);
    const r = reconcile(["20260520010000_applied_migrations_ledger", "20260601120000_a"], schema, applied, BOOT);
    expect(r.drift.applied_only).toEqual(["20260601120000_a"]);
  });

  it("부트스트랩 이전 파일은 default 검사 제외(베이스라인), strict 면 포함", () => {
    const files2 = ["20260101000000_old", "20260601120000_a"];
    const schema = new Set(["20260601120000"]); // old 없음
    const r = reconcile(files2, schema, new Set(), BOOT);
    expect(r.ok).toBe(true); // old 는 베이스라인 제외
    const rs = reconcile(files2, schema, new Set(), BOOT, true);
    expect(rs.ok).toBe(false); // strict 면 old pending
    expect(rs.pending).toEqual(["20260101000000_old"]);
  });
});
