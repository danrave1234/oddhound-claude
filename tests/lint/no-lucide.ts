// Restricted-import lint: no Lucide anywhere, and icon glyphs only through apps/web/ui/icons.tsx.
// Run: node tests/lint/no-lucide.ts   (exits non-zero on any violation)
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['node_modules', '.next', '.tools', '.data', 'test-results', '.git', 'docs']);
const violations: string[] = [];

async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(p); continue; }
    if (!/\.(tsx?|mjs|js|json)$/.test(entry.name)) continue;
    const rel = relative(root, p).replace(/\\/g, '/');
    if (rel === 'tests/lint/no-lucide.ts') continue;
    const text = await readFile(p, 'utf8');
    if (/(from\s+|require\(|import\()['"][^'"]*lucide/i.test(text)) violations.push(`${rel}: imports Lucide`);
    if (rel.endsWith('package.json') && /"[^"]*lucide[^"]*"\s*:/i.test(text)) violations.push(`${rel}: depends on Lucide`);
    if (/from ['"]@primer\/octicons-react['"]/.test(text) && rel !== 'apps/web/ui/icons.tsx') violations.push(`${rel}: imports Octicons directly (use apps/web/ui/icons.tsx)`);
  }
}
await walk(root);
if (violations.length) { console.error(violations.join('\n')); process.exit(1); }
console.log('no-lucide: OK (no Lucide; icons only via the local icon layer)');
