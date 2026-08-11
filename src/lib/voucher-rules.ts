// 자동분개 학습 — (열쇠 → 계정) 규칙 (2026-08-11, 수집·전표 4단계)
//
//   전표를 만들 때 사람이 고른 계정을 기억해 두었다가 다음에 같은 상대가 나오면 미리 채운다.
//   **제안만** 한다 — 전표는 사람이 확정 버튼을 눌러야 생긴다.
//
//   ★ 열쇠(match_key)는 자료마다 다르다. 그게 이 층의 핵심이다.
//     세금계산서·계산서 → 거래처(있으면 partner_id, 없으면 상호)
//     현금영수증        → 상호
//     카드              → 가맹점명
//     통장              → 입금자명(없으면 적요)
//   카드에서 배운 규칙을 세금계산서에 쓰면 안 되므로 source_kind 로 칸을 나눈다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type RuleKind = "tax_invoice" | "exempt_invoice" | "cash_receipt" | "card" | "bank";

export type VoucherRule = {
  id: string;
  source_kind: RuleKind;
  match_key: string;
  match_label: string;
  account_id: string;
  vat_type: string | null;
  hit_count: number;
  last_used_at: string;
  account?: { id: string; code: string; name: string; account_type: string } | null;
};

/** 이름을 열쇠로 다듬는다 — 앞뒤·중간 공백만 정리하고 대소문자를 맞춘다.
 *  '주식회사'·'(주)' 같은 걸 떼지 않는 이유: 서로 다른 상호가 한 열쇠로 합쳐질 수 있어서다.
 *  덜 합치는 쪽이 안전하다 — 틀린 제안보다 제안이 없는 편이 낫다. */
export function normKey(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 자료 한 줄에서 열쇠와 사람이 읽을 이름을 뽑는다.
 *
 *  ★ 통장만 **입금자 + 적요를 함께** 쓴다. 입금자만으로는 열쇠가 너무 넓기 때문이다 —
 *    운영 데이터에서 확인: counterparty '체크'가 114건에 붙는데 그 안의 적요가 45가지고
 *    ('체크'는 체크카드 결제라는 뜻이지 상대가 아니다), '(주)모티브이노베이션'은 1,040건/적요 267가지다.
 *    입금자만 열쇠로 삼으면 한 번 고른 계정이 엉뚱한 114건에 붙는다.
 *    적요가 매번 다르면 학습이 안 걸리지만 **틀린 제안보다 제안이 없는 편이 낫다.**
 *  세금계산서·계산서는 거래처 id, 카드는 가맹점명, 현금영수증은 상호 — 이들은 그 자체로 구체적이다.
 */
export function ruleKeyOf(
  kind: RuleKind,
  row: { partnerId?: string | null; name?: string | null; fallback?: string | null },
): { key: string; label: string } {
  if ((kind === "tax_invoice" || kind === "exempt_invoice") && row.partnerId) {
    return { key: row.partnerId, label: (row.name || "").trim() };
  }
  const name = (row.name || "").trim();
  const extra = (row.fallback || "").trim();
  if (kind === "bank") {
    const label = extra || name;
    return { key: normKey(`${name}|${extra}`), label };
  }
  const one = name || extra;
  return { key: normKey(one), label: one };
}

/** 회사의 규칙을 자료별로 읽어 (열쇠 → 가장 많이 고른 규칙) 지도로 만든다 */
export async function fetchRuleMap(companyId: string, kind: RuleKind): Promise<Map<string, VoucherRule>> {
  //   생성 타입에 아직 없는 새 표 — 저장소 다른 곳과 같은 방식으로 캐스팅한다
  const data = logRead("voucher-rules:list", await (supabase as any)
    .from("voucher_account_rules")
    .select("id, source_kind, match_key, match_label, account_id, vat_type, hit_count, last_used_at, chart_of_accounts(id, code, name, account_type)")
    .eq("company_id", companyId).eq("source_kind", kind)
    .order("hit_count", { ascending: false }).order("last_used_at", { ascending: false })
    .limit(2000));
  const m = new Map<string, VoucherRule>();
  for (const r of ((data as any[]) || [])) {
    //   같은 열쇠에 계정이 여러 개면 **많이 고른 쪽이 이긴다**(정렬이 그렇게 돼 있다).
    //   사람이 다른 계정을 고르면 그 조합의 횟수가 올라 결국 뒤집힌다 — 규칙을 지울 필요가 없다.
    if (!m.has(r.match_key)) m.set(r.match_key, { ...(r as any), account: r.chart_of_accounts ?? null });
  }
  return m;
}

/** 전표를 만들 때 그 선택을 배운다. 실패해도 저장 결과를 바꾸지 않는다. */
export async function learnAccount(input: {
  kind: RuleKind; key: string; label: string; accountId: string; vatType?: string | null;
}): Promise<void> {
  if (!input.key || !input.accountId) return;
  try {
    await (supabase.rpc as any)("learn_voucher_account", {
      p_source_kind: input.kind,
      p_match_key: input.key,
      p_match_label: input.label || "",
      p_account_id: input.accountId,
      p_vat_type: input.vatType ?? null,
    });
  } catch {
    /* 배우다 실패한 것이 전표를 되돌릴 이유는 아니다 */
  }
}

/** 몇 번 배웠는지에 따라 꼬리표를 다르게 — 어디까지가 근거 있는 판단인지 보여야 한다 */
export function ruleTag(hit: number): "지난번" | "학습" {
  return hit >= 3 ? "학습" : "지난번";
}
