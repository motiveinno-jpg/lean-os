// ── 거래처 신용 등급 — 입금 지연 이력 (2026-08-27 ERP 3순위 ②, 결정 78~80) ──
//   서버 함수 get_partner_credit 이 계산한다. 화면은 등급 배지 + 근거(평균 지연·미수)만 보여 준다. 제안이지 판정이 아니다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type PartnerCredit = {
  partner_id: string; settled_n: number; avg_delay: number | null; max_delay: number | null; late_ratio: number | null;
  open_amt: number; open_over60: number; open_over90: number; oldest_open_days: number | null; grade: "A" | "B" | "C" | "D" | null;
};
export const GRADE_LABEL: Record<string, string> = { A: "A · 제때", B: "B · 보통", C: "C · 늦음", D: "D · 위험" };

export async function fetchPartnerCredit(companyId: string): Promise<Map<string, PartnerCredit>> {
  const data = logRead("partner-credit", await (supabase as any).rpc("get_partner_credit", { p_company: companyId }));
  const m = new Map<string, PartnerCredit>();
  for (const r of ((data || []) as any[])) m.set(r.partner_id, { ...r, settled_n: Number(r.settled_n || 0), avg_delay: r.avg_delay == null ? null : Number(r.avg_delay), open_amt: Number(r.open_amt || 0), open_over60: Number(r.open_over60 || 0), open_over90: Number(r.open_over90 || 0) });
  return m;
}
/** 툴팁 한 줄 — 왜 이 등급인지 */
export function creditReason(c: PartnerCredit | undefined): string {
  if (!c || !c.grade) return "입금 이력이 없어 판단하지 않습니다";
  const parts: string[] = [];
  if (c.settled_n) parts.push(`정산 ${c.settled_n}건 · 평균 ${c.avg_delay}일 (최장 ${c.max_delay}일, 30일 초과 ${Math.round((c.late_ratio || 0) * 100)}%)`);
  if (c.open_amt > 0) parts.push(`미수 ₩${Math.round(c.open_amt).toLocaleString("ko-KR")}${c.open_over90 > 0 ? ` · 90일 초과 ₩${Math.round(c.open_over90).toLocaleString("ko-KR")}` : c.open_over60 > 0 ? ` · 60일 초과 ₩${Math.round(c.open_over60).toLocaleString("ko-KR")}` : ""}`);
  return parts.join(" · ") || "이력 없음";
}
