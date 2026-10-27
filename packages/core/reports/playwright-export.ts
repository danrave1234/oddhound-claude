// Standalone Playwright regression test exported from a TRUSTED TEMPLATE and the validated scenario
// record (never raw model-generated code). Values are embedded with JSON.stringify only.

import type { Scenario } from '../verifier/scenario.ts';

const j = (v: unknown) => JSON.stringify(v);

export function playwrightTest(s: Scenario, meta: { title: string; scenarioId: string; assertionHash: string }): string {
  const header = `// Oddhound regression test (exported). Scenario ${meta.scenarioId}, assertion ${meta.assertionHash.slice(0, 12)}.
// Run: BASE_URL=https://your-staging-site npx playwright test oddhound-${meta.scenarioId.slice(0, 8)}.spec.ts
// Uses synthetic accounts created during the test. Contains no credentials or session data.
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const marker = 'OH' + Math.random().toString(16).slice(2, 10).toUpperCase();
const identity = () => { const n = Date.now().toString(36); return { name: 'Oddhound Tester', email: \`oddhound+\${n}@example.test\`, password: 'Oh!' + n + 'x9Z' }; };
const fill = (t: string, vars: Record<string, string>) => t.replace(/\\{(\\w+)(?:([+-])(\\d+))?\\}/g, (w, k, sign, n) => {
  if (k === 'date' || k === 'today') { const d = new Date(); if (sign) d.setUTCDate(d.getUTCDate() + (sign === '+' ? 1 : -1) * Number(n)); return d.toISOString().slice(0, 10); }
  return vars[k] ?? w;
});
async function field(page: Page, key: string) {
  for (const loc of [page.getByLabel(key), page.locator(\`[name="\${key}"]\`), page.getByPlaceholder(key)]) if (await loc.count()) return loc.first();
  throw new Error('field not found: ' + key);
}
async function submitForm(page: Page, path: string, fields: Record<string, string>, submit: string, vars: Record<string, string>) {
  await page.goto(new URL(path, BASE_URL).toString());
  for (const [k, v] of Object.entries(fields)) await (await field(page, k)).fill(fill(v, vars));
  await page.getByRole('button', { name: submit }).first().click();
  await page.waitForLoadState('domcontentloaded');
}
`;
  const recipe = 'auth' in s ? s.auth : undefined;
  const handoff = recipe?.kind === 'handoff';
  const auth = recipe && recipe.kind !== 'handoff'
    ? `  const who = identity();\n  await submitForm(page, ${j(recipe.path)}, ${j(recipe.fields)}, ${j(recipe.submit)}, who);\n  await expect(page.getByText(${j(recipe.successText)})).toBeVisible();\n`
    : handoff
      ? '  // Recorded while signed in as the site owner. Save a signed-in session first:\n  //   npx playwright codegen --save-storage=auth.json <your site>, then run with STORAGE_STATE=auth.json\n  const who = identity();\n'
      : '';
  let body = '';
  if (s.kind === 'form_rule') {
    body = `${auth}  await submitForm(page, ${j(s.form.path)}, ${j(s.form.fields)}, ${j(s.form.submit)}, { ...${auth ? 'who' : 'identity()'}, marker });
  await page.goto(new URL(${j(s.listPath)}, BASE_URL).toString());
  // Rule: this input must be ${s.expectation}.
  ${s.expectation === 'rejected' ? 'await expect(page.locator(\'body\')).not.toContainText(marker);' : 'await expect(page.locator(\'body\')).toContainText(marker);'}
`;
  } else if (s.kind === 'cross_account_read') {
    body = `${auth}  await submitForm(page, ${j(s.create.path)}, ${j(s.create.fields)}, ${j(s.create.submit)}, { ...who, marker });
  await page.goto(new URL(${j(s.listPath)}, BASE_URL).toString());
  const href = await page.locator('tr', { hasText: marker }).locator('a[href]').first().getAttribute('href');
  const recordUrl = new URL(href!, BASE_URL).toString();
  await page.goto(recordUrl);
  await expect(page.locator('body')).toContainText(marker); // positive control: the owner can read it
  const other = await browser.newContext();
  const page2 = await other.newPage();
  ${s.auth.kind === 'handoff' ? '// Sign a second, unrelated account in here before opening the record.' : `await submitForm(page2, ${j(s.auth.path)}, ${j(s.auth.fields)}, ${j(s.auth.submit)}, identity());`}
  await page2.goto(recordUrl);
  // Rule: another account must not see this record.
  await expect(page2.locator('body')).not.toContainText(marker);
  await other.close();
`;
  } else {
    body = `${auth}  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL(${j(s.path)}, BASE_URL).toString());
  const control = page.getByRole('button', { name: ${j(s.control)} }).or(page.getByRole('link', { name: ${j(s.control)} })).first();
  // Rule: the control must be pressable on a phone (trial click checks it is not covered).
  await control.click({ trial: true, timeout: 5000 });
`;
  }
  const fixture = s.kind === 'cross_account_read' ? '{ page, browser }' : '{ page }';
  return `${header}${handoff ? 'test.use({ storageState: process.env.STORAGE_STATE });\n' : ''}
test(${j(meta.title)}, async (${fixture}) => {
${body}});
`;
}
