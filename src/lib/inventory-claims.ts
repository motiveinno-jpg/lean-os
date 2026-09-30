// 이커머스 1단계 — 클레임(취소·반품·교환)·채널 정산 (2026-09-28, docs/20260928_PLAN_ecommerce_stage1.md 결정 266~271)
//   ▸ 클레임의 단위는 주문번호 1건(channel_order_imports 행). 재고는 판매 출고를 지우지 않고 **반품 입고(return_in)** 로 되돌린다(이력·원가 층 보존).
//   ▸ 정산의 단위는 채널이 준 정산 내역 한 줄. 같은 줄 두 번 붙여넣기는 유일 제약(회사·채널·주문번호·정산일·정산금)이 막는다 — 결정 17 과 같은 결.
//   ▸ 여기서는 값을 만들고 제안만 한다. 수수료율 갱신·전표 확정은 사람이 누른다.
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { createStockDoc, getStockDoc, deleteStockDoc } from "@/lib/inventory";
import { channelLabel, type OrderImport } from "@/lib/inventory-channels";
import type { ChannelFees } from "@/lib/inventory-settings";

const db = supabase as any;

// ── 클레임 ────────────────────────────────────────────────────────────────
export type ClaimKind = "cancel" | "return" | "exchange";
export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = { cancel: "취소", return: "반품", exchange: "교환" };
export type Claim = {
  id: string; import_id: string; kind: ClaimKind; refund_amount: number; reason: string | null; claimed_at: string;
  status: "requested" | "done"; restock: boolean; restock_doc_id: string | null; exchange_doc_id: string | null; created_at: string;
};
export type OrderLine = { product_id: string; qty: number; unit_price: number | null; vat_amount: number | null; note: string | null };

export async function listClaims(companyId: string): Promise<Claim[]> {
  if (!companyId) return [];
  const rows = await fetchPaged<any>("inventory:claims", () => db.from("channel_order_claims")
    .select("id, import_id, kind, refund_amount, reason, claimed_at, status, restock, restock_doc_id, exchange_doc_id, created_at")
    .eq("company_id", companyId).order("claimed_at", { ascending: false }).order("id"));
  return rows.map((r) => ({ ...r, refund_amount: Number(r.refund_amount || 0) })) as Claim[];
}

/** 그 주문이 판매 출고 문서에서 차지한 줄 — 채널 출고 문서는 주문 여러 건을 묶으므로 줄 note("채널 주문번호 …")로 가른다 */
export async function orderLinesOf(imp: OrderImport): Promise<{ warehouseId: string | null; lines: OrderLine[] }> {
  if (!imp.doc_id) return { warehouseId: null, lines: [] };
  const { doc, moves } = await getStockDoc(imp.doc_id);
  const tag = `${channelLabel(imp.channel)} ${imp.channel_order_no.trim()}`;
  const lines = moves
    .filter((m: any) => String(m.note || "").startsWith(tag))
    .map((m: any) => ({ product_id: m.product_id, qty: Math.abs(Number(m.qty || 0)), unit_price: m.unit_price, vat_amount: m.vat_amount, note: m.note }));
  return { warehouseId: doc?.warehouse_id ?? null, lines };
}

/**
 * 클레임 등록 — 표 1행 + (되돌림이면) 반품 입고 문서 + (교환이면) 교환 출고 문서(금액 0).
 *   문서를 먼저 만들고 행 insert 가 실패하면 문서를 지운다(importChannelDoc 과 같은 되돌림).
 */
export async function createClaim(companyId: string, params: {
  imp: OrderImport; kind: ClaimKind; refundAmount: number; reason?: string | null; claimedAt: string; restock: boolean;
  lines?: OrderLine[]; warehouseId?: string | null;
}, userId?: string | null): Promise<{ id: string; restockDocNo: string | null; exchangeDocNo: string | null }> {
  const { imp, kind, claimedAt } = params;
  if (!(params.refundAmount >= 0)) throw new Error("환불 금액은 0 이상이어야 합니다");
  let restockDocId: string | null = null, restockDocNo: string | null = null;
  let exchangeDocId: string | null = null, exchangeDocNo: string | null = null;
  const label = `${channelLabel(imp.channel)} ${imp.channel_order_no.trim()}`;
  if (params.restock) {
    const src = params.lines?.length ? { warehouseId: params.warehouseId ?? null, lines: params.lines } : await orderLinesOf(imp);
    const warehouseId = params.warehouseId || src.warehouseId;
    const lines = src.lines.filter((l) => l.qty > 0);
    if (!warehouseId) throw new Error("되돌릴 창고를 알 수 없습니다. 원래 출고 문서가 없으면 재고 되돌림을 끄고 등록하세요.");
    if (!lines.length) throw new Error("이 주문의 출고 줄을 찾지 못했습니다. 재고 되돌림을 끄고 등록하거나 창고관리에서 직접 입고하세요.");
    const rin = await createStockDoc(companyId, {
      reason: "return_in", docDate: claimedAt, warehouseId, originalDocId: imp.doc_id,
      note: `${label} ${CLAIM_KIND_LABEL[kind]} · 반품 입고`,
      lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, vat_amount: l.vat_amount, note: `${label} ${CLAIM_KIND_LABEL[kind]}` })),
    }, userId);
    restockDocId = rin.id; restockDocNo = rin.docNo;
    if (kind === "exchange") {
      try {
        const out = await createStockDoc(companyId, {
          reason: "sale", docDate: claimedAt, warehouseId, originalDocId: imp.doc_id,
          note: `${label} 교환 · 교환 출고(금액 0)`,
          lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: 0, vat_amount: 0, note: `${label} 교환 출고` })),
        }, userId);
        exchangeDocId = out.id; exchangeDocNo = out.docNo;
      } catch (e) { await deleteStockDoc(restockDocId).catch(() => {}); throw e; }
    }
  }
  const { data, error } = await db.from("channel_order_claims").insert({
    company_id: companyId, import_id: imp.id, kind, refund_amount: Math.round(params.refundAmount),
    reason: params.reason?.trim() || null, claimed_at: claimedAt, status: "done", restock: params.restock,
    restock_doc_id: restockDocId, exchange_doc_id: exchangeDocId, created_by: userId ?? null,
  }).select("id").single();
  if (error) {
    if (exchangeDocId) await deleteStockDoc(exchangeDocId).catch(() => {});
    if (restockDocId) await deleteStockDoc(restockDocId).catch(() => {});
    throw error;
  }
  return { id: data.id, restockDocNo, exchangeDocNo };
}

/** 클레임 삭제 — 되돌림 문서를 **먼저** 지우고 행을 지운다(문서 삭제가 실패하면 클레임도 남긴다 — 재고만 남는 반쪽을 막는다).
 *  문서가 전표에 묶였으면 막는다(장부가 깨진다). */
export async function deleteClaim(claim: Claim): Promise<void> {
  for (const docId of [claim.restock_doc_id, claim.exchange_doc_id]) {
    if (!docId) continue;
    const { data } = await db.from("stock_docs").select("id, journal_entry_id, doc_no").eq("id", docId).maybeSingle();
    if (data?.journal_entry_id) throw new Error(`${data.doc_no} 문서가 이미 전표에 묶여 있어 지울 수 없습니다. 전표를 먼저 반려하세요.`);
  }
  for (const docId of [claim.exchange_doc_id, claim.restock_doc_id]) if (docId) await deleteStockDoc(docId);
  const { error } = await db.from("channel_order_claims").delete().eq("id", claim.id);
  if (error) throw error;
}

/** 채널별 환불 합 — KPI·현황이 주문 금액에서 뺀다(결정 268). 교환은 0 */
export function refundByChannel(claims: Claim[], imports: OrderImport[], inRange?: (i: OrderImport) => boolean): Map<string, number> {
  const impById = new Map(imports.map((i) => [i.id, i]));
  const m = new Map<string, number>();
  for (const c of claims) {
    if (c.kind === "exchange") continue;
    const i = impById.get(c.import_id);
    if (!i || (inRange && !inRange(i))) continue;
    m.set(i.channel, (m.get(i.channel) || 0) + c.refund_amount);
  }
  return m;
}

// ── 정산 ──────────────────────────────────────────────────────────────────
export type Settlement = {
  id: string; channel: string; channel_order_no: string; settled_at: string;
  sale_amount: number; fee_amount: number; shipping_amount: number; settle_amount: number;
  raw: Record<string, unknown> | null; import_id: string | null; batch_id: string; journal_entry_id: string | null; created_at: string;
  /** 연결된 전표 초안의 상태 — rejected 면 '초안 없음'으로 보고 다시 만들 수 있게 연결을 푼다 */
  journal_status: string | null;
};
export type SettleField = "order_no" | "settled_at" | "sale_amount" | "fee_amount" | "shipping_amount" | "settle_amount";
export const SETTLE_FIELDS: { key: SettleField; label: string; required?: boolean; desc: string }[] = [
  { key: "order_no", label: "주문번호", required: true, desc: "주문 가져오기의 주문번호와 같은 값 (상품주문번호 아님)" },
  { key: "settled_at", label: "정산일", required: true, desc: "정산(지급) 일자 · 매출인식일" },
  { key: "sale_amount", label: "판매금액", desc: "수수료를 떼기 전 결제·판매 금액" },
  { key: "fee_amount", label: "수수료", desc: "판매·결제 수수료 합 (양수로)" },
  { key: "shipping_amount", label: "배송비", desc: "채널이 정산에서 뺀 배송비" },
  { key: "settle_amount", label: "정산금액", required: true, desc: "실제 지급(입금) 금액 · 환불 차감은 음수" },
];
//   머리글 추정 — 채널마다 이름이 다르다. 맞으면 채워 두고, 사람이 셀렉트로 고친다(택배사 시트와 같은 결).
const HEAD_HINTS: Record<SettleField, string[]> = {
  order_no: ["주문번호", "주문 번호", "orderid", "order_id", "주문id"],
  settled_at: ["정산일", "정산완료일", "정산 완료일", "정산예정일", "정산 예정일", "지급일", "매출인식일", "정산기준일"],
  sale_amount: ["정산기준금액", "판매금액", "상품금액", "결제금액", "판매가", "매출액", "주문금액"],
  fee_amount: ["판매수수료", "수수료", "결제수수료", "서비스이용료", "이용료"],
  shipping_amount: ["배송비", "배송료", "택배비"],
  settle_amount: ["정산금액", "정산 금액", "최종정산", "지급액", "실정산", "정산액", "지급금액"],
};
const normHead = (s: string) => s.replace(/[\s()（）\[\]_\-·.]/g, "").toLowerCase();
const PII_HEAD = /이름|성명|구매자|수취인|수령인|받는|연락처|전화|휴대|핸드폰|주소|우편|아이디|id$|이메일|email|메일|생년|주민|카드번호|계좌/i;
export function guessSettleColumns(headers: string[]): Partial<Record<SettleField, number>> {
  const out: Partial<Record<SettleField, number>> = {};
  const used = new Set<number>();
  for (const f of ["settle_amount", "fee_amount", "shipping_amount", "sale_amount", "settled_at", "order_no"] as SettleField[]) {
    const hints = HEAD_HINTS[f].map(normHead);
    const idx = headers.findIndex((h, i) => !used.has(i) && hints.some((k) => normHead(h) === k))
      ?? -1;
    const idx2 = idx >= 0 ? idx : headers.findIndex((h, i) => !used.has(i) && hints.some((k) => normHead(h).includes(k)));
    if (idx2 >= 0) { out[f] = idx2; used.add(idx2); }
  }
  return out;
}
const num = (v: unknown): number => { const n = Number(String(v ?? "").replace(/[₩,\s원]/g, "").replace(/^\((.*)\)$/, "-$1")); return Number.isFinite(n) ? n : 0; };
const day = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
};
export type SettleRow = { channel_order_no: string; settled_at: string; sale_amount: number; fee_amount: number; shipping_amount: number; settle_amount: number; raw: Record<string, unknown> };
/** 붙여넣은 TSV → 정산 줄. 첫 줄은 머리글. 주문번호·정산일·정산금이 없는 줄은 건너뛰고 몇 줄인지 돌려준다 */
export function parseSettlementTsv(tsv: string, map: Partial<Record<SettleField, number>>): { rows: SettleRow[]; skipped: number; headers: string[] } {
  const lines = tsv.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0, headers: lines[0]?.split("\t") ?? [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows: SettleRow[] = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const pick = (f: SettleField) => (map[f] == null ? "" : String(cells[map[f]!] ?? "").trim());
    const no = pick("order_no"), at = day(pick("settled_at")), settle = pick("settle_amount");
    if (!no || !at || settle === "") { skipped += 1; continue; }
    //   원본 열은 대조·검증용으로만 남긴다. 이름·연락처·주소·아이디·이메일 같은 개인정보 열은 저장하지 않는다(보안 검토 W2)
    const raw: Record<string, unknown> = {}; headers.forEach((h, i) => { if (h && !PII_HEAD.test(h)) raw[h] = cells[i] ?? ""; });
    rows.push({ channel_order_no: no, settled_at: at, sale_amount: num(pick("sale_amount")), fee_amount: Math.abs(num(pick("fee_amount"))), shipping_amount: Math.abs(num(pick("shipping_amount"))), settle_amount: num(settle), raw });
  }
  return { rows, skipped, headers };
}

export async function listSettlements(companyId: string): Promise<Settlement[]> {
  if (!companyId) return [];
  const rows = await fetchPaged<any>("inventory:settlements", () => db.from("channel_settlements")
    //   raw 는 화면이 안 쓰므로 읽지 않는다(보안 검토 W3) — 필요하면 줄 하나만 따로 읽는다
    .select("id, channel, channel_order_no, settled_at, sale_amount, fee_amount, shipping_amount, settle_amount, import_id, batch_id, journal_entry_id, created_at, journal_entries(status)")
    .eq("company_id", companyId).order("settled_at", { ascending: false }).order("id"));
  return rows.map((r) => ({ ...r, raw: null, journal_status: r.journal_entries?.status ?? null, journal_entries: undefined,
    sale_amount: Number(r.sale_amount || 0), fee_amount: Number(r.fee_amount || 0), shipping_amount: Number(r.shipping_amount || 0), settle_amount: Number(r.settle_amount || 0) })) as Settlement[];
}

/** 정산 줄 저장 — 주문번호로 주문 기록을 잇고(없으면 null), 이미 있는 줄(같은 주문번호·정산일·정산금)은 건너뛴다 */
export async function importSettlements(companyId: string, channel: string, rows: SettleRow[], userId?: string | null): Promise<{ inserted: number; skipped: number; matched: number; batchId: string }> {
  if (!rows.length) throw new Error("저장할 줄이 없습니다");
  const nos = [...new Set(rows.map((r) => r.channel_order_no))];
  const impMap = new Map<string, string>();
  const existing = new Set<string>();
  for (let i = 0; i < nos.length; i += 200) {
    const chunk = nos.slice(i, i + 200);
    const imps = logRead("inventory:settle-imports", await db.from("channel_order_imports").select("id, channel_order_no").eq("company_id", companyId).eq("channel", channel).in("channel_order_no", chunk));
    for (const r of ((imps || []) as any[])) impMap.set(r.channel_order_no, r.id);
    const ex = logRead("inventory:settle-existing", await db.from("channel_settlements").select("channel_order_no, settled_at, settle_amount").eq("company_id", companyId).eq("channel", channel).in("channel_order_no", chunk));
    for (const r of ((ex || []) as any[])) existing.add(`${r.channel_order_no}|${r.settled_at}|${Number(r.settle_amount)}`);
  }
  const batchId = crypto.randomUUID();
  const fresh = rows.filter((r) => !existing.has(`${r.channel_order_no}|${r.settled_at}|${r.settle_amount}`));
  const skipped = rows.length - fresh.length;
  if (!fresh.length) return { inserted: 0, skipped, matched: 0, batchId };
  const payload = fresh.map((r) => ({
    company_id: companyId, channel, channel_order_no: r.channel_order_no, settled_at: r.settled_at,
    sale_amount: r.sale_amount, fee_amount: r.fee_amount, shipping_amount: r.shipping_amount, settle_amount: r.settle_amount,
    raw: r.raw, import_id: impMap.get(r.channel_order_no) ?? null, batch_id: batchId, created_by: userId ?? null,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db.from("channel_settlements").insert(payload.slice(i, i + 500));
    if (error) throw error;
  }
  return { inserted: fresh.length, skipped, matched: fresh.filter((r) => impMap.has(r.channel_order_no)).length, batchId };
}

/** 붙여넣기 묶음 삭제 — 전표 초안이 붙었으면 막는다 */
export async function deleteSettlementBatch(companyId: string, batchId: string): Promise<number> {
  //   한 묶음이 1,000줄을 넘을 수 있어 끝까지 읽는다(하나라도 전표가 붙었으면 막아야 한다)
  const bound = await fetchPaged<any>("claims:settle-bound", () => db.from("channel_settlements").select("id, journal_entries(status)").eq("company_id", companyId).eq("batch_id", batchId).not("journal_entry_id", "is", null).order("id"), 100000, { strict: true });
  if (((bound || []) as any[]).some((r) => r.journal_entries?.status !== "rejected")) throw new Error("이 묶음은 이미 전표 초안이 만들어져 지울 수 없습니다. 전표를 먼저 반려하세요.");
  const { data, error } = await db.from("channel_settlements").delete().eq("company_id", companyId).eq("batch_id", batchId).select("id");
  if (error) throw error;
  return (data || []).length;
}

/** 정산 전표 초안(결정 271) — 서버 RPC 가 묶음 합계로 일반전표 초안(ai_suggested)을 만들고 정산 줄에 전표 id 를 적는다.
 *  확정은 전표 현황 › 처리할 것. 차) 보통예금(정산금)·지급수수료·운반비 [·차액] / 대) 채널 매출(판매금액). */
export async function makeSettlementVoucherDraft(params: {
  batchId: string; entryDate: string; acctBank: string; acctFee: string; acctShip: string; acctSales: string; acctDiff?: string | null; description?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("make_my_channel_settlement_voucher", {
    p_batch_id: params.batchId, p_entry_date: params.entryDate,
    p_acct_bank: params.acctBank, p_acct_fee: params.acctFee, p_acct_ship: params.acctShip, p_acct_sales: params.acctSales,
    p_acct_diff: params.acctDiff ?? null, p_description: params.description?.trim() || null,
  });
  if (error) {
    const m: Record<string, string> = {
      FORBIDDEN: "전표를 만들 권한이 없습니다 (이커머스 입력·수정 권한 필요)",
      PERIOD_LOCKED: "그 달은 마감돼 전표를 만들 수 없습니다 — 전표 일자를 바꾸거나 마감을 먼저 여세요",
      NO_DATE: "전표 일자를 고르세요", NO_COMPANY: "회사를 찾을 수 없습니다",
      NEED_TWO_LINES: "금액이 전부 0 이라 전표를 만들 수 없습니다", UNBALANCED: "차변과 대변이 맞지 않습니다 — 차액 계정을 확인하세요",
    };
    throw new Error(m[error.message] || error.message);
  }
  return data as string;
}
/** 반려된 초안이 묶음에 걸려 있으면 연결을 푼다 — 그래야 같은 묶음으로 다시 만들 수 있다(RPC 는 journal_entry_id 가 비어 있는 줄만 집는다) */
export async function unlinkRejectedVoucher(companyId: string, batchId: string): Promise<number> {
  const ents = await fetchPaged<any>("claims:settle-ents", () => db.from("channel_settlements").select("id, journal_entry_id, journal_entries(status)").eq("company_id", companyId).eq("batch_id", batchId).not("journal_entry_id", "is", null).order("id"), 100000, { strict: true });
  const rejected = [...new Set(((ents || []) as any[]).filter((r) => r.journal_entries?.status === "rejected").map((r) => r.journal_entry_id as string))];
  if (!rejected.length) return 0;
  const { data, error } = await db.from("channel_settlements").update({ journal_entry_id: null }).eq("company_id", companyId).eq("batch_id", batchId).in("journal_entry_id", rejected).select("id");
  if (error) throw error;
  return (data || []).length;
}
/** 묶음 합계 — 팝업 미리보기용. 차액 = 판매금액 − (정산금 + 수수료 + 배송비) */
export function batchTotals(rows: Settlement[]): { n: number; sale: number; fee: number; ship: number; settle: number; creditSales: number; diff: number; from: string; to: string; channels: string[] } {
  const sale = rows.reduce((n, r) => n + r.sale_amount, 0), fee = rows.reduce((n, r) => n + r.fee_amount, 0), ship = rows.reduce((n, r) => n + r.shipping_amount, 0), settle = rows.reduce((n, r) => n + r.settle_amount, 0);
  const creditSales = sale > 0 ? sale : settle + fee + ship;
  const dates = rows.map((r) => r.settled_at).sort();
  return { n: rows.length, sale: Math.round(sale), fee: Math.round(fee), ship: Math.round(ship), settle: Math.round(settle), creditSales: Math.round(creditSales), diff: Math.round(creditSales - (settle + fee + ship)), from: dates[0] || "", to: dates[dates.length - 1] || "", channels: [...new Set(rows.map((r) => r.channel))] };
}
export type AccountOpt = { id: string; code: string | null; name: string; account_type: string | null };
export async function listAccountOptions(companyId: string): Promise<AccountOpt[]> {
  const data = logRead("inventory:accounts", await db.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).order("code"));
  return ((data || []) as any[]).map((a) => ({ id: a.id, code: a.code ? String(a.code) : null, name: a.name, account_type: a.account_type ?? null }));
}

// ── 정산 전표 ↔ 통장 입금 줄 대조 (2026-09-28 1단계 후속) ──
//   전표의 보통예금 차변 = Σ정산금. 통장에 그 금액의 입금이 있으면 전표에 건다(link_transaction_to_entry — 확정 전표만, 권한·마감은 서버).
//   수집·전표의 중복 의심 팝업은 '차변 합계(=매출 총액)'로 찾아 정산 입금(정산금)과 맞지 않는다 — 그래서 여기서 정산금으로 찾는다.
export type BankTx = { id: string; transaction_date: string; amount: number; counterparty: string | null; description: string | null };
export type EntryBankLink = { entryId: string; linked: BankTx[]; candidates: BankTx[] };
export async function fetchSettlementBankLinks(companyId: string, entries: { entryId: string; entryDate: string; settle: number }[]): Promise<Map<string, EntryBankLink>> {
  const out = new Map<string, EntryBankLink>();
  if (!companyId || !entries.length) return out;
  for (const e of entries) out.set(e.entryId, { entryId: e.entryId, linked: [], candidates: [] });
  const ids = entries.map((e) => e.entryId);
  const linked = logRead("inventory:settle-bank-linked", await db.from("bank_transactions").select("id, journal_entry_id, transaction_date, amount, counterparty, description").eq("company_id", companyId).in("journal_entry_id", ids));
  for (const r of ((linked || []) as any[])) out.get(r.journal_entry_id)?.linked.push({ id: r.id, transaction_date: r.transaction_date, amount: Number(r.amount || 0), counterparty: r.counterparty, description: r.description });
  const open = entries.filter((e) => !(out.get(e.entryId)?.linked.length));
  if (!open.length) return out;
  const dates = open.map((e) => e.entryDate).sort();
  const from = new Date(dates[0]); from.setDate(from.getDate() - 3);
  const to = new Date(dates[dates.length - 1]); to.setDate(to.getDate() + 14);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const cands = await fetchPaged<any>("inventory:settle-bank-cands", () => db.from("bank_transactions")
    .select("id, transaction_date, amount, counterparty, description, type")
    .eq("company_id", companyId).is("journal_entry_id", null).is("ledger_excluded_reason", null)
    .gte("transaction_date", ymd(from)).lte("transaction_date", ymd(to)).gt("amount", 0).order("transaction_date").order("id"), 5000);
  for (const e of open) {
    const want = Math.round(e.settle);
    if (want <= 0) continue;
    const hits = cands.filter((c) => !["expense", "withdrawal", "출금", "out"].includes(String(c.type || "")) && Math.abs(Math.round(Number(c.amount)) - want) <= 1)
      .sort((a, b) => Math.abs(new Date(a.transaction_date).getTime() - new Date(e.entryDate).getTime()) - Math.abs(new Date(b.transaction_date).getTime() - new Date(e.entryDate).getTime()))
      .slice(0, 5)
      .map((c) => ({ id: c.id, transaction_date: c.transaction_date, amount: Number(c.amount || 0), counterparty: c.counterparty, description: c.description }));
    out.get(e.entryId)!.candidates = hits;
  }
  return out;
}
/** 통장 입금 줄을 정산 전표에 건다 — 확정 전표만(서버가 검사). false = 이미 다른 전표가 걸린 줄 */
export async function linkSettlementBankTx(txId: string, entryId: string): Promise<boolean> {
  const { linkTransactionToEntry } = await import("@/lib/dup-voucher");
  try { return await linkTransactionToEntry("bank", txId, entryId); }
  catch (e: any) {
    const m: Record<string, string> = { FORBIDDEN: "통장 줄을 전표에 걸 권한이 없습니다 (수집·전표 권한 필요)", NOT_FOUND_OR_INVALID: "확정된 전표에만 걸 수 있습니다. 전표 현황에서 먼저 확정하세요", PERIOD_LOCKED: "그 달은 마감돼 걸 수 없습니다" };
    throw new Error(m[e?.message] || e?.message || "연결 실패");
  }
}

/** 채널별 정산 요약 + 실측 수수료율 vs 설정(결정 270). 미정산 = 출고 14일 지난 주문에 정산 줄이 없는 것 */
export const UNSETTLED_DAYS = 14;
export type SettleSummary = { channel: string; n: number; matched: number; sale: number; fee: number; ship: number; settle: number; feeRateActual: number | null; feeRateSet: number | null };
export function settlementSummary(settlements: Settlement[], fees: ChannelFees): SettleSummary[] {
  const m = new Map<string, SettleSummary>();
  for (const s of settlements) {
    const cur = m.get(s.channel) || { channel: s.channel, n: 0, matched: 0, sale: 0, fee: 0, ship: 0, settle: 0, feeRateActual: null, feeRateSet: fees[s.channel]?.fee_rate ?? null };
    cur.n += 1; if (s.import_id) cur.matched += 1;
    cur.sale += s.sale_amount; cur.fee += s.fee_amount; cur.ship += s.shipping_amount; cur.settle += s.settle_amount;
    m.set(s.channel, cur);
  }
  for (const v of m.values()) v.feeRateActual = v.sale > 0 ? v.fee / v.sale : null;
  return [...m.values()].sort((a, b) => b.settle - a.settle);
}
export function unsettledImports(imports: OrderImport[], settlements: Settlement[], claims: Claim[], today: string): OrderImport[] {
  const settled = new Set(settlements.map((s) => `${s.channel}|${s.channel_order_no}`));
  const claimed = new Set(claims.filter((c) => c.kind === "cancel").map((c) => c.import_id));
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - UNSETTLED_DAYS);
  const cut = cutoff.toISOString().slice(0, 10);
  return imports.filter((i) => i.ship_status !== "pending" && !claimed.has(i.id) && !settled.has(`${i.channel}|${i.channel_order_no}`)
    && String(i.shipped_at || i.order_date || "").slice(0, 10) <= cut);
}
