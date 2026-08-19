/**
 * Favicon 解析：常见自建路径优先，公开站点走域名 fallback
 * 不会解析目标站点 HTML 中的 <link rel="icon">
 */

const LOCAL_FALLBACK = '/favicon.svg';

export function getProjectNativeFavicon(targetUrl) {
  if (!targetUrl) return LOCAL_FALLBACK;

  try {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    const hostname = parsed.hostname.toLowerCase();

    // 常见自建服务：优先同源已知路径（不向外泄露 hostname）
    if (hostname.includes('traffic')) return `${origin}/favicon.svg`;
    if (hostname.includes('tz.')) return `${origin}/favicon.ico`;
    if (hostname.includes('blog.')) return `${origin}/favicon.png`;
    if (hostname.includes('v.')) return `${origin}/images/favicon-32x32.png`;
    if (hostname.includes('cd2.')) return `${origin}/public/favicon.png`;
    if (hostname.includes('img.')) return `${origin}/favicon.png`;
    if (hostname.includes('catbox.')) return `${origin}/static/catbox-logo.png`;
    if (hostname.includes('qb.')) return `${origin}/icons/qbittorrent-tray.svg`;

    // 公开站点：第三方域名 favicon fallback
    if (hostname.includes('github.')) return 'https://icons.duckduckgo.com/ip3/github.com.ico';
    if (hostname.includes('vercel.')) return 'https://icons.duckduckgo.com/ip3/vercel.com.ico';
    if (hostname.includes('cloudflare.')) return 'https://icons.duckduckgo.com/ip3/cloudflare.com.ico';

    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return LOCAL_FALLBACK;
  }
}
