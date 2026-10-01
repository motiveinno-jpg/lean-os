import { parseNotice, ProcurementError, safeUrl } from "./validation";
import type { Notice } from "./types";

/** 나라장터 용역 공고 검색 어댑터. 실제 승인 키로 명세·정정/취소 응답 검증 후 활성화한다. */
export const G2B_ENDPOINT =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch";
export function kstTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m)
    throw new ProcurementError(
      "나라장터 일시 형식이 변경되었습니다. 원본 응답 확인이 필요합니다.",
      502,
    );
  const stamp = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}+09:00`;
  const d = new Date(stamp);
  if (
    !Number.isFinite(d.getTime()) ||
    new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 19) !==
      stamp.slice(0, 19)
  )
    throw new ProcurementError("나라장터 일시 값이 유효하지 않습니다.", 502);
  return d.toISOString();
}
function money(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).replaceAll(",", "");
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)))
    throw new ProcurementError("나라장터 예산 형식을 확인해야 합니다.", 502);
  return Number(s);
}
export function normalizeG2b(item: Record<string, unknown>): Notice {
  const attachments: Notice["attachments"] = [];
  for (let i = 1; i <= 10; i++) {
    const url = item[`ntceSpecDocUrl${i}`];
    if (url)
      attachments.push({
        name: String(item[`ntceSpecFileNm${i}`] || `공고 첨부 ${i}`),
        url: safeUrl(url)!,
      });
  }
  return parseNotice({
    noticeNo: item.bidNtceNo,
    revision: String(item.bidNtceOrd ?? "000"),
    title: item.bidNtceNm,
    agency: String(item.dminsttNm || item.ntceInsttNm || "발주기관 확인 필요"),
    publishedAt: kstTimestamp(item.bidNtceDt),
    deadline: kstTimestamp(item.bidClseDt),
    budget: money(item.asignBdgtAmt),
    url: item.bidNtceDtlUrl || null,
    status: /취소/.test(String(item.bidNtceKindNm || ""))
      ? "cancelled"
      : "open",
    // API 목록은 전문이 아니다. 첨부를 모두 확보·검토하기 전에는 평가 확정 불가.
    documents: [],
    attachments,
  });
}
export function parseG2bResponse(value: unknown): {
  items: Record<string, unknown>[];
  total: number;
} {
  const root = value as {
    response?: {
      header?: { resultCode?: string | number };
      body?: { items?: unknown; totalCount?: unknown };
    };
  };
  const response = root?.response;
  if (
    !response?.header ||
    !["00", "0"].includes(String(response.header.resultCode))
  )
    throw new ProcurementError(
      "나라장터 API가 오류를 반환했습니다. 승인 상태·호출량·명세를 확인하세요.",
      502,
    );
  const body = response.body;
  if (!body || !/^\d+$/.test(String(body.totalCount)))
    throw new ProcurementError(
      "나라장터 응답의 총 건수를 확인할 수 없습니다.",
      502,
    );
  let items: unknown = body.items;
  if (items && typeof items === "object" && !Array.isArray(items))
    items = (items as { item?: unknown }).item;
  if (items === "" || items === undefined || items === null) items = [];
  if (!Array.isArray(items)) items = [items];
  if (
    (items as unknown[]).some(
      (i) => !i || typeof i !== "object" || Array.isArray(i),
    )
  )
    throw new ProcurementError(
      "나라장터 공고 목록 형식을 확인해야 합니다.",
      502,
    );
  return {
    items: items as Record<string, unknown>[],
    total: Number(body.totalCount),
  };
}
export function queryTime(date: Date): string {
  return new Date(date.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace(/[-T:]/g, "");
}
export async function fetchG2bNotices(
  keywords: string[],
  key: string,
  now = new Date(),
  fetcher = fetch,
): Promise<Notice[]> {
  if (!key.trim())
    throw new ProcurementError("나라장터 API 키가 설정되지 않았습니다.", 503);
  const began = new Date(now.getTime() - 7 * 86400000);
  const out = new Map<string, Notice>();
  const started = Date.now();
  let calls = 0;
  for (const keyword of keywords) {
    let seen = 0;
    for (let page = 1; ; page++) {
      if (++calls > 20 || Date.now() - started > 35000)
        throw new ProcurementError(
          "수집 범위가 한 번의 처리 한도를 넘었습니다. 검색어·기간을 나누어 전체 수집을 완료해야 합니다.",
          502,
        );
      const url = new URL(G2B_ENDPOINT);
      url.search = new URLSearchParams({
        serviceKey: key,
        type: "json",
        pageNo: String(page),
        numOfRows: "100",
        inqryDiv: "1",
        inqryBgnDt: queryTime(began),
        inqryEndDt: queryTime(now),
        bidNtceNm: keyword,
      }).toString();
      let parsed: ReturnType<typeof parseG2bResponse>;
      try {
        const res = await fetcher(url, {
          signal: AbortSignal.timeout(
            Math.min(20000, Math.max(1000, 40000 - (Date.now() - started))),
          ),
          cache: "no-store",
          redirect: "error",
        });
        if (!res.ok)
          throw new ProcurementError("나라장터 API 연결에 실패했습니다.", 502);
        parsed = parseG2bResponse(await res.json());
      } catch (e) {
        if (e instanceof ProcurementError) throw e;
        throw new ProcurementError(
          "나라장터 응답을 읽지 못했습니다. 재시도하거나 연결 설정을 확인하세요.",
          502,
        );
      }
      if (
        seen + parsed.items.length < parsed.total &&
        parsed.items.length === 0
      )
        throw new ProcurementError(
          "나라장터 목록이 중간에 끊겼습니다. 전체 수집을 완료하지 못했습니다.",
          502,
        );
      for (const item of parsed.items) {
        const n = normalizeG2b(item);
        out.set(`${n.noticeNo}:${n.revision}`, n);
      }
      seen += parsed.items.length;
      if (seen >= parsed.total) break;
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      a.noticeNo.localeCompare(b.noticeNo) ||
      a.revision.localeCompare(b.revision),
  );
}
