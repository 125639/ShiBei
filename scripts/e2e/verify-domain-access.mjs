/** Live backend domain regression. Run on the deployment host, as its service user.
 * Reads credentials only from that deployment's environment; never saves cookies/passwords.
 * Does not change content/settings or run jobs. Authenticated logout is deliberately
 * excluded: this app revokes ALL admin sessions on logout, not just this test's session.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import nextEnv from '@next/env';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
nextEnv.loadEnvConfig(root, false, { info() {}, error() {} });
const base = new URL(process.env.BASE_URL || process.env.PUBLIC_URL).origin;
assert.equal(base, new URL(process.env.PUBLIC_URL).origin, 'Only test the configured deployment origin');
assert.equal(new URL(base).protocol, 'https:');
assert.ok(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD, 'Configured admin credentials required');
const modes = [
  ['h3', ['--enable-quic', `--origin-to-force-quic-on=${new URL(base).hostname}:${new URL(base).port || "443"}`]],
  ['h2', ['--disable-quic']],
  ['http/1.1', ['--disable-quic', '--disable-http2']]
];
let checks = 0;
let sessionCookies;
const result = [];
const pass = (message) => { checks++; console.log(`PASS ${message}`); };

for (const [protocol, args] of modes) {
  const browser = await chromium.launch({ headless: true, args });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const observed = [];
  const loginProtocols = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', ({ redirectResponse }) => {
    if (redirectResponse && redirectResponse.url === base + '/api/admin/login')
      loginProtocols.push(redirectResponse.protocol);
  });
  cdp.on('Network.responseReceived', ({ response, type }) => {
    if (new URL(response.url).origin === base && type === 'Document')
      observed.push({ path: new URL(response.url).pathname, protocol: response.protocol });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (new URL(r.url()).origin === base && r.status() >= 400)
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  async function visit(route, expectedPath = route.split('?')[0]) {
    const r = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 60000 });
    assert.equal(r.status(), 200, route);
    assert.equal(new URL(page.url()).origin, base, route);
    assert.equal(new URL(page.url()).pathname, expectedPath, route);
    const actual = await page.evaluate(() => performance.getEntriesByType('navigation')[0].nextHopProtocol);
    assert.equal(actual, protocol, `Protocol not actually negotiated for ${route}`);
    pass(`${protocol} ${route} -> ${expectedPath}`);
  }
  try {
    await context.addCookies([{ name: '__Host-shibei_admin_session', value: 'invalid-expired-session-probe', url: base, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    await visit('/admin/posts', '/admin/login');
    pass(`${protocol} invalid session returns to HTTPS domain login`);
    await context.clearCookies();
    await visit('/', '/admin/login');
    await visit('/zh/posts?domain-check=1', '/admin/login');
    const unauth = await context.request.get(base + '/api/admin/storage/usage');
    assert.equal(unauth.status(), 401); pass(`${protocol} anonymous admin API rejected`);

    // APIRequestContext uses its own transport, so these are HTTP API checks,
    // not evidence of HTTP/3. Actual browser forms below exercise each protocol.
    for (const origin of ['https://untrusted.invalid', 'null']) {
      const denied = await context.request.post(base + '/api/admin/logout', {
        headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }, maxRedirects: 0
      });
      assert.equal(denied.status(), 403); pass(`API cross-origin/null mutation rejected (${protocol} run)`);
    }
    const emptyLogout = await context.request.post(base + '/api/admin/logout', {
      headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' }, maxRedirects: 0
    });
    assert.equal(emptyLogout.status(), 303);
    assert.equal(new URL(emptyLogout.headers().location, base).href, base + '/admin/login');
    pass('API anonymous logout stays on public origin');

    await visit('/admin/login');
    // One real login per run; subsequent protocols reuse this session in memory
    // to avoid exhausting production's account login rate limit.
    if (!sessionCookies) {
      await page.locator('[name=username]').fill(process.env.ADMIN_USERNAME);
      await page.locator('[name=password]').fill(process.env.ADMIN_PASSWORD);
      const loginResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/login' && r.request().method() === 'POST');
      await Promise.all([page.waitForURL(base + '/admin', { timeout: 45000 }), page.locator('button[type=submit]').click()]);
      const response = await loginResponse;
      assert.equal(response.status(), 303);
      assert.equal(new URL(response.headers().location, base).href, base + '/admin');
      await page.waitForLoadState('networkidle');
      sessionCookies = await context.cookies();
      const cookie = sessionCookies.find(c => c.name === '__Host-shibei_admin_session');
      assert.ok(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/');
      assert.equal(cookie.domain, new URL(base).hostname);
      pass(`${protocol} real login + secure host-only cookie`);
    } else {
      // Invalid credentials exercise the browser POST/redirect on other protocols
      // without touching the real administrator's login quota.
      await page.locator('[name=username]').fill(`domain-check-${Date.now()}`);
      await page.locator('[name=password]').fill('not-a-real-account');
      await Promise.all([page.waitForURL(base + '/admin/login?error=1', { timeout: 45000 }), page.locator('button[type=submit]').click()]);
      pass(`${protocol} invalid login stays on domain`);
      await context.addCookies(sessionCookies);
    }
    assert.ok(loginProtocols.includes(protocol), `Login POST did not use ${protocol}: ${loginProtocols}`);
    pass(`${protocol} login POST protocol verified via CDP`);
    for (const origin of ['https://untrusted.invalid', 'null', 'https://sibling.' + new URL(base).hostname]) {
      const denied = await context.request.post(base + '/api/admin/logout', {
        headers: { Origin: origin, 'Sec-Fetch-Site': 'same-site', 'X-Forwarded-Host': 'untrusted.invalid' },
        maxRedirects: 0
      });
      assert.equal(denied.status(), 403);
    }
    const authenticated = await context.request.get(base + '/api/admin/storage/usage');
    assert.equal(authenticated.status(), 200);
    pass('API authenticated cross-origin logout blocked; session remains valid');
    for (const route of ['/admin', '/admin/posts', '/admin/jobs', '/admin/settings', '/admin/sources', '/admin/stats', '/admin/sync']) {
      await visit(route);
      assert.ok(await page.locator('.admin-main h1').isVisible(), `Missing heading ${route}`);
    }
    // Next client navigation, not just full document reloads.
    const link = page.locator('a[href="/admin/posts"]').first();
    await link.click(); await page.waitForURL(base + '/admin/posts');
    await page.locator('.admin-main h1').waitFor();
    assert.equal(new URL(page.url()).origin, base); pass(`${protocol} client-side admin navigation`);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/admin/posts'); pass(`${protocol} refresh retains session`);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit('/admin');
    assert.ok(await page.locator('.admin-main h1').isVisible());
    pass(`${protocol} mobile dashboard`);
    assert.deepEqual(errors, [], 'Browser resource/runtime errors');
    pass(`${protocol} no failed resources or runtime errors`);
    result.push({ protocol, documents: observed.length });
  } finally { await browser.close(); }
}
const http = await fetch(base.replace('https:', 'http:') + '/admin/login?domain-check=1', { redirect: 'manual' });
assert.ok([301, 308].includes(http.status));
assert.equal(http.headers.get('location'), base + '/admin/login?domain-check=1'); pass('HTTP -> HTTPS preserves path and query');
const health = await (await fetch(base + '/api/health')).json();
assert.equal(health.mode, 'backend'); assert.equal(health.db, 'up'); pass('backend mode + DB health');
const forged = await fetch(base + '/', { redirect: 'manual', headers: { 'X-Forwarded-Host': 'untrusted.invalid', 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '192.0.2.1' } });
assert.equal(new URL(forged.headers.get('location'), base).href, base + '/admin'); pass('ingress overwrites forged forwarding headers');
console.log(JSON.stringify({ checks, protocols: result, authenticatedLogout: 'not run: would revoke all administrator sessions' }, null, 2));
