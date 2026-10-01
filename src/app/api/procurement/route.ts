import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api-authz";
import { authorize, checked, workspace } from "@/lib/procurement/server";
import {
  object,
  text,
  parseNotice,
  parseReview,
  parseEvidence,
  parseEvidenceImport,
  parseSettings,
  ProcurementError,
} from "@/lib/procurement/validation";
import {
  noticeHash,
  evidenceHash,
  fingerprint,
} from "@/lib/procurement/fingerprint";
import { evaluate, draftPlan } from "@/lib/procurement/core";
import { collectForCompany, sendDigest } from "@/lib/procurement/automation";
import { buildDigest } from "@/lib/procurement/email";

export const runtime = "nodejs";
export const maxDuration = 60;
function fail(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof ProcurementError
          ? error.message
          : "처리 중 오류가 발생했습니다. 요청 내용을 확인하세요.",
    },
    {
      status: error instanceof ProcurementError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function GET(req: Request) {
  try {
    const { db, companyId } = await authorize();
    const ws = await workspace(db, companyId);
    const content = buildDigest(
      ws,
      evidenceHash(ws.evidence, ws.company, ws.settings),
    );
    const data =
      new URL(req.url).searchParams.get("view") === "digest"
        ? {
            ...content,
            previewHash: fingerprint({
              ...content,
              recipients: ws.settings.recipients,
              from: process.env.RESEND_FROM_EMAIL || "",
            }),
          }
        : ws;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  const csrf = assertSameOrigin(req);
  if (csrf) return csrf;
  try {
    const { db, companyId, userId } = await authorize();
    if (Number(req.headers.get("content-length") || 0) > 2500000)
      throw new ProcurementError("요청은 2.5MB 이하여야 합니다.", 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 2500000)
      throw new ProcurementError("요청은 2.5MB 이하여야 합니다.", 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProcurementError("JSON 형식을 확인하세요.");
    }
    const body = object(parsed),
      action = text(body.action, "작업", 40);
    const ws = await workspace(db, companyId);
    if (!ws.ready)
      throw new ProcurementError("저장소 준비 후 사용할 수 있습니다.", 503);
    if (action === "import-evidence") {
      const items = parseEvidenceImport(
        body.bundle,
        ws.company.business_number,
      );
      checked(
        await (db as any).rpc("procurement_import_evidence", {
          p_company: companyId,
          p_user: userId,
          p_items: items.map((e) => ({
            payload: e,
            import_key: fingerprint({
              category: e.category,
              title: e.title,
              text: e.text,
              source: e.source,
              project: e.project || null,
            }),
          })),
        }),
      );
    } else if (action === "settings") {
      const settings = parseSettings(body.settings);
      if (settings.collectionEnabled && !ws.integration.g2b)
        throw new ProcurementError(
          "나라장터 API 인증키를 서버에 설정해야 자동수집을 켤 수 있습니다.",
        );
      if (
        settings.collectionEnabled &&
        (!ws.integration.g2bVerified || !ws.integration.scheduler)
      )
        throw new ProcurementError(
          "실제 나라장터 응답 검증과 예약 실행 연결 후 자동수집을 켤 수 있습니다.",
        );
      if (
        settings.digestEnabled &&
        (!ws.integration.mail || !ws.integration.scheduler)
      )
        throw new ProcurementError(
          "메일 발신 설정과 예약 실행 연결 후 자동발송을 켤 수 있습니다.",
        );
      checked(
        await db.from("procurement_settings").upsert({
          company_id: companyId,
          settings,
          updated_at: new Date().toISOString(),
        }),
      );
    } else if (action === "evidence") {
      const evidence = parseEvidence(body.evidence);
      if (
        evidence.documentFileId &&
        !ws.files.some((f) => f.id === evidence.documentFileId)
      )
        throw new ProcurementError(
          "현재 회사의 오너뷰 파일만 연결할 수 있습니다.",
          403,
        );
      if (evidence.verified) evidence.verifiedAt = new Date().toISOString();
      checked(
        await db.from("procurement_evidence").insert({
          id: evidence.id,
          company_id: companyId,
          payload: evidence,
          created_by: userId,
        }),
      );
    } else if (action === "revoke-evidence") {
      const id = text(body.evidenceId, "증빙 ID", 100);
      const evidence = ws.evidence.find((e) => e.id === id);
      if (!evidence)
        throw new ProcurementError("현재 회사의 증빙을 찾을 수 없습니다.", 404);
      const revokedReason = text(body.note, "검증 철회 이유", 3000);
      checked(
        await db
          .from("procurement_evidence")
          .update({
            payload: {
              ...evidence,
              verified: false,
              verifiedAt: null,
              revokedReason,
              revokedAt: new Date().toISOString(),
              revokedBy: userId,
            },
          })
          .eq("company_id", companyId)
          .eq("id", id),
      );
    } else if (action === "notice") {
      const notice = parseNotice(body.notice);
      checked(
        await (db as any).rpc("procurement_ingest_notice", {
          p_company: companyId,
          p_notice: notice,
          p_hash: noticeHash(notice),
        }),
      );
    } else if (action === "review" || action === "decision") {
      const noticeId = text(body.noticeId, "공고 ID", 100);
      const row = ws.notices.find((n) => n.id === noticeId);
      if (!row)
        throw new ProcurementError(
          "최신 공고를 찾을 수 없습니다. 목록을 새로고침하세요.",
          409,
        );
      const basis = evidenceHash(ws.evidence, ws.company, ws.settings);
      if (action === "review") {
        const review = parseReview(body.review);
        const assessment = evaluate(
          row.payload,
          review,
          ws.evidence,
          ws.settings.minimumScore,
        );
        checked(
          await db.from("procurement_reviews").insert({
            company_id: companyId,
            notice_id: row.id,
            content_hash: row.content_hash,
            evidence_hash: basis,
            basis_snapshot: {
              company: ws.company,
              evidence: ws.evidence,
              minimumScore: ws.settings.minimumScore,
            },
            review,
            assessment,
            created_by: userId,
          }),
        );
      } else {
        const reviewId = text(body.reviewId, "평가 ID", 100);
        const latest = ws.reviews.find((r) => r.notice_id === row.id);
        if (
          !latest ||
          latest.id !== reviewId ||
          latest.evidence_hash !== basis ||
          latest.content_hash !== row.content_hash
        )
          throw new ProcurementError(
            "공고 또는 회사 자료가 변경되었습니다. 다시 평가하세요.",
            409,
          );
        const decision = text(body.decision, "결정", 20);
        if (!["proceed", "hold", "decline"].includes(decision))
          throw new ProcurementError("진행·보류·제외 중 하나를 선택하세요.");
        const assessment = evaluate(
          row.payload,
          latest.review,
          ws.evidence,
          ws.settings.minimumScore,
        );
        if (
          decision === "proceed" &&
          (assessment.eligibility !== "eligible" ||
            !["recommend", "consider"].includes(assessment.recommendation))
        )
          throw new ProcurementError(
            "진행 결정 전에 자격과 평가 근거를 확인하세요.",
            409,
          );
        checked(
          await (db as any).rpc("procurement_decide", {
            p_company: companyId,
            p_notice: row.id,
            p_review: latest.id,
            p_evidence_hash: basis,
            p_decision: decision,
            p_note: text(body.note, "결정 사유", 3000),
            p_user: userId,
            p_content: draftPlan(
              ws.company,
              row.payload,
              latest.review,
              assessment,
            ),
            p_snapshot: {
              company: ws.company,
              evidence: [...ws.evidence].sort((a, b) =>
                a.id.localeCompare(b.id),
              ),
              minimumScore: ws.settings.minimumScore,
            },
          }),
        );
      }
    } else if (action === "collect") {
      await collectForCompany(db, ws);
    } else if (action === "send-digest") {
      if (body.confirmSend !== true)
        throw new ProcurementError("수신자와 본문 확인 후 발송하세요.");
      const content = buildDigest(
        ws,
        evidenceHash(ws.evidence, ws.company, ws.settings),
      );
      if (
        body.previewHash !==
        fingerprint({
          ...content,
          recipients: ws.settings.recipients,
          from: process.env.RESEND_FROM_EMAIL || "",
        })
      )
        throw new ProcurementError(
          "메일 내용 또는 수신자가 변경되었습니다. 미리보기를 다시 확인하세요.",
          409,
        );
      await sendDigest(db, ws);
    } else throw new ProcurementError("지원하지 않는 작업입니다.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
