// The immutable run contract the owner approves (MVP plan §17 "Active testing contract").
// It bounds origins, actors, capabilities, denied operations and resources, while letting the
// agent discover new in-scope UI paths without per-click approval.

import { z } from 'zod';
import { DEVICE_PROFILES } from './limits.ts';

export const RuleSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  text: z.string().min(3).max(400),
  source: z.enum(['owner', 'demo_target']),
});
export type Rule = z.infer<typeof RuleSchema>;

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
  goals: z.array(z.string().min(3).max(300)).min(1).max(8),
  rules: z.array(RuleSchema).max(20),
  capabilities: CapabilitiesSchema,
  accounts: z.array(AccountRefSchema).max(4),
  registration: z.object({ allowed: z.boolean(), emailDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), maxIdentities: z.number().int().min(0).max(3) }),
  deniedPathPrefixes: z.array(z.string().startsWith('/')).max(30),
  deniedOperations: z.array(z.string().max(200)).max(20),
  devices: z.array(z.enum(Object.keys(DEVICE_PROFILES) as ['desktop', 'mobile'])).min(1).max(2),
  expiresAt: z.string(),
});
export type RunContract = z.infer<typeof RunContractSchema>;

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
    rules: DEMO_TARGET_RULES,
    capabilities: { register: true, login: true, createRecords: true, editRecords: true, cancelRecords: true, boundaryValues: true, repeatSubmission: true, unusualOrder: true, crossAccountRead: true },
    accounts: [],
    registration: { allowed: true, emailDomain: 'example.test', maxIdentities: 3 },
    deniedPathPrefixes: ['/__lab'],
    deniedOperations: ['Do not use the lab reset endpoint.'],
    devices: ['desktop', 'mobile'],
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  };
}
