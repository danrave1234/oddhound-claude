// Context7 (remote MCP over Streamable HTTP) for version-aware documentation in fix briefs.
// Only the owner-declared library name and a generic topic are sent — never page content, URLs,
// credentials or findings. Any failure (outage, quota, timeout) returns null: a brief must never
// depend on documentation being available (provider plan A02, MVP §12).

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const ENDPOINT = 'https://mcp.context7.com/mcp';
const cache = new Map<string, { at: number; value: { library: string; excerpt: string } | null }>();
const TTL_MS = 60 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('context7 timeout')), ms))]);
}

const textOf = (r: unknown): string => {
  const content = (r as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
};

export async function fetchDocs(library: string, topic: string, opts: { apiKey?: string; timeoutMs?: number } = {}): Promise<{ library: string; excerpt: string } | null> {
  const lib = library.trim().slice(0, 60);
  if (!lib) return null;
  const key = `${lib.toLowerCase()}|${topic}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const client = new Client({ name: 'oddhound', version: '0.1.0' });
  let value: { library: string; excerpt: string } | null = null;
  try {
    const apiKey = opts.apiKey ?? process.env.CONTEXT7_API_KEY;
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : undefined);
    await withTimeout(client.connect(transport), opts.timeoutMs ?? 8_000);
    const resolved = textOf(await withTimeout(client.callTool({ name: 'resolve-library-id', arguments: { libraryName: lib, query: topic } }), opts.timeoutMs ?? 8_000));
    const libraryId = /library ID:\s*(\/[\w.-]+\/[\w.-]+(?:\/[\w.-]+)?)/i.exec(resolved)?.[1];
    if (libraryId) {
      const docs = textOf(await withTimeout(client.callTool({ name: 'query-docs', arguments: { libraryId, query: topic } }), opts.timeoutMs ?? 8_000));
      if (docs.trim()) value = { library: `${lib} (${libraryId})`, excerpt: docs.slice(0, 1800) };
    }
  } catch {
    value = null; // outage, quota or timeout: the brief degrades to stack-neutral guidance
  } finally {
    await client.close().catch(() => {});
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** A generic documentation topic for a scenario kind (no site content). */
export function topicFor(kind: string): string {
  if (kind === 'form_rule') return 'server-side validation of form input in request handlers';
  if (kind === 'cross_account_read' || kind === 'cross_actor') return 'authorization: restrict records to their owner in data access';
  if (kind === 'claim_check') return 'persisting form updates: save every submitted field before reporting success';
  if (kind === 'two_tab') return 'optimistic concurrency control: reject stale updates with a version field';
  if (kind === 'invariant') return 'computing aggregate totals from the same records a page lists';
  if (kind === 'differential') return 'responsive layout: keep actions visible on small screens';
  if (kind === 'interruption') return 'idempotent form submission: prevent duplicate records from repeated requests';
  return 'responsive layout: fixed elements covering content on small screens';
}
