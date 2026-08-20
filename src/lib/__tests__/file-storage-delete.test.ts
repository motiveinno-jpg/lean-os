// 파일보관함 삭제 권한 — deleteFile 가드 회귀 방지 (2026-08-20 사장님:
//   "본인이 올린거랑 권한이 있는 사람만 삭제가 가능하게").
//   진짜 차단은 RLS(document_files_delete_owner_or_perm)지만, 화면이 넘기는 판정과
//   삭제 순서(행 먼저 → 실물)가 어긋나면 '파일만 사라지고 목록엔 남는' 깨진 상태가 된다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    file: null as Record<string, any> | null,
    rowDeleted: false,
    storageRemoved: [] as string[],
    order: [] as string[],       // 실제 호출 순서 — 행 먼저인지 확인
    rowDeleteError: null as { message: string } | null,
  };
  function chain() {
    const s: any = { op: "select" };
    const respond = () => {
      if (s.op === "delete") {
        state.order.push("row");
        if (state.rowDeleteError) return { data: null, error: state.rowDeleteError };
        state.rowDeleted = true;
        return { data: null, error: null };
      }
      return { data: state.file, error: state.file ? null : { message: "not found" } };
    };
    const api: any = {
      select: () => api,
      delete: () => { s.op = "delete"; return api; },
      eq: () => api,
      single: () => api,
      maybeSingle: () => api,
      then: (res: any, rej: any) => Promise.resolve(respond()).then(res, rej),
    };
    return api;
  }
  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        state.order.push("storage");
        state.storageRemoved.push(...paths);
        return { error: null };
      },
    }),
  };
  return { state, chain, storage };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => h.chain(), storage: h.storage },
}));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(() => Promise.resolve()) }));

import { deleteFile } from "@/lib/file-storage";

const st = h.state;
const ME = "user-me";
const OTHER = "user-other";
const FILE = {
  id: "f-1", file_name: "계약서.pdf", file_size: 10, mime_type: "application/pdf",
  bucket: "document-files", storage_path: "co-1/folders/x/1_abc.pdf",
};

beforeEach(() => {
  st.file = { ...FILE, uploaded_by: ME };
  st.rowDeleted = false;
  st.storageRemoved = [];
  st.order = [];
  st.rowDeleteError = null;
});

describe("deleteFile — 본인 파일만 삭제", () => {
  it("본인이 올린 파일은 지워진다", async () => {
    await deleteFile("f-1", ME, "co-1");
    expect(st.rowDeleted).toBe(true);
    expect(st.storageRemoved).toEqual([FILE.storage_path]);
  });

  it("남이 올린 파일은 막히고, 실물도 건드리지 않는다", async () => {
    st.file = { ...FILE, uploaded_by: OTHER };
    await expect(deleteFile("f-1", ME, "co-1")).rejects.toThrow(/본인이 올린 파일만/);
    expect(st.rowDeleted).toBe(false);
    expect(st.storageRemoved).toEqual([]);   // ← 실물이 먼저 지워지면 안 된다
  });

  it("삭제 권한을 받은 사람은 남의 파일도 지운다", async () => {
    st.file = { ...FILE, uploaded_by: OTHER };
    await deleteFile("f-1", ME, "co-1", { canDeleteOthers: true });
    expect(st.rowDeleted).toBe(true);
    expect(st.storageRemoved).toEqual([FILE.storage_path]);
  });

  it("DB 행을 먼저 지우고 그 다음 실물 — 순서가 바뀌면 RLS 차단 시 파일만 사라진다", async () => {
    await deleteFile("f-1", ME, "co-1");
    expect(st.order).toEqual(["row", "storage"]);
  });

  it("RLS 가 행 삭제를 막으면 실물은 남는다(깨진 상태 방지)", async () => {
    st.rowDeleteError = { message: "new row violates row-level security policy" };
    await expect(deleteFile("f-1", ME, "co-1")).rejects.toBeTruthy();
    expect(st.storageRemoved).toEqual([]);
  });
});
