// 마이그레이션 ledger reconcile — 단일 신뢰기준 정의 + 두 ledger 충돌 보고.
//   순수 함수로 분리(테스트 가능). check-migrations.mjs 가 사용.
//
// 신뢰기준(단일):
//   1차 = Supabase 공식 ledger `supabase_migrations.schema_migrations` (version = 타임스탬프).
//         → 여기 있으면 "실제 실행됨"의 DB 근거(파일명만으로 판정하지 않음).
//   2차 = 커스텀 `public.applied_migrations` (version = 파일명). 레거시 보조.
//   파일이 둘 중 하나라도 있으면 applied 로 간주. 둘 형식이 달라(타임스탬프 vs 파일명)
//   과거엔 reconcile 이 안 돼 거짓 pending 133건이 났음 — 타임스탬프 프리픽스로 정규화해 해소.

/** 파일명(확장자 제거)에서 선행 타임스탬프 프리픽스 추출. 예: "20260722043006_foo" → "20260722043006". */
export function timestampOf(name) {
  const m = String(name).match(/^(\d{8,14})/);
  return m ? m[1] : null;
}

/** 파일명에서 선행 타임스탬프_ 를 제거한 접미사(=Supabase schema_migrations.name). 예: "20260722160000_project_tasks_completed_at" → "project_tasks_completed_at". */
export function nameOf(name) {
  const s = String(name);
  const m = s.match(/^\d{8,14}_(.+)$/);
  return m ? m[1] : s;
}

/**
 * @param {string[]} files            supabase/migrations/*.sql 파일명(확장자 제거)
 * @param {Set<string>} schemaVersions supabase_migrations.schema_migrations.version (적용시각 타임스탬프)
 * @param {Set<string>} appliedVersions public.applied_migrations.version (파일명)
 * @param {string} bootstrap           베이스라인 경계(이 이전 파일은 default 검사 제외)
 * @param {boolean} strict             true 면 bootstrap 이전 파일도 검사
 * @param {Set<string>} schemaNames    supabase_migrations.schema_migrations.name (파일 접미사) — 핵심 매칭키
 *
 * Supabase 는 apply 시 version=적용시각(파일 타임스탬프와 다름), name=파일 접미사 로 기록한다.
 * 따라서 파일↔공식ledger 매칭은 name(접미사)이 1차. version(타임스탬프) 매칭은 CLI 적용분 보조.
 */
export function reconcile(files, schemaVersions, appliedVersions, bootstrap, strict = false, schemaNames = new Set()) {
  // 접미사 매칭은 접미사가 파일들 사이에서 유일할 때만 증거로 인정한다 (2026-08-19 감사):
  //   같은 접미사 파일이 2개면(standard_chart_of_accounts 실사례) ledger 의 name 한 줄이
  //   "어느 쪽이 적용됐는지"를 증명하지 못한다 — 미적용 파일이 초록불로 통과해
  //   회계 계정 매핑이 조용히 어긋나는 조합이 실제 리포에 존재했다.
  const suffixCount = new Map();
  for (const f of files) {
    const nm = nameOf(f);
    suffixCount.set(nm, (suffixCount.get(nm) || 0) + 1);
  }
  const nameMatchOk = (f) => {
    const nm = nameOf(f);
    return suffixCount.get(nm) === 1 && schemaNames.has(nm);
  };
  const isApplied = (f) => {
    const ts = timestampOf(f);
    return nameMatchOk(f) || (ts && schemaVersions.has(ts)) || appliedVersions.has(f);
  };
  const candidates = strict ? files : files.filter((f) => f >= bootstrap);
  const pending = candidates.filter((f) => !isApplied(f));

  const inOfficial = (f) => {
    const ts = timestampOf(f);
    return nameMatchOk(f) || (ts && schemaVersions.has(ts));
  };
  // 충돌/드리프트 리포트: 공식엔 있으나 커스텀 ledger 에만 없음 (반대도).
  const inSchemaNotApplied = candidates.filter((f) => inOfficial(f) && !appliedVersions.has(f));
  const inAppliedNotSchema = candidates.filter((f) => appliedVersions.has(f) && !inOfficial(f));

  return {
    ok: pending.length === 0,
    checked: candidates.length,
    pending,
    drift: {
      schema_only: inSchemaNotApplied, // 실행됐지만 커스텀 ledger 미기록 (정상 — 공식 신뢰)
      applied_only: inAppliedNotSchema, // 커스텀엔 있으나 공식엔 없음 (조사 필요)
    },
  };
}
