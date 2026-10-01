import { checked, workspace, type ProcurementDb } from "./server";
import { ProcurementError } from "./validation";
import {
  fingerprint,
  evidenceHash,
  noticeHash,
  workforceHash,
} from "./fingerprint";
import { callProcurementAI } from "./ai";
import { acquireNoticeDocuments } from "./attachments";
import type { Workspace } from "./types";
export async function enqueueJob(
  db: ProcurementDb,
  ws: Workspace,
  noticeId: string,
  kind: "analysis" | "proposal",
  userId: string | null,
  instructions = "",
) {
  const n = ws.notices.find((n) => n.id === noticeId);
  if (!n) throw new ProcurementError("현재 공고를 찾을 수 없습니다.", 409);
  if (
    n.payload.status === "cancelled" ||
    !n.payload.deadline ||
    Date.parse(n.payload.deadline) <= Date.now()
  )
    throw new ProcurementError(
      "취소·마감 공고는 신규 분석/제안 준비 대상으로 선택할 수 없습니다.",
      409,
    );
  const input = {
    instructions,
    contentHash: n.content_hash,
    evidenceHash: evidenceHash(ws.evidence, ws.company, ws.settings),
    workforceHash: workforceHash(ws),
  };
  checked(
    await db
      .from("procurement_jobs")
      .upsert(
        {
          company_id: ws.company.id,
          notice_id: noticeId,
          kind,
          input,
          created_by: userId,
          job_key: fingerprint({ noticeId, kind, ...input }),
        },
        { onConflict: "company_id,job_key", ignoreDuplicates: true },
      ),
  );
}
export async function processJob(
  db: ProcurementDb,
  companyId: string,
  jobId: string | null = null,
) {
  const claimed = checked(
    await (db as any).rpc("procurement_claim_job", {
      p_company: companyId,
      p_job: jobId,
    }),
  ) as {
    id: string;
    notice_id: string;
    kind: "analysis" | "proposal";
    created_by: string | null;
    input: {
      instructions: string;
      contentHash: string;
      evidenceHash: string;
      workforceHash: string;
    };
  } | null;
  if (!claimed) return { processed: false };
  try {
    let ws = await workspace(db, companyId);
    let row = ws.notices.find((n) => n.id === claimed.notice_id);
    if (
      !row ||
      row.content_hash !== claimed.input.contentHash ||
      evidenceHash(ws.evidence, ws.company, ws.settings) !==
        claimed.input.evidenceHash ||
      workforceHash(ws) !== claimed.input.workforceHash
    )
      throw new ProcurementError(
        "공고·회사·인력이 변경되어 작업을 중단했습니다. 최신 자료로 다시 요청하세요.",
        409,
      );
    if (
      row.payload.status === "cancelled" ||
      !row.payload.deadline ||
      Date.parse(row.payload.deadline) <= Date.now()
    )
      throw new ProcurementError("공고가 취소되거나 마감되었습니다.", 409);
    let issues: string[] = [];
    if (
      row.payload.attachments.some(
        (a) => !row!.payload.documents.some((d) => d.name === a.name),
      )
    ) {
      const acquired = await acquireNoticeDocuments(row.payload);
      issues = acquired.issues;
      if (noticeHash(acquired.notice) !== row.content_hash) {
        const id = checked(
          await (db as any).rpc("procurement_ingest_notice", {
            p_company: companyId,
            p_notice: acquired.notice,
            p_hash: noticeHash(acquired.notice),
          }),
        ) as string;
        ws = await workspace(db, companyId);
        row = ws.notices.find((n) => n.id === id);
        if (!row)
          throw new ProcurementError(
            "원문 갱신 후 공고를 찾지 못했습니다.",
            409,
          );
      }
    }
    const result = await callProcurementAI(
      claimed.kind,
      row.payload,
      ws,
      claimed.input.instructions,
    );
    const after = await workspace(db, companyId);
    if (
      !after.notices.some(
        (n) => n.id === row!.id && n.content_hash === row!.content_hash,
      ) ||
      evidenceHash(after.evidence, after.company, after.settings) !==
        claimed.input.evidenceHash ||
      workforceHash(after) !== claimed.input.workforceHash
    )
      throw new ProcurementError(
        "AI 처리 중 근거가 변경되었습니다. 최신 자료로 다시 요청하세요.",
        409,
      );
    checked(
      await db
        .from("procurement_artifacts")
        .upsert(
          {
            company_id: companyId,
            notice_id: row.id,
            job_id: claimed.id,
            kind: claimed.kind,
            content_hash: row.content_hash,
            evidence_hash: claimed.input.evidenceHash,
            workforce_hash: claimed.input.workforceHash,
            body: { ...result.data, sourceIssues: issues },
            provider_model: result.model,
            provider_usage: result.usage,
            created_by: claimed.created_by,
          },
          { onConflict: "job_id", ignoreDuplicates: true },
        ),
    );
    checked(
      await db
        .from("procurement_jobs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          error: null,
        })
        .eq("company_id", companyId)
        .eq("id", claimed.id),
    );
    return { processed: true, jobId: claimed.id };
  } catch (e) {
    const error =
      e instanceof ProcurementError
        ? e.message
        : "처리 실패. 원문·AI 설정과 실행 이력을 확인하세요.";
    checked(
      await db
        .from("procurement_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error,
        })
        .eq("company_id", companyId)
        .eq("id", claimed.id),
    );
    return { processed: true, jobId: claimed.id, error };
  }
}
