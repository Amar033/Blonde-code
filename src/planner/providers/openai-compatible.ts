import type { LLMProvider, LLMCallOptions, LLMResponse, LLMStreamDelta } from './base.js';

// Context window sizes for common OpenAI models
const CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o':              128000,
  'gpt-4o-mini':         128000,
  'gpt-4-turbo':         128000,
  'gpt-4':               8192,
  'gpt-3.5-turbo':       16385,
  'o1':                  200000,
  'o1-mini':             128000,
  'o3-mini':             200000,
  'o3':                  200000,
  // Common local/compatible model names
  'llama':               8192,
  'mistral':             32768,
  'mixtral':             32768,
  'qwen':                32768,
  'deepseek':            64000,
  'phi':                 131072,
  'gemma':               8192,
};

export class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(
    apiKey: string,
    model = 'gpt-4o-mini',
    baseURL = 'https://api.openai.com/v1',
    name = 'openai',
  ) {
    this.apiKey  = apiKey;
    this.model   = model;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.name    = name;
  }

  async getContextWindow(): Promise<number> {
    for (const [prefix, size] of Object.entries(CONTEXT_WINDOWS)) {
      if (this.model.toLowerCase().startsWith(prefix)) return size;
    }
    return 128000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: options?.systemPrompt ?? 'You are a helpful assistant.' },
          { role: 'user',   content: prompt },
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens:  options?.maxTokens   ?? 2000,
      }),
      signal: AbortSignal.timeout(options?.timeout ?? 180_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[${this.name.toUpperCase()}] API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: data.usage ? {
        promptTokens:     data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens:      data.usage.total_tokens,
      } : undefined,
      model: data.model ?? this.model,
    };
  }

  async *stream(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: options?.systemPrompt ?? 'You are a helpful assistant.' },
          { role: 'user',   content: prompt },
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens:  options?.maxTokens   ?? 2000,
        stream: true,
      }),
      signal: AbortSignal.timeout(options?.timeout ?? 600_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[${this.name.toUpperCase()}] Stream error (${res.status}): ${err}`);
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
        if (payload === '[DONE]') {
          yield { type: 'done', content: '' };
          return;
        }
        try {
          const parsed  = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content ?? '';
          if (content) yield { type: 'content', content };
        } catch {
          // skip malformed chunks
        }
      }
    }

    yield { type: 'done', content: '' };
  }
}
