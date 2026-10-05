import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
for (const [config, forwarding] of [
  ['ops/reverse-proxy/nginx.conf', 'ops/reverse-proxy/nginx.conf'],
  ['ops/nginx/default.conf.template', 'ops/nginx/proxy-common.inc']
]) {
  test(`${config}: HTTP/3 empty Host fallback and port preservation`, () => {
    const text = read(config);
    assert.match(text, /map\s+\$http_host\s+\$shibei_public_authority\s*\{\s*default\s+\$http_host;\s*''\s+\$host;\s*\}/);
    const headers = read(forwarding);
    for (const name of ['Host', 'X-Forwarded-Host'])
      assert.match(headers, new RegExp(`proxy_set_header\\s+${name}\\s+\\$shibei_public_authority;`));
    assert.match(headers, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
    assert.doesNotMatch(headers, /proxy_set_header\s+(?:Host|X-Forwarded-Host)\s+\$http_host;/);
  });
}
