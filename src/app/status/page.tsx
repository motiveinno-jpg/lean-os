// 공개 상태 페이지 (/status) — /api/health 결과를 사람이 읽는 말로 보여 준다.
//   머리·바닥·글꼴은 다른 공개 페이지와 같은 site-shell(.lp8)을 쓴다.
//   점검 항목 이름은 아래 CHECK_LABELS 에서만 정한다 — /api/health 에 항목이 늘면 여기에도 이름을 붙인다
//   (이름이 없는 항목은 내부 키가 그대로 드러나지 않게 목록에서 뺀다).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import '@/app/landing-v8.css';
import { SiteFooter, SiteHeader } from '@/components/landing-v8/site-shell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '서비스 상태',
  description: '오너뷰 서비스와 결제·자동 수집 경로가 지금 정상인지 확인합니다.',
};

type Check = { ok: boolean; ms?: number; note?: string };

/** /api/health 의 점검 키 → 화면 이름·설명. 순서도 이 차례를 따른다 */
const CHECK_LABELS: { key: string; name: string; desc: string }[] = [
  { key: 'db', name: '서비스 데이터베이스', desc: '로그인·자료 조회·저장' },
  { key: 'toss', name: '국내 카드 결제', desc: '토스페이먼츠 결제 서버 응답' },
  { key: 'stripe', name: '해외 카드 결제', desc: 'Stripe 결제 서버 응답' },
  { key: 'codef', name: '은행·카드 자동 수집', desc: '최근 하루 안에 정기 수집이 돌았는지' },
];

async function fetchHealth(): Promise<{ status: string; timestamp?: string; checks: Record<string, Check>; limited: boolean }> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('host');
  const base = host ? `${proto}://${host}` : '';
  try {
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (res.status === 429) return { status: 'unknown', checks: {}, limited: true };
    const body = await res.json();
    return { status: body?.status ?? 'unknown', timestamp: body?.timestamp, checks: body?.checks ?? {}, limited: false };
  } catch {
    return { status: 'unhealthy', checks: {}, limited: false };
  }
}

const SUMMARY: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  healthy: { label: '모든 서비스가 정상입니다', tone: 'ok' },
  degraded: { label: '일부 서비스가 지연되고 있습니다', tone: 'warn' },
  unhealthy: { label: '서비스에 장애가 있습니다', tone: 'bad' },
};

export default async function StatusPage() {
  const { status, timestamp, checks, limited } = await fetchHealth();
  const summary = limited
    ? { label: '잠시 후 다시 확인해 주세요', tone: 'warn' as const }
    : SUMMARY[status] ?? { label: '상태를 확인하지 못했습니다', tone: 'warn' as const };
  const rows = CHECK_LABELS.filter((c) => checks[c.key]).map((c) => ({ ...c, check: checks[c.key] }));

  return (
    <div className="lp8">
      <SiteHeader />
      <main className="st8">
        <div className="container st8-in">
          <p className="tl8-eyebrow">서비스 상태</p>
          <h1 className="st8-h1">오너뷰 서비스 상태</h1>
          <div className={`st8-badge st8-${summary.tone}`}>
            <i aria-hidden="true" />
            {summary.label}
          </div>
          {timestamp && (
            <p className="st8-time">
              {new Date(timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 기준
            </p>
          )}

          {rows.length > 0 && (
            <ul className="st8-list">
              {rows.map(({ key, name, desc, check }) => (
                <li key={key}>
                  <span className={`st8-dot ${check.ok ? 'st8-ok' : 'st8-bad'}`} aria-hidden="true" />
                  <div className="st8-name">
                    <b>{name}</b>
                    <small>{desc}</small>
                  </div>
                  <span className={`st8-state ${check.ok ? 'st8-ok' : 'st8-bad'}`}>{check.ok ? '정상' : '문제 있음'}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="st8-note">
            문제가 계속되면 <a href="mailto:creative@mo-tive.com">creative@mo-tive.com</a> 으로 알려 주세요.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
