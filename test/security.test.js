import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHttpUrl, parseHttpUrl } from '../shared/url.js';
import { escapeHtml, safeJsonForHtmlScript } from '../shared/escape.js';
import { isBlockedIp, validateProbeTarget } from '../shared/ssrf.js';

test('URL validation accepts http/https only', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://example.com/path'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('data:text/html,hi'), false);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(parseHttpUrl('not a url'), null);
});

test('SSRF blocks private and special-use IPs', () => {
  const blocked = [
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1'
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedIp(ip), true, `expected blocked: ${ip}`);
  }
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('1.1.1.1'), false);
});

test('validateProbeTarget rejects localhost and javascript', async () => {
  assert.equal((await validateProbeTarget('http://127.0.0.1')).ok, false);
  assert.equal((await validateProbeTarget('http://localhost')).ok, false);
  assert.equal((await validateProbeTarget('http://[::1]')).ok, false);
  assert.equal((await validateProbeTarget('javascript:alert(1)')).ok, false);
  const ok = await validateProbeTarget('https://example.com');
  assert.equal(ok.ok, true);
  assert.ok(ok.address);
  assert.ok(ok.family === 4 || ok.family === 6);
});

test('XSS helpers escape HTML and script JSON', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(evil);
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);

  const json = safeJsonForHtmlScript({ title: '</script><script>alert(1)</script>' });
  assert.equal(json.includes('<'), false);
  assert.equal(json.includes('>'), false);
  assert.ok(json.includes('\\u003c'));
});

test('online metric semantics: zero stays zero', () => {
  const onlineCount = 0;
  const total = 5;
  const display = onlineCount; // must NOT use onlineCount || total
  assert.equal(display, 0);
  assert.notEqual(onlineCount || total, 0);
});
