import { reportError } from './friendly-error';

// ── 대형 select 의 조용한 절단 방지 (2026-07-16) ──
// PostgREST 서버 상한(max_rows=1000)이 limit 미지정은 물론 .limit(2000) 같은 명시 상한까지
// 1000행으로 강제 하향한다. 합계·카운트 집계에 먹이는 쿼리가 이걸 밟으면 숫자가 조용히 틀어짐.
// build() 는 호출마다 새 쿼리 빌더를 반환해야 하며(빌더 재사용 불가), 페이징 안정성을 위해
// 결정적 정렬(마지막에 id 타이브레이커)을 포함해야 한다. maxRows 도달 시 보고 후 절단 반환.
export async function fetchPaged<T = any>(scope: string, build: () => any, maxRows = 20000): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build().range(from, Math.min(from + PAGE, maxRows) - 1);
    if (error) { reportError(`fetchPaged.${scope}`, error); break; }
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  if (out.length >= maxRows) {
    reportError(`fetchPaged.${scope}`, new Error(`fetchPaged maxRows(${maxRows}) 도달 — 초과분 절단`));
  }
  return out;
}

// Promise.all 슬롯 등 기존 `{ data }` 형태 소비처를 최소 diff 로 유지하며 페이징을 적용할 때 사용.
export async function fetchPagedRes<T = any>(scope: string, build: () => any, maxRows = 20000): Promise<{ data: T[] }> {
  return { data: await fetchPaged<T>(scope, build, maxRows) };
}
