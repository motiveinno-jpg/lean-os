// P0-9: 공개 상태 페이지 (/status). /api/health 결과 시각화.
//   외부 uptime 감시(UptimeRobot 등) 는 /api/health 를 모니터링하면 충분 —
//   이 페이지는 사람 눈으로 즉시 보기 위함.
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function fetchHealth() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('host');
  const base = host ? `${proto}://${host}` : '';
  try {
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    return { http: res.status, body: await res.json() };
  } catch (e: unknown) {
    return { http: 0, body: { status: 'unhealthy', error: e instanceof Error ? e.message : String(e), checks: {} } };
  }
}

type CheckMap = Record<string, { ok: boolean; ms?: number; note?: string }>;

export default async function StatusPage() {
  const { http, body } = await fetchHealth();
  const status: string = body?.status ?? 'unknown';
  const checks: CheckMap = body?.checks ?? {};

  const color = status === 'healthy' ? '#16a34a' : status === 'degraded' ? '#f59e0b' : '#dc2626';
  const label = status === 'healthy' ? '정상' : status === 'degraded' ? '부분 장애' : '장애';

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>OwnerView 상태</h1>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {body?.timestamp ? new Date(body.timestamp).toLocaleString('ko-KR') : ''} · HTTP {http}
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: color, color: 'white', fontWeight: 700, marginBottom: 24 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'white', display: 'inline-block' }} />
        {label}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {Object.entries(checks).map(([name, c]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.ok ? '#16a34a' : '#dc2626', display: 'inline-block' }} />
              <strong style={{ fontSize: 14 }}>{name.toUpperCase()}</strong>
              {typeof c.ms === 'number' && <span style={{ fontSize: 11, color: '#6b7280' }}>{c.ms}ms</span>}
            </div>
            <div style={{ fontSize: 12, color: c.ok ? '#16a34a' : '#dc2626' }}>
              {c.ok ? 'OK' : (c.note || 'FAIL')}
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 24, fontSize: 11, color: '#9ca3af' }}>
        외부 모니터링: UptimeRobot/Pingdom 등에서 <code>/api/health</code> 를 1분 간격으로 폴링하세요.
        HTTP 503 또는 status=&quot;unhealthy&quot; 시 알림(P0-1 텔레그램 채널)으로 라우팅.
      </p>
    </main>
  );
}
