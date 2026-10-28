import { describe, it, expect } from 'vitest';
import { pagePath, robotsSitemaps, sitemapLocs } from '../../packages/core/browser/site-map.ts';

describe('site map parsing', () => {
  it('reads Sitemap lines from robots.txt in any case', () => {
    expect(robotsSitemaps('User-agent: *\nDisallow: /admin\nSitemap: https://a.test/s1.xml\nsitemap:https://a.test/s2.xml\n')).toEqual(['https://a.test/s1.xml', 'https://a.test/s2.xml']);
  });
  it('tells a sitemap index from a URL set and decodes entities', () => {
    expect(sitemapLocs('<sitemapindex><sitemap><loc> https://a.test/pages.xml </loc></sitemap></sitemapindex>')).toEqual({ index: true, locs: ['https://a.test/pages.xml'] });
    expect(sitemapLocs('<urlset><url><loc>https://a.test/p?x=1&amp;y=2</loc></url></urlset>')).toEqual({ index: false, locs: ['https://a.test/p?x=1&y=2'] });
  });
  it('keeps same-origin pages only, without fragments or files', () => {
    expect(pagePath('https://a.test/notes?s=1', 'https://a.test')).toBe('/notes?s=1');
    expect(pagePath('/relative', 'https://a.test')).toBe('/relative');
    expect(pagePath('https://www.a.test/notes', 'https://a.test')).toBeNull();
    expect(pagePath('https://a.test/guide.pdf', 'https://a.test')).toBeNull();
  });
});
