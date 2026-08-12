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

/**
 * ★ 법인은 **사업자등록번호 가운데 두 자리**로 안다 (2026-08-12 사장님 제보).
 *   국세청 상태조회의 tax_type 은 "부가가치세 일반과세자/간이과세자/면세사업자" 만 주고
 *   **법인·개인은 알려주지 않는다**. 그래서 법인이 전부 '일반'으로 표시됐다
 *   (실제: 조회한 198곳 중 82곳이 법인인데 전부 '일반'. 위하고와 어긋난 자리다).
 *   81~85 법인격(비영리·국가지자체·외국법인 포함) · 86~88 영리법인 → 법인으로 본다.
 *   89 는 법인격 없는 종교단체, 90~99 는 개인 면세사업자라 법인이 아니다.
 */
const CORP_MIDDLE = new Set(["81", "82", "83", "84", "85", "86", "87", "88"]);
export function isCorporateBizno(bizno?: string | null): boolean {
  const d = digits(bizno);
  return d.length === 10 && CORP_MIDDLE.has(d.slice(3, 5));
}

/** 번호와 국세청 원문을 함께 보고 구분을 정한다 — **번호 없이 tax_type 만으로는 법인을 못 가린다** */
export function merchantKindOf(bizno?: string | null, taxType?: string | null): MerchantKind | null {
  const t = String(taxType || "");
  //   간이·면세는 개인만 가능하니 법인 판정보다 앞이다
  if (t.includes("간이")) return "간이";
  if (t.includes("면세")) return "면세";
  if (isCorporateBizno(bizno)) return "법인";
  return kindOfTaxType(t);
}

/**
 * 이 가맹점에서 받은 **카드매출전표로 매입세액을 공제받을 수 있는가**.
 *   · 면세 → 못 받는다(애초에 부가세가 없다)
 *   · 간이 → 원칙적으로 못 받는다. **단 '세금계산서 발급사업자' 간이과세자는 받을 수 있다**
 *     (직전연도 공급대가 4,800만원 이상. 국세청이 tax_type 에 그렇게 적어 준다)
 *   · 그 밖(법인·일반) → 받을 수 있다
 */
export function isVatDeductibleMerchant(kind: MerchantKind | null, taxType?: string | null): boolean {
  if (kind === "면세") return false;
  if (kind === "간이") return String(taxType || "").includes("세금계산서");
  return true;
}

/** 화면이 알아야 할 가맹점 한 곳의 정보 */
export type MerchantInfo = { kind: MerchantKind | null; taxType: string | null; deductible: boolean };

/** 이미 조회해 둔 것 — 화면이 바로 그린다 */
export async function fetchMerchantKinds(companyId: string): Promise<Record<string, MerchantInfo>> {
  //   ⚠️ 새로 만든 표라 생성 타입(src/types/database.ts)에 아직 없다 — 저장소가 쓰는 방식대로 캐스팅한다.
  //     타입을 다시 뽑을 때 이 캐스팅을 걷어내면 된다.
  const data = logRead("merchant-tax-type:cache", await (supabase as any)
    .from("merchant_tax_types").select("bizno, kind, tax_type").eq("company_id", companyId));
  const m: Record<string, MerchantInfo> = {};
  for (const r of ((data as any[]) || [])) {
    //   저장된 kind 를 그대로 믿지 않고 번호로 한 번 더 본다 — 옛 행은 법인 판정 전에 저장된 것이다
    const kind = merchantKindOf(r.bizno, r.tax_type) ?? (r.kind as MerchantKind | null);
    m[r.bizno] = { kind, taxType: r.tax_type ?? null, deductible: isVatDeductibleMerchant(kind, r.tax_type) };
  }
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
        //   번호까지 보고 정한다 — tax_type 만으로는 법인을 못 가린다
        kind: merchantKindOf(digits(r.b_no), r.tax_type),
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
