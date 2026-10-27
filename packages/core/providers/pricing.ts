// Recorded per-model prices (USD per 1M tokens) from the provider pages in the research register
// (P4, P5, P14). A model without a price is a blocked prerequisite, never treated as free.

import type { ChatMessage, Usage } from './types.ts';
import { LIMITS } from '../contracts/limits.ts';

export type Price = { inputPerM: number; cachedInputPerM: number; outputPerM: number; source: string };

const PRICES: Record<string, Price> = {
  'meta-direct/muse-spark-1.3': { inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25, source: 'P14 dev.meta.ai/models/muse-spark (Oct 27, 2026)' },
  'baseten/meta-models/muse-spark-open-1026': { inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25, source: 'P4 baseten.co/library/muse-spark-open (Oct 27, 2026)' },
  'fireworks/accounts/fireworks/models/muse-spark-open': { inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25, source: 'P5 fireworks.ai/models/fireworks/muse-spark-open (Oct 27, 2026)' },
  // The offline test double costs nothing and never calls a provider.
  'test-double/heuristic-planner': { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0, source: 'offline test double' },
};

export function priceFor(providerId: string, model: string): Price | null {
  return PRICES[`${providerId}/${model}`] ?? null;
}

/** Conservative token upper bound for a serialized request (chars/3, images at a fixed bound). */
export function inputTokenBound(messages: ChatMessage[], toolsJson: string): number {
  let chars = toolsJson.length;
  let images = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) for (const p of m.content) { if (p.type === 'text') chars += p.text.length; else images++; }
    if (m.role === 'assistant' && m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    chars += 16;
  }
  return Math.ceil(chars / 3) + images * LIMITS.imageTokenBound;
}

const micros = (tokens: number, perM: number) => Math.ceil((tokens * perM * 1_000_000) / 1_000_000);

/** Upper bound in microdollars: all input billed uncached plus the full output cap. */
export function reservationMicros(price: Price, inputTokens: number, maxOutputTokens: number): number {
  return micros(inputTokens, price.inputPerM) + micros(maxOutputTokens, price.outputPerM) + 1;
}

export function actualMicros(price: Price, usage: Usage): number {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return micros(uncached, price.inputPerM) + micros(usage.cachedInputTokens, price.cachedInputPerM) + micros(usage.outputTokens, price.outputPerM);
}
