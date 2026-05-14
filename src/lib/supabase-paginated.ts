/**
 * Supabase PostgREST `db-max-rows` 1000 제약 우회 — range 페이지네이션.
 *
 * .limit(50000) 같이 큰 값을 명시해도 서버가 1000건으로 잘라버리는 케이스가 있어
 * 큰 테이블(bank_transactions, card_transactions, tax_invoices 등) 전수 조회 시
 * 1000건씩 .range() 로 나눠 호출하고 누적.
 *
 * 사용:
 *   const rows = await fetchAllPaginated<MyRow>((from, to) =>
 *     supabase.from('bank_transactions').select('...').eq(...).range(from, to)
 *   );
 */
export async function fetchAllPaginated<T = any>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // 안전 가드 — 200,000건 이상이면 중단
  for (let i = 0; i < 200; i++) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
