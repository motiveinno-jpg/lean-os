import { NextRequest, NextResponse } from 'next/server';
import { logServerError } from '@/lib/server-error-log';

// 첨부파일 다운로드 프록시 (2026-08-05 사장님 제보)
//   결재 문서 PDF 안의 첨부 링크를 PDF 뷰어(Edge/Chrome 내장)에서 클릭해 받으면
//   Supabase 가 보내는 Content-Disposition: filename=%EB%84%A4...(퍼센트 인코딩값)을
//   디코드하지 않고 그대로 저장해 파일명이 %EB%84%A4 범벅이 되는 문제.
//   Supabase 서명 URL 을 그대로 스트리밍하되 파일명 힌트를 우리가 3중으로 제어한다:
//   ① URL 마지막 경로조각 = 원본 파일명 (헤더를 아예 무시하는 뷰어 폴백)
//   ② filename="RAW UTF-8" (filename* 을 무시하는 구식 파서 폴백 — 크로뮴은 UTF-8 로 해석)
//   ③ filename*=UTF-8''... (표준 경로)
//   인가: u 는 우리 Supabase 의 storage 서명/공개 URL 만 허용 — 토큰 검증은 Supabase 가 한다.

// RFC 5987 ext-value 인코딩 — encodeURIComponent 가 남기는 '()*! 도 이스케이프
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  try {
    const u = request.nextUrl.searchParams.get('u') || '';
    const allowedPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !u.startsWith(allowedPrefix)) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '허용되지 않은 파일 URL 입니다' } }, { status: 400 });
    }

    const upstream = await fetch(u);
    if (!upstream.ok || !upstream.body) {
      // 서명 토큰 만료(1시간) 등 — Supabase 의 상태를 그대로 전달
      return NextResponse.json(
        { error: { code: 'UPSTREAM_ERROR', message: '파일을 불러올 수 없습니다. 링크가 만료됐다면 결재 문서 PDF 를 다시 저장해 주세요.' } },
        { status: upstream.status || 502 },
      );
    }

    const name = decodeURIComponent(filename).replace(/[/\\"]/g, '_');
    // 헤더는 latin1 바이트 열이어야 하므로 UTF-8 바이트를 latin1 문자열로 변환해 싣는다
    const rawUtf8Fallback = Buffer.from(name, 'utf8').toString('latin1');
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Content-Disposition', `attachment; filename="${rawUtf8Fallback}"; filename*=UTF-8''${rfc5987(name)}`);
    headers.set('Cache-Control', 'private, no-store');
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    // 예외처리 (2026-09-03): 업스트림 fetch 실패 등을 오류 기록장에 남기고 JSON 오류로 응답한다.
    await logServerError({ where: 'files-download', message: e instanceof Error ? e.message : String(e), context: { filename } });
    return NextResponse.json({ error: { code: 'DOWNLOAD_FAILED', message: '파일을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 502 });
  }
}
