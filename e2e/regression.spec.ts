import { test, expect, Page } from '@playwright/test';

// ─── Config ───
const OV_SB_URL = 'https://njbvdkuvtdtkxyylwngn.supabase.co';
const OV_SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho';

function trackJsErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

// ═══════════════════════════════════════
// FLOW 1: 전 페이지 로드 + JS 에러 없음
// ═══════════════════════════════════════
test.describe('Flow 1: Page Load & Zero JS Errors', () => {
  const pages = [
    { name: '메인', path: '/' },
    { name: '로그인', path: '/auth' },
    { name: '이용약관', path: '/terms' },
    { name: '개인정보처리방침', path: '/privacy' },
    { name: '환불규정', path: '/refund' },
  ];

  for (const p of pages) {
    test(`${p.name} (${p.path}) — 200 + no JS errors`, async ({ page }) => {
      const jsErrors = trackJsErrors(page);
      const resp = await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      expect(resp?.status()).toBeLessThan(400);
      await page.waitForTimeout(3000);
      expect(jsErrors).toEqual([]);
    });
  }
});

// ═══════════════════════════════════════
// FLOW 2: 로그인 페이지 UI
// ═══════════════════════════════════════
test.describe('Flow 2: Auth Page', () => {
  test('로그인 폼 필드 존재', async ({ page }) => {
    await page.goto('/auth', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="이메일"], input[placeholder*="email" i]').first();
    const pwInput = page.locator('input[type="password"]').first();

    const hasEmail = await emailInput.isVisible({ timeout: 10000 }).catch(() => false);
    const hasPw = await pwInput.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasEmail || hasPw).toBeTruthy();
  });

  test('카카오 또는 소셜 로그인 버튼 존재', async ({ page }) => {
    await page.goto('/auth', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body') || '';
    const hasSocial = /카카오|kakao|google|소셜|간편/i.test(bodyText);

    const kakaoBtn = page.locator('button:has-text("카카오"), a:has-text("카카오"), [class*="kakao"]').first();
    const hasKakaoEl = await kakaoBtn.isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasSocial || hasKakaoEl).toBeTruthy();
  });
});

// ═══════════════════════════════════════
// FLOW 3: 랜딩 페이지 핵심 요소
// ═══════════════════════════════════════
test.describe('Flow 3: Landing Page', () => {
  test('CTA 버튼 + 서비스 소개', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body') || '';
    const hasCTA = /시작|무료|체험|가입|Start|Free|Sign|OwnerView/i.test(bodyText);
    expect(hasCTA).toBeTruthy();
  });

  test('비즈니스 정보 footer', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body') || '';
    expect(bodyText).toMatch(/모티브|MOTIVE|956-87-02691|OwnerView/i);
  });
});

// ═══════════════════════════════════════
// FLOW 4: 플랫폼 페이지 (인증 필요)
// ═══════════════════════════════════════
test.describe('Flow 4: Protected Routes Redirect', () => {
  test('미인증 시 /platform → 로그인 리다이렉트', async ({ page }) => {
    await page.goto('/platform', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url = page.url();
    const hasAuthRedirect = url.includes('/auth') || url.includes('/sign');
    const hasLoginForm = await page.locator('input[type="email"], input[type="password"]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasAuthRedirect || hasLoginForm).toBeTruthy();
  });

  test('미인증 시 /platform/customers → 리다이렉트', async ({ page }) => {
    await page.goto('/platform/customers', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url = page.url();
    const protected_ = !url.includes('/platform/customers') || url.includes('/auth');
    const hasLoginForm = await page.locator('input[type="email"]').first()
      .isVisible({ timeout: 3000 }).catch(() => false);

    expect(protected_ || hasLoginForm).toBeTruthy();
  });
});

// ═══════════════════════════════════════
// FLOW 5: API 헬스체크
// ═══════════════════════════════════════
test.describe('Flow 5: Supabase API Health', () => {
  test('Supabase REST API 응답', async ({ request }) => {
    const resp = await request.get(`${OV_SB_URL}/rest/v1/`, {
      headers: { apikey: OV_SB_ANON_KEY },
    });
    expect(resp.status()).toBeLessThan(500);
  });
});
