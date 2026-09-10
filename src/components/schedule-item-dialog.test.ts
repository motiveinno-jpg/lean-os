// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), toggle: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/queries", () => ({ getCompanyUsers: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-modal-keys", () => ({ useModalKeys: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({ resolveSignedUrl: vi.fn() }));
vi.mock("@/lib/schedule", async (original) => ({ ...await original<object>(), toggleEventCompleted: mocks.toggle, upsertEvent: mocks.save }));
import { ScheduleItemDialog } from "./schedule-item-dialog";
import { draftFromEvent } from "./schedule-item-editor";
import type { ScheduleEvent } from "@/lib/schedule";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const event = { id: "event", company_id: "company", user_id: "owner", title: "회의", visibility: "company", start_at: "2026-09-09T15:00:00Z", end_at: null, color: "blue", completed: false, attachments: [] } as unknown as ScheduleEvent;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
async function render(userId: string) {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(ScheduleItemDialog, { companyId: "company", userId, target: { mode: "view", event }, onClose: vi.fn() }))));
}
describe("일정 상세 실제 컴포넌트", () => {
  it("공유받은 일정에는 쓰기 버튼을 렌더하지 않는다", async () => {
    await render("reader");
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("수정"); expect(buttons).not.toContain("완료 처리"); expect(buttons).not.toContain("삭제");
    expect(container.textContent).toContain("읽기 전용");
  });
  it("작성자의 완료 클릭은 마이페이지 캐시도 갱신한다", async () => {
    mocks.toggle.mockResolvedValue(undefined);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await render("owner");
    const done = [...container.querySelectorAll("button")].find((b) => b.textContent === "완료 처리")!;
    expect(done).toBeTruthy();
    await act(async () => { done.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(mocks.toggle).toHaveBeenCalledWith("event", true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["my-todos-open"] });
  });
  it("한국 자정 일정 편집은 전날로 밀리지 않는다", () => {
    expect(draftFromEvent(event).from).toBe("2026-09-10");
  });
  it("반복 회차 편집은 원본 날짜를 사용한다", () => {
    expect(draftFromEvent({ ...event, id: "event@2026-09-10", recurrence_source: { start_at: "2026-08-02T15:00:00Z", end_at: null } }).from).toBe("2026-08-03");
  });
});
