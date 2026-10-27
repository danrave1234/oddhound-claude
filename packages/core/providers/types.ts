// Provider-independent chat contract. Application-managed messages (Chat Completions shape).

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type Usage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

export type ChatResult = {
  message: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
  usage: Usage | null;
  finishReason: string;
  requestId: string | null;
  model: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CapabilityProfile = {
  tools: boolean;
  images: boolean;
  imagesInToolMessages: boolean;
  toolChoiceValues: readonly ('auto' | 'required' | 'none')[];
  structuredOutput: boolean;
};

export interface ChatProvider {
  readonly id: string; // e.g. "meta-direct"
  readonly model: string;
  readonly isMetaModel: boolean;
  readonly capability: CapabilityProfile;
  readonly label: string; // shown in run details
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class ProviderError extends Error {
  readonly kind: 'timeout' | 'http' | 'network' | 'invalid_response' | 'aborted';
  readonly status?: number;
  /** True when the provider may have processed (and billed) the request. */
  readonly maybeBilled: boolean;
  constructor(kind: ProviderError['kind'], message: string, maybeBilled: boolean, status?: number) {
    super(message); this.kind = kind; this.maybeBilled = maybeBilled; this.status = status;
  }
}
