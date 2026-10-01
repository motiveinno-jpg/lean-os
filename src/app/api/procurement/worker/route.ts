import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { workspace, type ProcurementDb } from "@/lib/procurement/server";
import { collectForCompany, sendDigest } from "@/lib/procurement/automation";

export const runtime = "nodejs";
export const maxDuration = 60;
/** 예약 실행기는 해당 회사만 처리한다. 배포 후 매시간 호출 연결; 비밀키·회사 범위 필수. */
export async function GET(req: Request) {
  const secret = process.env.PROCUREMENT_CRON_SECRET || "";
  const token = (req.headers.get("authorization") || "").replace(
    /^Bearer /,
    "",
  );
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(secret) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(token))
  )
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const companyId = process.env.PROCUREMENT_COMPANY_ID;
  if (process.env.PROCUREMENT_SCHEDULER_ENABLED !== "true" || !companyId)
    return NextResponse.json(
      { error: "예약 실행이 연결되지 않았습니다." },
      { status: 503 },
    );
  try {
    const db = createSupabaseAdminClient() as unknown as ProcurementDb;
    let ws = await workspace(db, companyId);
    if (!ws.ready || !ws.settings.collectionEnabled)
      return NextResponse.json({ status: "disabled" });
    if (!ws.integration.g2bVerified)
      return NextResponse.json(
        { error: "나라장터 실응답 검증이 필요합니다." },
        { status: 503 },
      );
    await collectForCompany(db, ws);
    ws = await workspace(db, companyId);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    if (ws.settings.digestEnabled && hour >= ws.settings.digestHour)
      await sendDigest(db, ws);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "예약 작업이 완료되지 않았습니다. 입찰 검토의 실행 이력을 확인하세요.",
      },
      { status: 502 },
    );
  }
}
