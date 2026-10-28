// Canonical starting limits (MVP plan §8). Money is integer microdollars ($1 = 1_000_000).

export const USD = 1_000_000;

export const LIMITS = {
  concurrentRunsGlobal: 1,
  pendingRunsGlobal: 20,
  pendingRunsPerPrincipal: 1,
  // Oct 28, 2026 (owner decision): the agent runs free inside the cost cap and the rules. Turns and actions are
  // not capped; the clock is only a backstop for a stuck run (browser machine time costs money too).
  runWallClockMs: 60 * 60_000,
  queueEntryTtlMs: 15 * 60_000,
  browserActionsPerRun: Number.POSITIVE_INFINITY,
  modelTurnsPerRun: Number.POSITIVE_INFINITY,
  modelSpendPerRunMicros: 2 * USD,
  publicDailyMicros: 7 * USD,
  publicLifetimeMicros: 50 * USD,
  judgingReserveMicros: 15 * USD,
  minActionIntervalMs: 300, // polite pacing for the tested site (was 1 s)
  registrationIdentitiesPerRun: 3,
  targetRequestsPerRun: 6_000,
  targetConcurrentRequests: 6,
  targetBytesPerRun: 200 * 1024 * 1024,
  targetBytesPerResource: 8 * 1024 * 1024,
  artifactBytesPerRun: 100 * 1024 * 1024,
  stopContextCloseMs: 5_000,
  maxScreenshotWidth: 1280,
  maxScreenshotHeight: 900,
  // Muse Spark is a reasoning model: hidden reasoning counts against max_tokens (a 300-token cap
  // returned finish_reason "length" before any tool call in the Oct 27 smoke test).
  maxOutputTokens: 4_000,
  // Conservative per-image token bound for cost reservation (screenshots are capped at 1280x900 JPEG).
  imageTokenBound: 3_000,
} as const;

export const DEVICE_PROFILES = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
} as const;
export type DeviceProfileName = keyof typeof DEVICE_PROFILES;

export const USER_AGENT_SUFFIX = 'Oddhound/1.0';
