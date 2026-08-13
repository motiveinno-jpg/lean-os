// 조회 결과를 **자르지 않고 전부** 받아온다 (2026-08-13 사장님 지시)
//
//   지시: "데이터기간 1개월로 늘리면 최근 400건만 받아오는데 전체데이터 받아오게해줘 자르지말고.
//          기간넓히는 의미가 없잖아."
//
//   ★ 실제로 통장은 1개월이 852건이었다 — 절반 넘게 잘려 나가고 있었다.
//     `limit(400)` 은 화면이 느려질까 봐 걸어 둔 것인데, **기간을 넓히는 의미를 없애** 버렸다.
//     표는 어차피 50줄씩 끊어 보여 주므로(Pager) 다 받아 와도 그리는 양은 같다.
//
//   PostgREST 는 한 번에 가져올 수 있는 줄 수가 제한될 수 있어(db-max-rows) **쪽을 나눠 이어 받는다.**
//   무한정 받지는 않는다 — 안전 상한에 닿으면 `capped` 로 알려 주고 화면이 그 사실을 적는다.
//   (조용히 자르면 '이게 전부'로 읽힌다.)

const PAGE = 1000;
const CAP = 20_000;

export type PageFetch<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAllPages<T>(
  page: PageFetch<T>,
  opts?: { size?: number; cap?: number },
): Promise<{ rows: T[]; capped: boolean }> {
  const size = opts?.size ?? PAGE;
  const cap = opts?.cap ?? CAP;
  const rows: T[] = [];
  for (let start = 0; start < cap; start += size) {
    const { data, error } = await page(start, Math.min(start + size, cap) - 1);
    //   ★ 읽기 실패를 빈 목록으로 넘기지 않는다 — '자료가 없다'로 보여 다 끝낸 줄 안다
    if (error) throw error;
    const got = data ?? [];
    rows.push(...got);
    if (got.length < size) return { rows, capped: false };
  }
  return { rows, capped: true };
}
