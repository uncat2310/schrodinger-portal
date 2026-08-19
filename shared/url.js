/**
 * HTTP(S) URL 校验（前后端共用，不负责 SSRF IP 检查）
 */

export function parseHttpUrl(value, { maxLength = 2048 } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  return parsed;
}

export function isValidHttpUrl(value, options) {
  return Boolean(parseHttpUrl(value, options));
}
