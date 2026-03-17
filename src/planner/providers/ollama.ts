import type {LLMProvider, LLMCallOptions, LLMResponse, LLMStreamDelta} from './base.js';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseURL: string;
  private model: string;

  constructor(model: string, baseURL = 'http://localhost:11434') {
    this.model = model;
    this.baseURL = baseURL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async *stream(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown> {
    const systemPrompt = options?.systemPrompt || this.getSystemPrompt(options?.mode);

    try {
      const response = await fetch(`${this.baseURL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: this.model,
          messages: [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: prompt}
          ],
          stream: true,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_ctx: 8192,
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const content = data.message?.content || '';
            if (content) {
              yield { type: 'content', content };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      yield { type: 'done', content: '' };
    } catch (error) {
      console.error('[OLLAMA] Stream error:', error);
      throw new Error(`Ollama stream failed: ${error}`);
    }
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const systemPrompt = options?.systemPrompt || this.getSystemPrompt(options?.mode);

    try {
      const response = await fetch(`${this.baseURL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: this.model,
          messages: [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: prompt}
          ],
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_ctx: 8192, // Start conservative, increase later
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.message?.content || '';

      return {
        content,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        model: this.model,
      };
    } catch (error) {
      console.error('[OLLAMA] Error:', error);
      throw new Error(`Ollama call failed: ${error}`);
    }
  }

  private getSystemPrompt(mode?: string): string {
    switch(mode) {
      case 'plan':
        return `You are a strategic planning assistant for a coding agent. Analyze requests and create high-level plans. Always respond in valid JSON format.`;
      
      case 'act':
        return `You are an execution assistant for a coding agent. Decide the next action based on available tools, plans, and observations. Always respond in valid JSON format.`;
      
      case 'finalize':
        return `You are a summarization assistant for a coding agent. Review completed work and provide clear summaries. Always respond in valid JSON format.`;
      
      default: 
        return 'You are a helpful coding assistant. Always respond in valid JSON when requested.';
    }
  }
}
