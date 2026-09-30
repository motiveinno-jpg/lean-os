import { describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    const query: any = { then: (resolve: any) => Promise.resolve({ data: fixtures.tables[table] || [], error: null }).then(resolve) };
    for (const method of ["select", "eq", "in", "or", "order", "limit"]) query[method] = () => query;
    return query;
  },
} }));
vi.mock("@/lib/log-read", () => ({ logRead: (_tag: string, result: any) => result.data }));
import { fetchSyncHistory } from "@/lib/collect";

describe("수집 이력에 홈택스 결과 포함", () => {
  it("은행과 홈택스 성공·실패를 완료 시각순으로 보여주고 같은 작업을 중복 표시하지 않는다", async () => {
    fixtures.tables = {
      users: [{ id: "user-a", auth_id: "auth-a", name: "회계담당자" }],
      sync_logs: [
        { id: "bank-a", sync_type: "codef_bank", status: "success", details: { bank: { synced: 12 } }, created_at: "2026-09-30T02:16:00Z", synced_by: "auth-a" },
        { id: "duplicate", sync_type: "codef_hometax", status: "success", details: { job: "tax-a", hometax: { synced: 290 } }, created_at: "2026-09-30T02:19:00Z", synced_by: "auth-a" },
      ],
      hometax_sync_jobs: [
        { id: "tax-a", job_type: "tax_invoice", status: "completed", total_synced: 290, errors: [], triggered_by: "user-a", completed_at: "2026-09-30T02:19:00Z", created_at: "2026-09-30T02:15:00Z" },
        { id: "cash-a", job_type: "cash_receipt", status: "failed", total_synced: 0, errors: [{ hint: "인증서를 다시 등록하세요" }], triggered_by: "user-a", completed_at: "2026-09-30T02:20:00Z", created_at: "2026-09-30T02:19:30Z" },
      ],
    };
    const history = await fetchSyncHistory("company-a");
    expect(history.map((h) => h.id)).toEqual(["job:cash-a", "job:tax-a", "bank-a"]);
    expect(history[0]).toMatchObject({ what: "현금영수증", status: "error", note: "인증서를 다시 등록하세요", by: "회계담당자" });
    expect(history[1]).toMatchObject({ what: "전자세금계산서", count: 290, status: "success", note: "처리 건수 · 기존 자료 확인 포함" });
    expect(history[2]).toMatchObject({ what: "통장", count: 12, by: "회계담당자" });
    expect(await fetchSyncHistory("company-a", 1)).toHaveLength(1);
  });
});
