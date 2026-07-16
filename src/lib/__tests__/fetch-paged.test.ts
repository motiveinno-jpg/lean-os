import { describe, it, expect, vi } from 'vitest';

vi.mock('../friendly-error', () => ({ reportError: vi.fn() }));

import { fetchPaged, fetchPagedRes } from '../fetch-paged';
import { reportError } from '../friendly-error';

// PostgREST 페이지 응답을 흉내내는 빌더 팩토리 — range(from,to) 를 받아 rows 슬라이스 반환
function mockBuilder(rows: unknown[], errorAtPage?: number) {
  let call = 0;
  return () => ({
    range: (from: number, to: number) => {
      const page = call++;
      if (errorAtPage !== undefined && page === errorAtPage) {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      }
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  });
}

const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('fetchPaged', () => {
  it('1000행 미만은 한 페이지로 끝난다', async () => {
    const out = await fetchPaged('t', mockBuilder(makeRows(37)));
    expect(out).toHaveLength(37);
  });

  it('1000행 경계를 넘어 전량 수집한다 (서버 max_rows 절단 복원)', async () => {
    const out = await fetchPaged('t', mockBuilder(makeRows(2912)));
    expect(out).toHaveLength(2912);
    expect(out[2911]).toEqual({ id: 2911 });
  });

  it('정확히 페이지 배수(2000행)여도 종료한다', async () => {
    const out = await fetchPaged('t', mockBuilder(makeRows(2000)));
    expect(out).toHaveLength(2000);
  });

  it('maxRows 도달 시 절단하고 reportError 로 보고한다', async () => {
    vi.mocked(reportError).mockClear();
    const out = await fetchPaged('t', mockBuilder(makeRows(5000)), 2000);
    expect(out).toHaveLength(2000);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('중간 페이지 에러 시 보고 후 그때까지 수집분을 반환한다', async () => {
    vi.mocked(reportError).mockClear();
    const out = await fetchPaged('t', mockBuilder(makeRows(3000), 1));
    expect(out).toHaveLength(1000); // page0 성공, page1 에러
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('fetchPagedRes 는 { data } 형태로 감싼다 (기존 소비처 호환)', async () => {
    const res = await fetchPagedRes('t', mockBuilder(makeRows(3)));
    expect(res.data).toHaveLength(3);
  });
});
