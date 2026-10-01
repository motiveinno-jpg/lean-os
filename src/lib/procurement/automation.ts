import { checked, type ProcurementDb } from "./server";
import { fetchG2bNotices } from "./g2b";
import { evidenceHash, noticeHash, fingerprint } from "./fingerprint";
import { buildDigest, kstDay } from "./email";
import type { Workspace } from "./types";
import { ProcurementError } from "./validation";
import { enqueueJob } from "./jobs";
import { scopePrecheck } from "./scope";

async function beginRun(
  db: ProcurementDb,
  companyId: string,
  kind: "collect" | "digest",
): Promise<string> {
  // 중단된 작업은 15분 뒤 실패로 기록. 이후 실행이 재개되며 중복 실행은 유일 인덱스가 차단.
  checked(
    await db
      .from("procurement_runs")
      .update({
        status: "failed",
        summary: "실행이 15분 이상 완료되지 않아 재시도가 필요합니다.",
        finished_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("kind", kind)
      .eq("status", "running")
      .lt("created_at", new Date(Date.now() - 900000).toISOString()),
  );
  const res = await db
    .from("procurement_runs")
    .insert({ company_id: companyId, kind, status: "running" })
    .select("id")
    .single();
  if (res.error?.code === "23505")
    throw new ProcurementError(
      "같은 작업이 실행 중입니다. 완료 후 다시 확인하세요.",
      409,
    );
  return (checked(res) as { id: string }).id;
}
async function finishRun(
  db: ProcurementDb,
  id: string,
  status: "completed" | "failed",
  summary: string,
) {
  checked(
    await db
      .from("procurement_runs")
      .update({ status, summary, finished_at: new Date().toISOString() })
      .eq("id", id),
  );
}
export async function collectForCompany(db: ProcurementDb, ws: Workspace) {
  const key = process.env.G2B_SERVICE_KEY;
  const proxy = process.env.PROCUREMENT_G2B_PROXY === "true";
  if (!key && !proxy)
    throw new ProcurementError("나라장터 API 키를 서버에 설정하세요.", 503);
  const run = await beginRun(db, ws.company.id, "collect");
  try {
    const fetcher: typeof fetch = proxy
      ? async (input, init) => {
          const u = new URL(String(input));
          const parameters = Object.fromEntries(u.searchParams);
          delete parameters.serviceKey;
          return fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/procurement-g2b`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.PROCUREMENT_PROXY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ companyId: ws.company.id, parameters }),
              signal: init?.signal,
            },
          );
        }
      : fetch;
    const notices = await fetchG2bNotices(
      ws.settings.keywords,
      key || "edge-proxy",
      new Date(),
      fetcher,
    );
    const changed = notices.filter((notice) => {
      const previous = ws.notices.find(
        (n) =>
          n.payload.noticeNo === notice.noticeNo &&
          n.payload.revision === notice.revision,
      );
      // 목록 재수집이 사람이 보완한 동일 공고의 전문을 지우지 않게 메타데이터만 비교한다.
      return (
        !previous ||
        noticeHash({ ...previous.payload, documents: [] }) !==
          noticeHash(notice)
      );
    });
    checked(
      await (db as any).rpc("procurement_ingest_batch", {
        p_company: ws.company.id,
        p_items: changed.map((notice) => ({
          notice,
          hash: noticeHash(notice),
        })),
      }),
    );
    await finishRun(
      db,
      run,
      "completed",
      `최근 7일 게시 공고 ${notices.length}건 수집. 첨부 원문 확보·자격 상세 검토 대기. 정정·취소 전체 감시는 아직 활성화 전입니다.`,
    );
    if (ws.integration.ai) {
      const { workspace } = await import("./server");
      const latest = await workspace(db, ws.company.id);
      const candidates = latest.notices
        .filter(
          (n) =>
            n.payload.status !== "cancelled" &&
            n.payload.deadline &&
            Date.parse(n.payload.deadline) > Date.now(),
        )
        .sort(
          (a, b) =>
            scopePrecheck(b.payload, latest.evidence).tasks.filter(
              (t) => t.evidence.length,
            ).length -
            scopePrecheck(a.payload, latest.evidence).tasks.filter(
              (t) => t.evidence.length,
            ).length,
        )
        .slice(0, 5);
      for (const n of candidates)
        await enqueueJob(db, latest, n.id, "analysis", null);
    }
  } catch (e) {
    await finishRun(
      db,
      run,
      "failed",
      e instanceof ProcurementError
        ? e.message
        : "공고 저장 중 실패했습니다. 전체 범위를 재수집해야 합니다.",
    );
    throw e;
  }
}
export async function sendDigest(
  db: ProcurementDb,
  ws: Workspace,
  now = new Date(),
) {
  const apiKey = process.env.RESEND_API_KEY,
    from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !ws.settings.recipients.length)
    throw new ProcurementError(
      "메일 발신 설정과 수신자를 먼저 준비하세요.",
      503,
    );
  const run = await beginRun(db, ws.company.id, "digest");
  try {
    const deliveryKey = `procurement:${ws.company.id}:${kstDay(now)}`;
    const content = buildDigest(
      ws,
      evidenceHash(ws.evidence, ws.company, ws.settings),
      now,
    );
    const inserted = await db.from("procurement_deliveries").upsert(
      {
        company_id: ws.company.id,
        delivery_key: deliveryKey,
        status: "pending",
        recipients: ws.settings.recipients,
        from_email: from,
        ...content,
      },
      { onConflict: "delivery_key", ignoreDuplicates: true },
    );
    checked(inserted);
    const delivery = checked(
      await db
        .from("procurement_deliveries")
        .select("id,status,recipients,from_email,subject,html,created_at")
        .eq("company_id", ws.company.id)
        .eq("delivery_key", deliveryKey)
        .single(),
    ) as {
      id: string;
      status: string;
      recipients: string[];
      from_email: string;
      subject: string;
      html: string;
      created_at: string;
    };
    if (delivery.status === "sent") {
      await finishRun(
        db,
        run,
        "completed",
        "오늘 메일은 이미 발송되었습니다. 중복 발송하지 않았습니다.",
      );
      return;
    }
    if (
      fingerprint({
        from: delivery.from_email,
        recipients: delivery.recipients,
        subject: delivery.subject,
        html: delivery.html,
      }) !==
      fingerprint({ from, recipients: ws.settings.recipients, ...content })
    ) {
      throw new ProcurementError(
        "이전 발송 요청과 현재 메일 내용이 다릅니다. 공급사 발송 이력을 대조한 뒤 재처리하세요.",
        409,
      );
    }
    if (now.getTime() - Date.parse(delivery.created_at) > 23 * 3600000)
      throw new ProcurementError(
        "오래된 미확정 메일은 공급사 발송 이력 대조 후 재처리해야 합니다.",
        409,
      );
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": deliveryKey,
        },
        body: JSON.stringify({
          from: delivery.from_email,
          to: delivery.recipients,
          subject: delivery.subject,
          html: delivery.html,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProcurementError(
        "메일 공급사 응답을 확인하지 못했습니다. 재시도 시 같은 발송 키를 사용합니다.",
        502,
      );
    }
    if (!res.ok)
      throw new ProcurementError(
        "메일 공급사가 발송을 수락하지 않았습니다. 발신 도메인·수신자·사용량을 확인하세요.",
        502,
      );
    const result = (await res.json()) as { id?: string };
    if (!result.id)
      throw new ProcurementError(
        "메일 접수번호가 없습니다. 공급사 발송 이력을 확인해야 합니다.",
        502,
      );
    checked(
      await db
        .from("procurement_deliveries")
        .update({
          status: "sent",
          provider_id: result.id,
          sent_at: now.toISOString(),
          error: null,
        })
        .eq("id", delivery.id),
    );
    await finishRun(
      db,
      run,
      "completed",
      `메일 공급사 접수 완료. ${delivery.recipients.length}명 대상. 실제 수신·반송 여부는 공급사 이력에서 확인합니다.`,
    );
  } catch (e) {
    await finishRun(
      db,
      run,
      "failed",
      e instanceof ProcurementError
        ? e.message
        : "메일 처리 중 오류. 발송 이력 대조 필요.",
    );
    throw e;
  }
}
