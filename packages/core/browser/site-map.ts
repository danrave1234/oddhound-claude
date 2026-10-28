// The pages a site lists about itself, read once when a run starts: robots.txt, the sitemaps it names (or
// /sitemap.xml) and the links on the first page. Read from inside the run's own browser page, so every request
// takes the same proxy, scope policy and byte limits as the pages themselves. GET only, same origin only
// (fetch mode "same-origin" refuses cross-origin redirects), bounded in count and size.
import type { Page } from 'playwright';

export type SiteMap = { paths: string[]; sources: { sitemap: number; links: number }; sitemaps: string[] };

const MAX_PATHS = 200;
const MAX_SITEMAPS = 4;
const MAX_CHARS = 512 * 1024;
const ASSET = /\.(xml|txt|json|pdf|zip|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|mp4|mp3)$/i;

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

/** Sitemap URLs named in robots.txt. */
export function robotsSitemaps(text: string): string[] {
  return [...text.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]!);
}

/** The <loc> entries of a sitemap, and whether it is a sitemap index (its entries are more sitemaps). */
export function sitemapLocs(xml: string): { index: boolean; locs: string[] } {
  return { index: /<sitemapindex[\s>]/i.test(xml), locs: [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decode(m[1]!)) };
}

/** Path and query of a same-origin page URL, or null for another origin or a file. */
export function pagePath(url: string, origin: string): string | null {
  try {
    const u = new URL(url, origin);
    if (u.origin !== origin || ASSET.test(u.pathname)) return null;
    return `${u.pathname}${u.search}`;
  } catch { return null; }
}

export async function readSiteMap(page: Page, origin: string, allowed: (path: string) => boolean = () => true): Promise<SiteMap> {
  const get = (path: string) => page.evaluate(async ({ path, max }) => {
    try {
      const r = await fetch(path, { mode: 'same-origin', credentials: 'same-origin', signal: AbortSignal.timeout(8_000) });
      return r.ok ? (await r.text()).slice(0, max) : null;
    } catch { return null; }
  }, { path, max: MAX_CHARS }).catch(() => null);

  const found = new Set<string>();
  const add = (url: string) => { const p = pagePath(url, origin); if (p && found.size < MAX_PATHS && allowed(p)) found.add(p); };

  const samePath = (url: string) => { try { const x = new URL(url, origin); return x.origin === origin ? `${x.pathname}${x.search}` : null; } catch { return null; } };
  const robots = await get('/robots.txt');
  const queue = (robots ? robotsSitemaps(robots) : []).map(samePath).filter((p): p is string => !!p);
  if (!queue.length) queue.push('/sitemap.xml');
  const read: string[] = [];
  while (queue.length && read.length < MAX_SITEMAPS && found.size < MAX_PATHS) {
    const path = queue.shift()!;
    if (read.includes(path)) continue;
    read.push(path);
    const xml = await get(path);
    if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    const { index, locs } = sitemapLocs(xml);
    for (const loc of locs) {
      if (!index) { add(loc); continue; }
      const p = samePath(loc);
      if (p) queue.push(p);
    }
  }
  const fromSitemap = found.size;

  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href).slice(0, 500)).catch(() => [] as string[]);
  for (const h of hrefs) add(h.split('#')[0]!);
  return { paths: [...found], sources: { sitemap: fromSitemap, links: found.size - fromSitemap }, sitemaps: read };
}
