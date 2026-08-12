// 가맹점 과세유형 — 법인 · 일반 · 간이 · 면세 (2026-08-12 사장님 지시)
//
//   카드 원자료에는 **가맹점 사업자번호는 있는데 과세유형이 없다**(raw_data 전수 확인).
//   국세청 조회(verify-business-number)가 tax_type 을 돌려주므로 그것으로 채운다.
//
//   ⚠️ 번호 하나당 한 번만 조회하면 되는 값이라 `merchant_tax_types` 에 모아 둔다.
//     카드 거래 2,771건마다 조회하면 같은 가맹점을 수십 번 두드린다 — 번호 단위로 모으면
//     조회 수가 **가맹점 수**로 줄어든다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type MerchantKind = "법인" | "일반" | "간이" | "면세";

/** 국세청 원문(tax_type)을 네 갈래로 옮긴다. 못 알아보면 null — 억지로 넣지 않는다. */
export function kindOfTaxType(taxType?: string | null): MerchantKind | null {
  const t = String(taxType || "");
  if (!t) return null;
  //   순서가 중요하다 — '부가가치세 면세사업자' 안에 '사업자'가 들어 있어 뒤에 두면 못 걸린다
  if (t.includes("간이")) return "간이";
  if (t.includes("면세")) return "면세";
  if (t.includes("법인")) return "법인";
  if (t.includes("일반")) return "일반";
  return null;
}

const digits = (s?: string | null) => String(s || "").replace(/[^0-9]/g, "");

/** 이미 조회해 둔 것 — 화면이 바로 그린다 */
export async function fetchMerchantKinds(companyId: string): Promise<Record<string, MerchantKind>> {
  //   ⚠️ 새로 만든 표라 생성 타입(src/types/database.ts)에 아직 없다 — 저장소가 쓰는 방식대로 캐스팅한다.
  //     타입을 다시 뽑을 때 이 캐스팅을 걷어내면 된다.
  const data = logRead("merchant-tax-type:cache", await (supabase as any)
    .from("merchant_tax_types").select("bizno, kind").eq("company_id", companyId));
  const m: Record<string, MerchantKind> = {};
  for (const r of ((data as any[]) || [])) if (r.kind) m[r.bizno] = r.kind as MerchantKind;
  return m;
}

/**
 * 아직 모르는 번호만 국세청에 물어 채운다.
 *   · 이미 있는 번호는 건너뛴다(같은 가맹점을 다시 두드리지 않는다)
 *   · **10개씩** 끊어 보낸다 — verify-business-number 가 11개부터 400 으로 막는다
 *     (2026-08-12: 100개씩 보내다 전량 400. 그동안 카드 사업자번호가 하나도 없어 안 드러났다)
 *   · 못 알아본 것도 **기록은 남긴다** — 안 그러면 다음에 또 같은 번호를 두드린다
 */
export async function fillMerchantKinds(
  companyId: string, biznos: (string | null | undefined)[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const known = await fetchMerchantKinds(companyId);
  const seen = new Set<string>();
  const todo: string[] = [];
  for (const b of biznos) {
    const d = digits(b);
    if (d.length !== 10 || known[d] || seen.has(d)) continue;
    seen.add(d);
    todo.push(d);
  }
  if (todo.length === 0) return 0;

  const BATCH = 10;   // verify-business-number 의 상한 (넘기면 400)
  let filled = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const { data, error } = await supabase.functions.invoke("verify-business-number", {
        body: { businessNumbers: batch },
      });
      if (error) throw error;
      const rows = (data?.results || []) as any[];
      const up = rows.map((r) => ({
        company_id: companyId,
        bizno: digits(r.b_no),
        tax_type: r.tax_type ?? null,
        kind: kindOfTaxType(r.tax_type),
        status: r.b_stt || null,
        checked_at: new Date().toISOString(),
      })).filter((r) => r.bizno.length === 10);
      if (up.length) {
        await (supabase as any).from("merchant_tax_types").upsert(up, { onConflict: "company_id,bizno" });
        filled += up.filter((r) => r.kind).length;
      }
    } catch {
      //   한 묶음이 실패해도 나머지는 계속한다 — 전부 실패해야 0 이다
    }
    onProgress?.(Math.min(i + BATCH, todo.length), todo.length);
  }
  return filled;
}
