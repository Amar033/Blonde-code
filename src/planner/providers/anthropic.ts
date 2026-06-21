import type { LLMProvider, LLMCallOptions, LLMResponse, LLMStreamDelta } from './base.js';

const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4':      200000,
  'claude-sonnet-4':    200000,
  'claude-haiku-4':     200000,
  'claude-3-5-sonnet':  200000,
  'claude-3-5-haiku':   200000,
  'claude-3-opus':      200000,
  'claude-3-sonnet':    200000,
  'claude-3-haiku':     200000,
};

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseURL = 'https://api.anthropic.com/v1';

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async getContextWindow(): Promise<number> {
    for (const [key, size] of Object.entries(CONTEXT_WINDOWS)) {
      if (this.model.includes(key)) return size;
    }
    return 200000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: {
          'x-api-key':          this.apiKey,
          'anthropic-version':  '2023-06-01',
        },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key':          this.apiKey,
        'anthropic-version':  '2023-06-01',
        'Content-Type':       'application/json',
      },
      body: JSON.stringify({
        model:      this.model,
        system:     options?.systemPrompt ?? 'You are a helpful assistant.',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: options?.maxTokens   ?? 2000,
        temperature: options?.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(options?.timeout ?? 180_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[ANTHROPIC] API error (${res.status}): ${err}`);
    }

    const data    = await res.json();
    const content = data.content?.[0]?.text ?? '';
    return {
      content,
      usage: data.usage ? {
        promptTokens:     data.usage.input_tokens  ?? 0,
        completionTokens: data.usage.output_tokens ?? 0,
        totalTokens:      (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
      } : undefined,
      model: data.model ?? this.model,
    };
  }

  async *stream(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown> {
    const res = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key':          this.apiKey,
        'anthropic-version':  '2023-06-01',
        'Content-Type':       'application/json',
      },
      body: JSON.stringify({
        model:       this.model,
        system:      options?.systemPrompt ?? 'You are a helpful assistant.',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  options?.maxTokens   ?? 2000,
        temperature: options?.temperature ?? 0.7,
        stream: true,
      }),
      signal: AbortSignal.timeout(options?.timeout ?? 600_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[ANTHROPIC] Stream error (${res.status}): ${err}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        try {
          const parsed = JSON.parse(payload);
          // text delta from content block
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { type: 'content', content: parsed.delta.text };
          }
          if (parsed.type === 'message_stop') {
            yield { type: 'done', content: '' };
            return;
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    yield { type: 'done', content: '' };
  }
}
