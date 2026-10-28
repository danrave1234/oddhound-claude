// Standalone Playwright regression test exported from a TRUSTED TEMPLATE and the validated scenario
// record (never raw model-generated code). Values are embedded with JSON.stringify only.

import type { Scenario } from '../verifier/scenario.ts';
import { pathRegexSource } from '../verifier/expect.ts';

const j = (v: unknown) => JSON.stringify(v);

type Trace = Extract<Scenario, { kind: 'trace' }>;
type Batch = Extract<Scenario, { kind: 'batch' }>;
type Step = Trace['steps'][number];

function stepLine(st: Step): string {
  if (st.op === 'goto') return `  await page.goto(new URL(fill(${j(st.path)}, vars), BASE_URL).toString());`;
  if (st.op === 'back') return '  await page.goBack();';
  if (st.op === 'press') return `  await page.keyboard.press(${j(st.key === 'Space' ? ' ' : st.key)});`;
  if (st.op === 'fill') return `  await (await field(page, ${j(st.field)})).fill(fill(${j(st.value)}, vars));`;
  if (st.op === 'select') return `  await (await field(page, ${j(st.field)})).selectOption(fill(${j(st.value)}, vars));`;
  if (st.op === 'drag') return `  await page.getByText(${j(st.source)}).first().dragTo(page.getByText(${j(st.target)}).first());`;
  return `  await ${st.role === 'other' ? `page.getByText(${j(st.target)})` : `page.getByRole(${j(st.role)}, { name: ${j(st.target)} })`}.first().click();`;
}

/** Create the record the test needs and keep its number (from the URL the form lands on) as {id}. */
function setupLines(s: { setup?: Trace["setup"] }): string[] {
  if (!s.setup) return [];
  return [
    '  // Create the record this test works on; {id} below is its number.',
    `  await submitForm(page, ${j(s.setup.path)}, ${j(s.setup.fields)}, ${j(s.setup.submit)}, vars);`,
    "  { const u = new URL(page.url()); vars.id = [...u.pathname.split('/'), ...u.searchParams.values()].find((v) => /^\\d+$/.test(v)) ?? ''; }",
    "  expect(vars.id, 'the form should land on a URL with the new record number').not.toBe('');",
  ];
}

/** Batch steps with their expectations as Playwright assertions. Values embedded with JSON.stringify only. */
function batchBody(s: Batch, signedIn: boolean): string {
  const lines: string[] = [];
  if (s.device === 'mobile') lines.push('  await page.setViewportSize({ width: 390, height: 844 });');
  lines.push(`  const vars: Record<string, string> = ${signedIn ? '{ ...who, marker }' : '{ ...identity(), marker }'};`);
  lines.push(...setupLines(s));
  lines.push(`  await page.goto(new URL(fill(${j(s.start)}, vars), BASE_URL).toString());`);
  lines.push("  const rejection = page.locator('[role=alert], .error, .invalid-feedback, :user-invalid');");
  s.steps.slice(0, s.oracleStep).forEach((x, i) => {
    lines.push(`  // Step ${i + 1}${x.expect ? (i + 1 === s.oracleStep ? ' (rule check)' : ' (precondition)') : ''}`);
    lines.push('  { const before = new URL(page.url()).pathname;');
    lines.push(stepLine(x.step));
    lines.push("  await page.waitForLoadState('domcontentloaded').catch(() => {});");
    const e = x.expect;
    if (e?.outcome === 'rejected') lines.push('  await expect(rejection.first()).toBeVisible();');
    if (e?.outcome === 'accepted') lines.push('  await expect(rejection).toHaveCount(0);');
    if (e?.text_visible) lines.push(`  await expect(page.locator('body')).toContainText(${j(e.text_visible)});`);
    if (e?.text_absent) lines.push(`  await expect(page.locator('body')).not.toContainText(${j(e.text_absent)});`);
    if (e?.path) lines.push(`  expect(new URL(page.url()).pathname).toMatch(new RegExp(${j(pathRegexSource(e.path))}));`);
    lines.push('  void before; }');
  });
  return `${lines.join('\n')}\n`;
}

/** Trace steps and oracle as test code. Every value is embedded with JSON.stringify only. */
function traceBody(s: Trace, signedIn: boolean): string {
  const vars = signedIn ? '{ ...who, marker }' : '{ ...identity(), marker }';
  const lines: string[] = [];
  if (s.device === 'mobile') lines.push('  await page.setViewportSize({ width: 390, height: 844 });');
  lines.push('  const failures: string[] = [];');
  lines.push("  page.on('pageerror', (e) => failures.push('pageerror: ' + e.message));");
  lines.push("  page.on('response', (r) => failures.push('status ' + r.status() + ' ' + r.request().method() + ' ' + new URL(r.url()).pathname));");
  lines.push(`  const vars: Record<string, string> = ${vars};`);
  lines.push(...setupLines(s));
  lines.push(`  await page.goto(new URL(fill(${j(s.start)}, vars), BASE_URL).toString());`);
  for (const st of s.steps) lines.push(stepLine(st));
  lines.push("  await page.waitForLoadState('networkidle').catch(() => {});");
  const o = s.oracle;
  lines.push('  // Rule: the problem below must not happen.');
  if (o.type === 'http_status') {
    const routeRe = `^${o.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:id/g, '[^/]+')}$`;
    lines.push(`  const route = new RegExp(${j(routeRe)});`);
    lines.push(`  expect(failures.filter((f) => { const [, code, , path] = f.split(' '); return +code >= ${o.min} && +code <= ${o.max} && route.test(path ?? ''); })).toEqual([]);`);
  }
  else if (o.type === 'page_error') lines.push("  expect(failures.filter((f) => f.startsWith('pageerror'))).toEqual([]);");
  else if (o.type === 'markup_rendered') lines.push("  await expect(page.locator('[data-oh-probe]')).toHaveCount(0);");
  else if (o.type === 'error_text') lines.push("  await expect(page.locator('body')).not.toContainText(/Traceback|SQLSTATE|Exception|at .+:\\d+:\\d+\\)/);");
  else if (o.type === 'mobile_overflow') lines.push('  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 4)).toBe(true);');
  else lines.push(`  await expect(page.locator('body')).not.toContainText(${j(o.text)});`);
  return `${lines.join('\n')}\n`;
}

type Claim = Extract<Scenario, { kind: 'claim_check' }>;
type CrossActor = Extract<Scenario, { kind: 'cross_actor' }>;

/** Family 1: the save, its success message, then each saved value after reloading and reopening. */
function claimBody(s: Claim, signedIn: boolean): string {
  const lines: string[] = [];
  if (s.device === 'mobile') lines.push('  await page.setViewportSize({ width: 390, height: 844 });');
  lines.push(`  const vars: Record<string, string> = ${signedIn ? '{ ...who, marker }' : '{ ...identity(), marker }'};`);
  lines.push(...setupLines(s));
  lines.push(`  await page.goto(new URL(fill(${j(s.start)}, vars), BASE_URL).toString());`);
  for (const st of s.steps) lines.push(stepLine(st));
  lines.push("  await page.waitForLoadState('networkidle').catch(() => {});");
  if (s.claim) lines.push(`  await expect(page.locator('body')).toContainText(${j(s.claim)}); // the page claims success`);
  lines.push("  { const u = new URL(page.url()); vars.landed_id = [...u.pathname.split('/'), ...u.searchParams.values()].find((v) => /^\\d+$/.test(v)) ?? ''; }");
  lines.push(`  const pages = [new URL(page.url()).pathname + new URL(page.url()).search, ...${j(s.revisit)}.map((p) => fill(p, vars))];`);
  lines.push(`  const checks = ${j(s.checks)}.map((c) => ({ field: c.field, value: fill(c.value, vars) }));`);
  lines.push(`  // Rule: every saved value is there again (looked for up to ${s.windowMs / 1000} s, in page text or form values).`);
  lines.push('  await expect(async () => {');
  lines.push('    const seen: string[] = [];');
  lines.push('    for (const p of pages) {');
  lines.push('      await page.goto(new URL(p, BASE_URL).toString());');
  lines.push("      seen.push((await page.locator('body').innerText()).toLowerCase());");
  lines.push("      seen.push(...(await page.locator('input, textarea, select').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value ?? ''))).map((v) => v.toLowerCase()));");
  lines.push('    }');
  lines.push("    for (const c of checks) expect(seen.some((t) => t.replace(/\\s+/g, ' ').includes(c.value.toLowerCase().replace(/\\s+/g, ' ').trim())), c.field).toBe(true);");
  lines.push(`  }).toPass({ timeout: ${Math.max(5_000, s.windowMs + 5_000)} });`);
  return `${lines.join('\n')}\n`;
}

/** Family 2: account A creates the record; a second account opens exactly its URL. */
function crossActorBody(s: CrossActor): string {
  const own = s.protect.map((f) => s.setup.fields[f]).filter((v): v is string => v !== undefined);
  return `  const vars: Record<string, string> = { ...who, marker };
  await submitForm(page, ${j(s.setup.path)}, ${j(s.setup.fields)}, ${j(s.setup.submit)}, vars);
  { const u = new URL(page.url()); vars.id = [...u.pathname.split('/'), ...u.searchParams.values()].find((v) => /^\\d+$/.test(v)) ?? ''; }
  const recordUrl = new URL(fill(${j(s.path)}, vars), BASE_URL).toString();
  const own = ${j(own)}.map((v) => fill(v, vars));
  await page.goto(recordUrl);
  for (const v of own) await expect(page.locator('body')).toContainText(v); // positive control: the owner sees it
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await submitForm(page2, ${j(s.auth.path)}, ${j(s.auth.fields)}, ${j(s.auth.submit)}, identity());
  await page2.goto(recordUrl);
  // Rule: another account must not see this record${s.controls.length ? ' or change it' : ''}.
  for (const v of own) await expect(page2.locator('body')).not.toContainText(v);
${s.controls.map((c) => `  { const before = await page.locator('body').innerText();
    const control = page2.getByRole(${j(c.role)}, { name: ${j(c.target)}, exact: true });
    if (await control.count()) await control.first().click();
    await page.goto(recordUrl);
    expect(await page.locator('body').innerText()).toBe(before); }
  await page2.goto(recordUrl);
`).join('')}  await other.close();
`;
}

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
  } else if (s.kind === 'trace') {
    body = `${auth}${traceBody(s, Boolean(auth))}`;
  } else if (s.kind === 'batch') {
    body = `${auth}${batchBody(s, Boolean(auth))}`;
  } else if (s.kind === 'claim_check') {
    body = `${auth}${claimBody(s, Boolean(auth))}`;
  } else if (s.kind === 'cross_actor') {
    body = `${auth}${crossActorBody(s)}`;
  } else {
    body = `${auth}  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL(${j(s.path)}, BASE_URL).toString());
  const control = page.getByRole('button', { name: ${j(s.control)} }).or(page.getByRole('link', { name: ${j(s.control)} })).first();
  // Rule: the control must be pressable on a phone (trial click checks it is not covered).
  await control.click({ trial: true, timeout: 5000 });
`;
  }
  const fixture = s.kind === 'cross_account_read' || s.kind === 'cross_actor' ? '{ page, browser }' : '{ page }';
  return `${header}${handoff ? 'test.use({ storageState: process.env.STORAGE_STATE });\n' : ''}
test(${j(meta.title)}, async (${fixture}) => {
${body}});
`;
}
