// 받을 돈·낼 돈 — 거래처별 세금계산서 잔액. 계산은 DB 함수 receivables_by_partner 한 곳에서만 한다
//   (마이그 20260928140000). 대시보드 미수금 위젯·수익/이익 보고서·경영요약·아침 브리핑·자금 전망·AI 참모가
//   전부 이 값을 읽는다 — 화면마다 따로 세다가 마이너스(수정·환입) 계산서를 빼먹어 숫자가 갈라졌었다.
//   기준: 발행액 − 정산액, 무효·초안·취소 제외, 전표 처리된 것, 거래처 안에서 상계, 순잔액 1원 넘는 거래처만.
//   over30 = 순잔액 − 최근 30일 발행분(받은 돈·취소분은 오래된 계산서부터 지운다고 본다).
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { daysSinceKst } from "@/lib/kst";

const db = supabase as any;

export type PartnerBalance = {
  key: string;
  partnerId: string | null;
  name: string;
  balance: number;
  over30: number;
  oldestOpenDate: string | null;
  /** 아직 덜 받은 가장 오래된 계산서가 발행된 지 며칠 */
  oldestDays: number;
  invoiceCount: number;
};

//   대시보드는 위젯 여러 개(미수금·아침 브리핑·경영요약·자금 전망 …)가 같은 순간에 이 함수를 불러
//   같은 DB 계산이 한 화면에 7번씩 나갔다(2026-09-28 실측). 같은 회사·같은 종류는 진행 중인 요청과
//   직전 30초 결과를 함께 쓴다 — 값은 같고 요청만 한 번.
const SHARE_MS = 30_000;
const shared = new Map<string, { at: number; p: Promise<PartnerBalance[]> }>();

export function fetchPartnerBalances(companyId: string, type: "sales" | "purchase" = "sales"): Promise<PartnerBalance[]> {
  const key = `${companyId}:${type}`;
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = loadPartnerBalances(companyId, type).catch((e) => { shared.delete(key); throw e; });
  shared.set(key, { at: Date.now(), p });
  return p;
}

async function loadPartnerBalances(companyId: string, type: "sales" | "purchase"): Promise<PartnerBalance[]> {
  const rows = await fetchPaged<any>(`receivables:${type}`, () => db
    .rpc("receivables_by_partner", { p_company_id: companyId, p_type: type })
    .order("partner_key"), 50000);
  return ((rows || []) as any[]).map((r) => ({
    key: String(r.partner_key),
    partnerId: r.partner_id ?? null,
    name: String(r.name || "(미상)"),
    balance: Number(r.balance || 0),
    over30: Number(r.over30 || 0),
    oldestOpenDate: r.oldest_open_date ?? null,
    oldestDays: r.oldest_open_date ? daysSinceKst(String(r.oldest_open_date)) : 0,
    invoiceCount: Number(r.invoice_count || 0),
  }));
}

export type BalanceSummary = { total: number; over30: number; over30Partners: number; partners: PartnerBalance[] };

export function summarizeBalances(partners: PartnerBalance[]): BalanceSummary {
  return {
    total: partners.reduce((s, p) => s + p.balance, 0),
    over30: partners.reduce((s, p) => s + p.over30, 0),
    over30Partners: partners.filter((p) => p.over30 > 1).length,
    partners,
  };
}
