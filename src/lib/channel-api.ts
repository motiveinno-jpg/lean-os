// ── 채널(스마트스토어·쿠팡) 주문 API — 서버 전용 (2026-08-26 사장님 지시) ─────────
//   브라우저에서 부르지 않는다: 두 채널 모두 CORS 가 막고, 키 평문은 서버 밖으로 나가지 않는다.
//
//   ★ 키는 회사가 직접 발급받아 회사 설정 › 연동·API 키에 넣는다(2026-08-21 규칙). 한 칸에 넣도록
//     구분자(:)로 붙인 꼴을 받는다 — 스마트스토어 `클라이언트ID:클라이언트시크릿`,
//     쿠팡 `액세스키:시크릿키:업체코드`. 칸을 셋으로 늘리면 키 저장·암호화 구조를 다 바꿔야 한다.
//   ★ 두 API 모두 **키 없이는 호출해 볼 수 없다.** 아래는 공식 문서(커머스API 센터·쿠팡 윙 OpenAPI)
//     규격대로 썼고, 첫 회사 키가 들어오면 test-key 로 실제 응답을 보고 다듬는다.
//
//   돌려주는 꼴은 채널에 상관없이 하나다 — 격자에 그대로 깔린다.

import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";

export type ChannelOrderRow = {
  channel_order_no: string;
  channel_product_id: string;
  product_name: string | null;
  qty: number;
  unit_price: number | null;
  order_date: string | null;   // YYYY-MM-DD
  buyer_name: string | null;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ── 스마트스토어 (네이버 커머스API) ──────────────────────────────────────────
const NAVER = "https://api.commerce.naver.com/external";

/** 토큰 — client_secret_sign = base64(bcrypt(`${clientId}_${timestamp}`, secret)). 시크릿이 bcrypt salt 꼴이다. */
export async function naverToken(key: string): Promise<string> {
  const [clientId, secret] = key.split(":").map((s) => s.trim());
  if (!clientId || !secret) throw new Error("스마트스토어 키는 `클라이언트ID:클라이언트시크릿` 꼴로 넣어야 합니다.");
  const timestamp = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${timestamp}`, secret)).toString("base64");
  const body = new URLSearchParams({
    client_id: clientId, timestamp: String(timestamp), client_secret_sign: sign,
    grant_type: "client_credentials", type: "SELF",
  });
  const res = await fetch(`${NAVER}/v1/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({})) as { access_token?: string; message?: string; code?: string };
  if (!res.ok || !j.access_token) throw new Error(`네이버 응답: ${j.message || j.code || res.status}`);
  return j.access_token;
}

/** 결제 완료(PAYED) 주문을 기간으로 받는다 — 변경일 조회는 24시간 단위라 하루씩 돈다. */
export async function naverOrders(key: string, from: string, to: string): Promise<ChannelOrderRow[]> {
  const token = await naverToken(key);
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ids: string[] = [];
  const start = new Date(`${from}T00:00:00+09:00`), end = new Date(`${to}T23:59:59+09:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const q = new URLSearchParams({ lastChangedFrom: d.toISOString(), lastChangedType: "PAYED" });
    const res = await fetch(`${NAVER}/v1/pay-order/seller/product-orders/last-changed-statuses?${q}`, { headers: h, signal: AbortSignal.timeout(20_000) });
    const j = await res.json().catch(() => ({})) as { data?: { lastChangeStatuses?: { productOrderId: string }[] }; message?: string };
    if (!res.ok) throw new Error(`네이버 응답: ${j.message || res.status}`);
    for (const s of j.data?.lastChangeStatuses || []) ids.push(s.productOrderId);
  }
  const out: ChannelOrderRow[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const res = await fetch(`${NAVER}/v1/pay-order/seller/product-orders/query`, {
      method: "POST", headers: h, body: JSON.stringify({ productOrderIds: ids.slice(i, i + 300) }), signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => ({})) as { data?: any[]; message?: string };
    if (!res.ok) throw new Error(`네이버 응답: ${j.message || res.status}`);
    for (const row of j.data || []) {
      const po = row.productOrder || {}, od = row.order || {};
      out.push({
        channel_order_no: String(od.orderId || po.productOrderId || ""),
        //   판매자 관리코드(옵션 → 상품)가 있으면 그것이 SKU 에 가장 가깝다. 없으면 채널 상품번호.
        channel_product_id: String(po.optionManageCode || po.sellerManagementCode || po.productId || ""),
        product_name: [po.productName, po.productOption].filter(Boolean).join(" / ") || null,
        qty: Number(po.quantity || 0),
        unit_price: po.unitPrice != null ? Number(po.unitPrice) : null,
        order_date: od.orderDate ? ymd(new Date(od.orderDate)) : null,
        buyer_name: od.ordererName || null,
      });
    }
  }
  return out;
}

// ── 쿠팡 (윙 OpenAPI) ─────────────────────────────────────────────────────────
const COUPANG = "https://api-gateway.coupang.com";

function coupangAuth(accessKey: string, secretKey: string, method: string, path: string, query: string) {
  //   signed-date 는 yyMMdd'T'HHmmss'Z' (UTC). 서명 문자열 = 날짜 + 메서드 + 경로 + 쿼리(물음표 없이)
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const signedDate = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const signature = createHmac("sha256", secretKey).update(signedDate + method + path + query).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

export async function coupangOrders(key: string, from: string, to: string, status = "ACCEPT"): Promise<ChannelOrderRow[]> {
  const [accessKey, secretKey, vendorId] = key.split(":").map((s) => s.trim());
  if (!accessKey || !secretKey || !vendorId) throw new Error("쿠팡 키는 `액세스키:시크릿키:업체코드` 꼴로 넣어야 합니다.");
  const path = `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`;
  const out: ChannelOrderRow[] = [];
  let nextToken = "";
  do {
    const query = new URLSearchParams({ createdAtFrom: from, createdAtTo: to, status, maxPerPage: "50", ...(nextToken ? { nextToken } : {}) }).toString();
    const res = await fetch(`${COUPANG}${path}?${query}`, {
      headers: { Authorization: coupangAuth(accessKey, secretKey, "GET", path, query), "Content-Type": "application/json;charset=UTF-8" },
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json().catch(() => ({})) as { code?: string; message?: string; data?: any[]; nextToken?: string };
    if (!res.ok || (j.code && j.code !== "200")) throw new Error(`쿠팡 응답: ${j.message || res.status}`);
    for (const o of j.data || []) {
      for (const it of o.orderItems || []) {
        out.push({
          channel_order_no: String(o.orderId || ""),
          channel_product_id: String(it.externalVendorSkuCode || it.vendorItemId || ""),
          product_name: it.vendorItemName || null,
          qty: Number(it.shippingCount || 0),
          unit_price: it.salesPrice != null ? Number(it.salesPrice) : it.orderPrice != null ? Number(it.orderPrice) : null,
          order_date: o.orderedAt ? String(o.orderedAt).slice(0, 10) : null,
          buyer_name: o.orderer?.name || null,
        });
      }
    }
    nextToken = j.nextToken || "";
  } while (nextToken);
  return out;
}

/** 키 확인 — 실제로 한 번 부른다(2026-08-21 규칙). 최근 하루 주문을 읽어 본다. */
export async function testChannelKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  const today = ymd(new Date());
  try {
    if (provider === "smartstore") { await naverToken(key); return { ok: true, message: "연결됐습니다 — 스마트스토어 주문을 가져올 수 있습니다." }; }
    if (provider === "coupang") { const rows = await coupangOrders(key, today, today); return { ok: true, message: `연결됐습니다 — 오늘 접수 주문 ${rows.length}건을 읽었습니다.` }; }
    return { ok: false, message: "알 수 없는 채널입니다." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "확인하지 못했습니다." };
  }
}

export const CHANNEL_FETCHERS: Record<string, (key: string, from: string, to: string) => Promise<ChannelOrderRow[]>> = {
  smartstore: naverOrders,
  coupang: coupangOrders,
};
