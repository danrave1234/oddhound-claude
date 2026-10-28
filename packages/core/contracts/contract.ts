// The immutable run contract the owner approves (MVP plan §17 "Active testing contract").
// It bounds origins, actors, capabilities, denied operations and resources, while letting the
// agent discover new in-scope UI paths without per-click approval.

import { z } from 'zod';
import { DEVICE_PROFILES } from './limits.ts';

export const RuleSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  text: z.string().min(3).max(400),
  source: z.enum(['owner', 'demo_target', 'baseline']),
});
export type Rule = z.infer<typeof RuleSchema>;

/**
 * Oddhound's baseline rules: explicit, published expectations that hold for almost any web app, so a
 * run can verify real bugs without the owner writing rules first. They are added to every contract
 * and shown with the run. A finding against one is still only `verified` after independent replay.
 */
export const BASELINE_RULES: Rule[] = [
  { id: 'B1', text: 'Normal use of the site never causes a server error (HTTP 5xx).', source: 'baseline' },
  { id: 'B2', text: 'Pages do not throw uncaught JavaScript errors during normal use.', source: 'baseline' },
  { id: 'B3', text: 'Text a user enters is displayed as text, never rendered as HTML markup.', source: 'baseline' },
  { id: 'B4', text: 'Pages and error messages do not expose stack traces or internal error details.', source: 'baseline' },
  { id: 'B5', text: 'Pages fit a 390px-wide phone screen without sideways scrolling.', source: 'baseline' },
  { id: 'B6', text: 'Links on the site lead to pages that exist (no HTTP 404).', source: 'baseline' },
  { id: 'B7', text: 'A signed-in user cannot see or change another user\'s private records.', source: 'baseline' },
  { id: 'B8', text: 'Required fields reject blank or whitespace-only input.', source: 'baseline' },
  { id: 'B9', text: 'After signing out, account-only pages and data are not shown without signing in again.', source: 'baseline' },
  { id: 'B10', text: 'Rules a page states about its own inputs (length, range, step, format, or a limit stated in its text) hold when a user submits the form.', source: 'baseline' },
  { id: 'B11', text: 'When the site says a change was saved (for example "Saved" or "Booking updated"), the saved values are there when the page is reloaded or the record is reopened.', source: 'baseline' },
];
/** How serious a confirmed baseline violation is, for ordering and display. */
export const BASELINE_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  B1: 'high', B2: 'medium', B3: 'high', B4: 'medium', B5: 'low', B6: 'low', B7: 'high', B8: 'medium', B9: 'high', B10: 'medium', B11: 'high',
};

/** Owner (or demo) rules plus the baseline rules, without duplicate IDs. */
export function withBaselineRules(rules: Rule[]): Rule[] {
  const ids = new Set(rules.map((r) => r.id));
  return [...rules, ...BASELINE_RULES.filter((b) => !ids.has(b.id))];
}

export const AccountRefSchema = z.object({
  ref: z.string().regex(/^cred_[A-Za-z0-9_-]{6,64}$/),
  role: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
});

export const CapabilitiesSchema = z.object({
  register: z.boolean(),
  login: z.boolean(),
  createRecords: z.boolean(),
  editRecords: z.boolean(),
  cancelRecords: z.boolean(),
  boundaryValues: z.boolean(),
  repeatSubmission: z.boolean(),
  unusualOrder: z.boolean(),
  crossAccountRead: z.boolean(), // controlled two-account authorization probe on known records
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const RunContractSchema = z.object({
  version: z.literal(1),
  target: z.object({
    origin: z.string().url(),
    environment: z.enum(['staging', 'production']),
    apiOrigins: z.array(z.object({ origin: z.string().url(), verificationRevision: z.number().int() })).max(4),
    verification: z.union([
      z.object({ kind: z.literal('owner_verified'), method: z.enum(['dns_txt', 'well_known_file', 'meta_tag']), revision: z.number().int(), checkedAt: z.string() }),
      z.object({ kind: z.literal('demo_target') }),
    ]),
  }),
  testMode: z.enum(['active', 'observation_only']),
  productionWritesAcknowledged: z.boolean(),
  description: z.string().max(1000),
  // Optional focus areas. They set priorities; they never limit what the agent may test.
  goals: z.array(z.string().min(3).max(300)).max(8),
  rules: z.array(RuleSchema).max(30),
  capabilities: CapabilitiesSchema,
  accounts: z.array(AccountRefSchema).max(4),
  registration: z.object({ allowed: z.boolean(), emailDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), maxIdentities: z.number().int().min(0).max(3) }),
  deniedPathPrefixes: z.array(z.string().startsWith('/')).max(30),
  // Words that block any URL on the verified site whose path contains them as a segment or a
  // dash/underscore-separated part (e.g. "domain" blocks /api/vercel/add-domain). Safe defaults below.
  deniedPathKeywords: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(60).default([]),
  deniedOperations: z.array(z.string().max(200)).max(20),
  // Owner sign-in handoff: the owner signs in through a live view first, then the agent takes over
  // with that session. The session lives only in the worker's memory for this run.
  handoff: z.object({ enabled: z.boolean(), startPath: z.string().startsWith('/').max(200) }).default({ enabled: false, startPath: '/' }),
  devices: z.array(z.enum(Object.keys(DEVICE_PROFILES) as ['desktop', 'mobile'])).min(1).max(2),
  expiresAt: z.string(),
});
export type RunContract = z.infer<typeof RunContractSchema>;

/**
 * Safe defaults: URL words that usually mean money, irreversible changes, operator areas or ending
 * the session. Prefilled for every new run and editable by the owner. Path checks cannot see what a
 * same-URL form post (for example a Next.js server action) does, so denied operations are also stated
 * to the agent; neither is a guarantee about arbitrary UI actions (MVP §17).
 */
export const DEFAULT_DENIED_PATH_KEYWORDS = [
  'admin', 'checkout', 'pay', 'payment', 'payments', 'billing', 'invoice', 'invoices', 'subscribe', 'subscription', 'subscriptions',
  'stripe', 'paymongo', 'paypal', 'refund', 'withdraw', 'transfer', 'webhook', 'webhooks', 'cron', 'delete', 'destroy', 'purge',
  'domain', 'domains', 'redeem',
];

/**
 * Signing out is a normal QA check (B9) when the agent uses its own synthetic accounts, which it can
 * sign back into. When the owner signed in through the handoff, signing out would end the owner's
 * session for the rest of the run, so these words are added to the blocked list then.
 */
export const SIGN_OUT_KEYWORDS = ['logout', 'signout', 'sign-out', 'log-out'];

export const DEFAULT_DENIED_OPERATIONS = [
  'Do not pay, subscribe, or enter payment details.',
  'Do not delete accounts or data you did not create in this run.',
  'Do not send messages, invitations or emails to real people.',
];

export const HANDOFF_DENIED_OPERATIONS = [
  'You are signed in as the owner\'s account: do not sign out, and do not change its email, password, name or security settings.',
];

/** True when a URL path is blocked by one of the denied keywords. */
export function pathHasDeniedKeyword(pathname: string, keywords: readonly string[]): string | null {
  return deniedKeywordsInPath(pathname, keywords)[0] ?? null;
}

/** Every denied keyword that appears as a path segment or a dash/underscore/dot part of one. */
export function deniedKeywordsInPath(pathname: string, keywords: readonly string[]): string[] {
  if (!keywords.length) return [];
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep raw */ }
  const found = new Set<string>();
  for (const segment of decoded.toLowerCase().split('/').filter(Boolean)) {
    const parts = new Set([segment, ...segment.split(/[-_.]/).filter(Boolean)]);
    for (const k of keywords) if (parts.has(k)) found.add(k);
  }
  return [...found];
}

/**
 * Default keywords whose GET can still have an effect (sign-out links, delete-by-link, payment
 * redirects, webhook/cron triggers). Background reads that match only the other defaults (for
 * example GET /subscriptions/my-subscription or /billing/usage) are allowed: they show the page its
 * own data and change nothing. A keyword the owner adds is not in the defaults and blocks reads too.
 */
export const KEYWORDS_BLOCKING_READS = new Set([
  'logout', 'signout', 'sign-out', 'log-out', 'delete', 'destroy', 'purge', 'refund', 'withdraw', 'transfer', 'redeem',
  'webhook', 'webhooks', 'cron', 'checkout', 'pay', 'subscribe', 'stripe', 'paymongo', 'paypal',
]);
const DEFAULT_KEYWORD_SET = new Set([...DEFAULT_DENIED_PATH_KEYWORDS, ...SIGN_OUT_KEYWORDS]);

/** Whether a background read (GET/HEAD/OPTIONS that is not a top-level navigation) to this path is blocked. */
export function keywordsBlockRead(matched: readonly string[]): boolean {
  return matched.some((k) => KEYWORDS_BLOCKING_READS.has(k) || !DEFAULT_KEYWORD_SET.has(k));
}

/** Whether this contract permits state-changing requests at all. */
export function writesPermitted(c: RunContract): boolean {
  if (c.testMode !== 'active') return false;
  if (c.target.environment === 'production' && !c.productionWritesAcknowledged) return false;
  return true;
}

export const DEMO_TARGET_RULES: Rule[] = [
  { id: 'R1', text: 'A booking must have a party size between 1 and 8 guests.', source: 'demo_target' },
  { id: 'R2', text: 'The guest name must contain visible characters (not only spaces).', source: 'demo_target' },
  { id: 'R3', text: 'Bookings cannot be made for a date in the past.', source: 'demo_target' },
  { id: 'R4', text: 'A signed-in user can only see their own bookings.', source: 'demo_target' },
  { id: 'R5', text: 'The booking form must be usable on a phone: the submit button must be reachable and not covered.', source: 'demo_target' },
];

export function demoTargetContract(origin: string, now = new Date()): RunContract {
  return {
    version: 1,
    target: { origin, environment: 'staging', apiOrigins: [], verification: { kind: 'demo_target' } },
    testMode: 'active',
    productionWritesAcknowledged: false,
    description: 'Harbor Table is a restaurant booking site. Visitors create an account, book a table, then view, edit or cancel their bookings.',
    goals: [
      'Create an account and sign in.',
      'Create, edit and cancel a booking.',
      'Try unexpected inputs and orderings on the booking form and check the rules hold.',
      'Check the booking form on a phone-sized screen.',
    ],
    rules: withBaselineRules(DEMO_TARGET_RULES),
    capabilities: { register: true, login: true, createRecords: true, editRecords: true, cancelRecords: true, boundaryValues: true, repeatSubmission: true, unusualOrder: true, crossAccountRead: true },
    accounts: [],
    registration: { allowed: true, emailDomain: 'example.test', maxIdentities: 3 },
    deniedPathPrefixes: ['/__lab'],
    deniedPathKeywords: [],
    deniedOperations: ['Do not use the lab reset endpoint.'],
    handoff: { enabled: false, startPath: '/' },
    devices: ['desktop', 'mobile'],
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  };
}
