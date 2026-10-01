import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fixtureWorkspace, now } from "./fixtures";
vi.mock("../server", () => ({
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw new Error("db failed");
    return r.data;
  },
}));
import { sendDigest, collectForCompany } from "../automation";
import { normalizeG2b } from "../g2b";

/** 메모리 DB는 공급사 실패·재시도 흐름만 검증한다. 실제 RLS/트랜잭션은 SQL 스모크가 별도 검증. */
class FakeDb {
  tables: Record<string, Record<string, any>[]> = {
    procurement_runs: [],
    procurement_deliveries: [],
  };
  rpc = vi.fn().mockResolvedValue({ data: 0, error: null });
  from(table: string) {
    const records = (this.tables[table] ||= []);
    let action = "select",
      value: Record<string, any> = {},
      single = false;
    const filters: ((r: Record<string, any>) => boolean)[] = [];
    const chain: Record<string, any> = {
      select: () => chain,
      single: () => {
        single = true;
        return chain;
      },
      eq: (key: string, v: unknown) => {
        filters.push((r) => r[key] === v);
        return chain;
      },
      lt: (key: string, v: string) => {
        filters.push((r) => r[key] < v);
        return chain;
      },
      update: (v: Record<string, any>) => {
        action = "update";
        value = v;
        return chain;
      },
      insert: (v: Record<string, any>) => {
        action = "insert";
        value = v;
        return chain;
      },
      upsert: (v: Record<string, any>) => {
        action = "upsert";
        value = v;
        return chain;
      },
      then: (resolve: (v: unknown) => void) => {
        let data: Record<string, any>[] = records.filter((r) =>
          filters.every((f) => f(r)),
        );
        if (action === "insert") {
          if (
            table === "procurement_runs" &&
            records.some(
              (r) =>
                r.company_id === value.company_id &&
                r.kind === value.kind &&
                r.status === "running",
            )
          )
            return resolve({ data: null, error: { code: "23505" } });
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...value,
          };
          records.push(row);
          data = [row];
        } else if (action === "upsert") {
          const existing = records.find(
            (r) => r.delivery_key === value.delivery_key,
          );
          if (!existing)
            records.push({
              id: crypto.randomUUID(),
              created_at: now.toISOString(),
              ...value,
            });
          data = [];
        } else if (action === "update")
          data.forEach((r) => Object.assign(r, value));
        resolve({ data: single ? data[0] : data, error: null });
      },
    };
    return chain;
  }
}
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "QA <qa@example.com>");
  vi.stubEnv("G2B_SERVICE_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const recipientWs = () => ({
  ...fixtureWorkspace(),
  settings: {
    ...fixtureWorkspace().settings,
    recipients: ["qa-reviewer@example.com"],
  },
});
describe("공급사 접수·재시도·실패 구분", () => {
  it("공급사 접수번호가 있어야 발송 완료로 저장한다", async () => {
    const db = new FakeDb(),
      fetcher = vi.fn().mockResolvedValue(Response.json({ id: "provider-id" }));
    vi.stubGlobal("fetch", fetcher);
    await sendDigest(db as never, recipientWs(), now);
    expect(db.tables.procurement_deliveries[0]).toMatchObject({
      status: "sent",
      provider_id: "provider-id",
    });
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toContain(
      "2026-09-30",
    );
  });
  it("이미 발송한 일일 요약은 다시 보내지 않는다", async () => {
    const db = new FakeDb(),
      fetcher = vi.fn().mockResolvedValue(Response.json({ id: "provider-id" }));
    vi.stubGlobal("fetch", fetcher);
    await sendDigest(db as never, recipientWs(), now);
    await sendDigest(db as never, recipientWs(), now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.tables.procurement_deliveries).toHaveLength(1);
  });
  it("응답 유실 후에는 같은 발송 키·본문으로 재시도한다", async () => {
    const db = new FakeDb(),
      fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(Response.json({ id: "provider-id" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendDigest(db as never, recipientWs(), now)).rejects.toThrow(
      "응답을 확인하지 못했습니다",
    );
    expect(db.tables.procurement_deliveries[0].status).toBe("pending");
    await sendDigest(db as never, recipientWs(), now);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      fetcher.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
  it("미확정 발송의 수신자가 바뀌면 확인한 내용과 다른 메일을 보내지 않는다", async () => {
    const db = new FakeDb(),
      fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendDigest(db as never, recipientWs(), now)).rejects.toThrow();
    const changed = recipientWs();
    changed.settings.recipients = ["different@example.com"];
    await expect(sendDigest(db as never, changed, now)).rejects.toThrow(
      "현재 메일 내용이 다릅니다",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("오래된 미확정 요청은 중복 방지 시간 경과 후 재발송하지 않는다", async () => {
    const db = new FakeDb(),
      fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendDigest(db as never, recipientWs(), now)).rejects.toThrow();
    db.tables.procurement_deliveries[0].created_at = new Date(
      now.getTime() - 24 * 3600000,
    ).toISOString();
    await expect(sendDigest(db as never, recipientWs(), now)).rejects.toThrow(
      "오래된 미확정",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("HTTP 성공이라도 접수번호가 없으면 완료를 주장하지 않는다", async () => {
    const db = new FakeDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(sendDigest(db as never, recipientWs(), now)).rejects.toThrow(
      "접수번호",
    );
    expect(db.tables.procurement_runs.at(-1)?.status).toBe("failed");
    expect(db.tables.procurement_deliveries[0].status).toBe("pending");
  });
  it("발송 중인 작업이 있으면 중복 호출하지 않는다", async () => {
    const db = new FakeDb(),
      ws = recipientWs(),
      fetcher = vi.fn();
    db.tables.procurement_runs.push({
      id: "running",
      company_id: ws.company.id,
      kind: "digest",
      status: "running",
      created_at: new Date().toISOString(),
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(sendDigest(db as never, ws, now)).rejects.toThrow("실행 중");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("공고 재수집", () => {
  it("같은 메타데이터의 재수집은 보완한 원문을 지우지 않는다", async () => {
    const item = {
      bidNtceNo: "QA-001",
      bidNtceOrd: "000",
      bidNtceNm: "홍보 용역",
      dminsttNm: "QA 기관",
      bidNtceDt: "2026-09-30 09:00:00",
      bidClseDt: "2028-10-20 18:00:00",
      asignBdgtAmt: "100000000",
    };
    const n = normalizeG2b(item),
      ws = fixtureWorkspace(),
      db = new FakeDb();
    ws.notices = [
      {
        id: n.id,
        payload: { ...n, documents: ws.notices[0].payload.documents },
        content_hash: "hash",
        created_at: now.toISOString(),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          response: {
            header: { resultCode: "00" },
            body: { items: [item], totalCount: 1 },
          },
        }),
      ),
    );
    await collectForCompany(db as never, ws);
    expect(db.rpc).toHaveBeenCalledWith("procurement_ingest_batch", {
      p_company: ws.company.id,
      p_items: [],
    });
    expect(db.tables.procurement_runs.at(-1)?.status).toBe("completed");
  });
});
