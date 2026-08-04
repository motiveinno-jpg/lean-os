// CODEF 사용량 계측 공용 모듈 (2026-08-04) — codef-sync 인라인 계측(2026-07-03 phase 1)과 동일 규칙.
//   units       = 상품 API(/v1/kr/*) 성공(CF-00000) 호출 수 — CODEF 는 상품 조회 성공 건당 과금
//   total_calls = 관리 API(/v1/account/*, pop-bill)·실패 포함 전체 호출 수
//   meta.byPath = "경로:응답코드" 별 호출 수 (운영자 대시보드의 통장/카드/현금영수증 분류 근거)
// codef-sync 밖에서 CODEF 를 직접 호출하는 함수(cashbill-issue · cashbill-purchase-sync ·
// hometax-issue · codef-transfer)가 codef_usage 원장에 잡히도록 한다.
// 계측 실패는 절대 본 기능을 깨지 않는다(fail-open) — AsyncLocalStorage 미지원이면 조용히 비활성.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MeterStore = {
  calls: { path: string; code: string }[];
  companyId: string | null;
  action: string;
};

let usageALS: any = null;
try {
  const hooks = await import("node:async_hooks");
  usageALS = new hooks.AsyncLocalStorage();
} catch (_) {
  usageALS = null;
  console.error("[METER] AsyncLocalStorage unavailable — usage metering disabled");
}

export function createMeterStore(action: string): MeterStore {
  return { calls: [], companyId: null, action };
}

// 핸들러 본문을 감싸 이 invocation 의 CODEF 호출을 스토어로 수집한다.
export function runWithMeter<T>(store: MeterStore, fn: () => Promise<T>): Promise<T> {
  return usageALS ? usageALS.run(store, fn) : fn();
}

export function meterPush(path: string, code: string) {
  try {
    const s = usageALS?.getStore?.() as MeterStore | undefined;
    if (s) s.calls.push({ path, code });
  } catch (_) { /* 계측은 절대 본 기능을 깨지 않는다 */ }
}

export async function flushCodefUsage(store: MeterStore) {
  try {
    if (!store.calls.length) return;
    const units = store.calls.filter((c) => c.code === "CF-00000" && c.path.startsWith("/v1/kr/")).length;
    const byPath: Record<string, number> = {};
    for (const c of store.calls) {
      const k = `${c.path}:${c.code}`;
      byPath[k] = (byPath[k] || 0) + 1;
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await sb.from("codef_usage").insert({
      company_id: store.companyId,
      action: store.action || "unknown",
      units,
      total_calls: store.calls.length,
      meta: { byPath },
    });
  } catch (e: any) {
    // 테이블 장애 시에도 본 기능 응답은 정상 — 로그만
    console.error("[METER] codef_usage insert failed:", e?.message);
  }
}
