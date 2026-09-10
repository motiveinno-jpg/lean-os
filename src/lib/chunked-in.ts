// .in() 에 넣는 id 가 수천 개면 URL 상한을 넘는다 — 200개씩 나눠 묻고 합친다
export async function chunkedIn<T>(
  fetchChunk: (ids: string[]) => PromiseLike<T[] | null>,
  ids: string[],
  size = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const part = await fetchChunk(ids.slice(i, i + size));
    if (part) out.push(...part);
  }
  return out;
}
