// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ runCollect: vi.fn(), waitForJob: vi.fn(), toast: vi.fn(), companyId: "company-a" }));
vi.mock("@/lib/collect", () => ({
  runCollect: mocks.runCollect, waitForJob: mocks.waitForJob,
  SOURCES: [{ key: "bank", label: "통장" }, { key: "card", label: "신용카드" }],
}));
vi.mock("@/components/user-context", () => ({ useUser: () => ({ user: { company_id: mocks.companyId } }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("next/link", () => ({ default: (props: any) => createElement("a", props) }));

let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
let store: typeof import("@/lib/collect-run");
let Notice: typeof import("@/components/collect-run-notice").CollectRunNotice;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.companyId = "company-a";
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store = await import("@/lib/collect-run");
  Notice = (await import("@/components/collect-run-notice")).CollectRunNotice;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); container.remove(); });
const render = async (page: string) => {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc },
    createElement(Notice), createElement("main", { key: page }, page))));
};

describe("화면 이동 후에도 남는 수집 결과", () => {
  it("다른 메뉴에서 완료를 알리고 캐시를 갱신하며 확인할 때까지 결과를 남긴다", async () => {
    let opts: any;
    let finish!: () => void;
    mocks.runCollect.mockImplementation((o) => { opts = o; return new Promise<void>((r) => { finish = r; }); });
    const keys = ["collect-status", "collect-history", "collect-rows", "bank-rows", "sync-cooldowns"];
    for (const key of keys) {
      qc.setQueryData([key, "company-a"], "old");
      qc.setQueryData([key, "company-b"], "other company");
    }
    await render("수집 화면");
    await act(async () => { store.startCollect({ companyId: "company-a", sources: ["bank", "card"], startDate: "2026-09-01", endDate: "2026-09-30" }); });
    await render("대시보드");
    expect(container.textContent).toContain("자료 수집 중");
    await act(async () => { opts.onChange("bank", { phase: "done", synced: 12 }); });
    expect(container.textContent).toContain("1/2종 완료");
    expect(qc.getQueryState(["bank-rows", "company-a"])?.isInvalidated).toBe(true);
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => { opts.onChange("card", { phase: "done", synced: 0 }); finish(); });
    expect(container.textContent).toContain("자료 수집 완료");
    expect(container.textContent).toContain("통장: 12건 처리 완료");
    expect(container.textContent).toContain("신용카드: 0건 처리 완료");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    for (const key of keys) {
      expect(qc.getQueryState([key, "company-a"])?.isInvalidated).toBe(true);
      expect(qc.getQueryState([key, "company-b"])?.isInvalidated).toBe(false);
    }
    await render("직원 관리");
    expect(container.textContent).toContain("자료 수집 완료");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "확인했어요")!;
    await act(async () => button.click());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("새로고침 뒤 다른 메뉴에서도 서버 결과를 이어 확인하고 실패를 성공으로 표시하지 않는다", async () => {
    localStorage.setItem("collect-run", JSON.stringify({
      running: true, companyId: "company-a", sources: ["bank"], startedAt: Date.now(), finishedAt: null,
      state: { bank: { phase: "running", jobId: "job-a" } },
    }));
    mocks.waitForJob.mockResolvedValue({ synced: 0, error: "은행 인증 만료" });
    await render("대시보드");
    expect(mocks.waitForJob).toHaveBeenCalledWith("job-a", expect.any(Function));
    expect(container.textContent).toContain("자료 수집 종료 · 1종 실패");
    expect(container.textContent).toContain("은행 인증 만료");
    expect(container.textContent).not.toContain("자료 수집 완료");
  });

  it("다른 회사 스냅샷을 복원하거나 노출하지 않는다", async () => {
    localStorage.setItem("collect-run", JSON.stringify({
      running: true, companyId: "company-b", sources: ["bank"], startedAt: Date.now(), finishedAt: null,
      state: { bank: { phase: "running", jobId: "job-b" } },
    }));
    await render("대시보드");
    expect(mocks.waitForJob).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("완료 결과는 새로고침 후에도 남고 이미 확인한 결과는 다시 띄우지 않는다", async () => {
    const startedAt = Date.now() - 120_000;
    localStorage.setItem("collect-run", JSON.stringify({
      running: false, companyId: "company-a", sources: ["bank"], startedAt, finishedAt: startedAt + 1000,
      state: { bank: { phase: "done", synced: 12 } },
    }));
    await render("대시보드");
    expect(container.textContent).toContain("자료 수집 완료");
    await act(async () => container.querySelector("button")!.click());
    expect(localStorage.getItem("collect-notice-dismissed:company-a")).toBe(`company-a:${startedAt}`);
    // 셸까지 다시 마운트해도 확인한 결과를 되살리지 않는다.
    await act(async () => root.render(null));
    await render("직원 관리");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
