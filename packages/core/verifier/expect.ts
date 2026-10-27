// Expectations attached to scenario-batch steps, judged by trusted code only.
//
// The model writes an expectation when it plans a batch ("fill qty=0 → click Add → expect: rejected").
// The runner judges it after the step during exploration, and the verifier judges the saved copy in
// a fresh session during verification and retest. Both use `judgeExpectation` on facts read by
// `observe()`, so "it happened during exploration" and "it reproduced" are decided by identical code.

import { z } from 'zod';
import type { Page } from 'playwright';
import { observe, type Observation } from '../browser/snapshot.ts';

export const ExpectSchema = z.object({
  /** accepted: no error or invalid field, and the page moved on or showed a success message.
   *  rejected: an error message or a field the browser marks invalid. */
  outcome: z.enum(['accepted', 'rejected']).optional(),
  text_visible: z.string().min(2).max(120).optional(),
  text_absent: z.string().min(2).max(120).optional(),
  /** Path after the step. ":id" matches one path segment; a trailing "*" matches any rest. */
  path: z.string().startsWith('/').max(200).optional(),
}).strict().refine((e) => Object.values(e).some((v) => v !== undefined), 'expect needs at least one check');
export type Expectation = z.infer<typeof ExpectSchema>;

export type ExpectFacts = {
  /** Path (without query) before the step ran. */
  pathBefore: string;
  obs: Pick<Observation, 'url' | 'errors' | 'notices' | 'invalid'>;
  bodyText: string;
};

/** ok: every check held. unclear: a failed check could not be decided (e.g. nothing visible happened). */
export type ExpectVerdict = { ok: boolean; unclear: boolean; detail: string };

const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

/** Regular expression source for an expected path (":id" = one segment, trailing "*" = any rest). */
export function pathRegexSource(pattern: string): string {
  const esc = pattern.split('*')[0]!.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:id\b/g, '[^/]+');
  return `^${esc}${pattern.endsWith('*') ? '' : '/?$'}`;
}

export function pathMatches(pattern: string, path: string): boolean {
  return new RegExp(pathRegexSource(pattern)).test(path);
}

export function judgeExpectation(e: Expectation, f: ExpectFacts): ExpectVerdict {
  const failed: string[] = [];
  const held: string[] = [];
  let unclear = false;
  const after = pathOf(f.obs.url);
  const moved = after !== f.pathBefore;
  const rejection = [...f.obs.errors, ...f.obs.invalid.map((i) => `${i.label}: ${i.message}`)];
  if (e.outcome === 'rejected') {
    if (rejection.length) held.push(`rejected (${rejection[0]!.slice(0, 80)})`);
    else {
      failed.push(`expected a rejection, but no error or invalid field was shown${moved ? ` and the page moved to ${after}` : ''}${f.obs.notices.length ? ` (message: ${f.obs.notices[0]!.slice(0, 80)})` : ''}`);
      if (!moved && !f.obs.notices.length) unclear = true; // nothing visible happened
    }
  } else if (e.outcome === 'accepted') {
    if (!rejection.length && (moved || f.obs.notices.length)) held.push('accepted');
    else if (rejection.length) failed.push(`expected acceptance, but it was rejected (${rejection[0]!.slice(0, 80)})`);
    else { failed.push('expected acceptance, but nothing showed success (same page, no message)'); unclear = true; }
  }
  if (e.text_visible !== undefined) {
    if (f.bodyText.includes(e.text_visible)) held.push(`"${e.text_visible}" visible`);
    else failed.push(`"${e.text_visible}" is not visible`);
  }
  if (e.text_absent !== undefined) {
    if (!f.bodyText.includes(e.text_absent)) held.push(`"${e.text_absent}" absent`);
    else failed.push(`"${e.text_absent}" is visible`);
  }
  if (e.path !== undefined) {
    if (pathMatches(e.path, after)) held.push(`at ${after}`);
    else failed.push(`expected path ${e.path}, got ${after}`);
  }
  return failed.length
    ? { ok: false, unclear: unclear && failed.length === 1, detail: failed.join('; ') }
    : { ok: true, unclear: false, detail: held.join('; ') };
}

/** Read the facts an expectation needs from a live page (same instrumentation as the scout). */
export async function pageFacts(page: Page, pathBefore: string, obs?: Observation): Promise<ExpectFacts> {
  const o = obs ?? await observe(page, 0);
  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  return { pathBefore, obs: o, bodyText };
}
