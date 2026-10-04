/** HTTP-only regression: a 200 page must not reference missing CSS/JS chunks. */
import assert from 'node:assert/strict';
const base = new URL(process.env.BASE_URL || 'http://localhost:3312');
const paths = process.argv.slice(2);
if (!paths.length) paths.push('/zh', '/zh/posts', '/zh/posts/demo-tech-chips');
const visited = new Set();
for (const pathname of paths) {
  const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${pathname}: page status`);
  const html = await response.text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(m => m[1]))];
  assert.ok(urls.some(u => u.endsWith('.css')), `${pathname}: missing styles`);
  assert.ok(urls.some(u => u.endsWith('.js')), `${pathname}: missing scripts`);
  for (const url of urls) {
    if (visited.has(url)) continue;
    const target = new URL(url.replaceAll('&amp;', '&'), base);
    assert.equal(target.origin, base.origin, 'Only inspect same-origin build assets');
    const asset = await fetch(target, { signal: AbortSignal.timeout(20000) });
    assert.equal(asset.status, 200, `${pathname}: missing ${url}`);
    assert.match(asset.headers.get('content-type') || '', url.endsWith('.css') ? /text\/css/ : /javascript/);
    await asset.arrayBuffer();
    visited.add(url);
  }
  console.log(`PASS ${pathname}: HTML and ${urls.length} CSS/JS assets`);
}
console.log(`PASS ${visited.size} unique build assets`);
