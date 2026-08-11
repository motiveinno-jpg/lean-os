// 접속자 IP 조회 — 회사별 허용 IP 제한(옵션 기능)의 판정 재료 (2026-08-11).
//   Vercel 이 세팅하는 x-forwarded-for 의 첫 값이 실제 클라이언트 IP.
//   판정 자체는 클라이언트 IpGate 가 company_settings 의 허용 목록과 대조해서 한다.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  return NextResponse.json({ ip });
}
