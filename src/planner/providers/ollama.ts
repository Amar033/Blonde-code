import type {LLMProvider, LLMCallOptions, LLMResponse, LLMStreamDelta} from './base.js';
import { promises as fs } from 'fs';

function makeSignal(options: LLMCallOptions | undefined, defaultMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(options?.timeout ?? defaultMs);
  return options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}
import { join } from 'path';
import { homedir } from 'os';

// Checks if a directory looks like an Ollama models dir (has blobs/ or manifests/)
async function isOllamaModelsDir(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.includes('blobs') || entries.includes('manifests');
  } catch {
    return false;
  }
}

// Recursively scans a root path up to `depth` levels for an Ollama models directory.
// Checks the dir itself, then common sub-paths, then recurses.
async function scanForModels(root: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  try {
    if (await isOllamaModelsDir(root)) return root;

    // Common sub-paths people use for Ollama storage
    for (const sub of ['LLM/models', 'ollama/models', 'models', 'ai/models', '.ollama/models']) {
      const candidate = join(root, sub);
      if (await isOllamaModelsDir(candidate)) return candidate;
    }

    // Recurse one level into the directory
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = await scanForModels(join(root, entry.name), depth + 1);
      if (found) return found;
    }
  } catch {
    // inaccessible — skip
  }
  return null;
}

/**
 * Scans common locations for an Ollama models directory.
 * Returns all candidates: { path, source } sorted by confidence.
 */
export async function findOllamaModelsDirs(): Promise<Array<{ path: string; source: string }>> {
  const results: Array<{ path: string; source: string }> = [];

  // 1. Explicit env var
  const envPath = process.env.OLLAMA_MODELS;
  if (envPath && await isOllamaModelsDir(envPath)) {
    results.push({ path: envPath, source: 'OLLAMA_MODELS env' });
  }

  // 2. Default Ollama location
  const defaultPath = join(homedir(), '.ollama', 'models');
  if (await isOllamaModelsDir(defaultPath)) {
    results.push({ path: defaultPath, source: 'default (~/.ollama/models)' });
  }

  // 3. Scan removable media (Linux)
  const mediaPaths = [
    `/media/${process.env.USER ?? process.env.LOGNAME ?? 'user'}`,
    '/media',
    '/mnt',
    '/run/media',
  ];
  for (const root of mediaPaths) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = await scanForModels(join(root, entry.name));
        if (found && !results.some(r => r.path === found)) {
          results.push({ path: found, source: `removable media (${join(root, entry.name)})` });
        }
      }
    } catch {
      // location doesn't exist on this system
    }
  }

  return results;
}

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
      const response = await fetch(`${this.baseURL}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getContextWindow(): Promise<number> {
    try {
      const response = await fetch(`${this.baseURL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const data = await response.json();
        // Ollama exposes context_length in model_info under various keys
        const info = data.model_info ?? {};
        const ctxKey = Object.keys(info).find(k => k.includes('context_length'));
        if (ctxKey && typeof info[ctxKey] === 'number') return info[ctxKey];
      }
    } catch {
      // fall through
    }
    return 8192; // safe default (matches num_ctx below)
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseURL}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models ?? []).map((m: any) => m.name as string);
    } catch {
      return [];
    }
  }

  setModel(model: string): void {
    this.model = model;
  }

  async *stream(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown> {
    const systemPrompt = options?.systemPrompt || this.getSystemPrompt(options?.mode);
    const requestBody = JSON.stringify({
      model: this.model,
      messages: [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: prompt}
      ],
      stream: true,
      options: { temperature: options?.temperature ?? 0.7, num_ctx: 8192 },
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt++) {
      let hasYielded = false;
      try {
        const response = await fetch(`${this.baseURL}/api/chat`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: requestBody,
          signal: makeSignal(options, 600_000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama error (${response.status}): ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

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
                hasYielded = true;
                yield { type: 'content', content };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        yield { type: 'done', content: '' };
        return;
      } catch (error) {
        lastError = error;
        const isTimeout = error instanceof Error && (
          error.name === 'TimeoutError' ||
          (error as any).code === 'UND_ERR_HEADERS_TIMEOUT'
        );
        if (!hasYielded && isTimeout && attempt < 2) {
          console.error('[OLLAMA] Stream timeout on attempt 1, retrying...');
          continue;
        }
        break;
      }
    }

    console.error('[OLLAMA] Stream error:', lastError);
    throw new Error(`Ollama stream failed: ${lastError}`);
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
            num_ctx: 8192,
          }
        }),
        signal: makeSignal(options, 180_000),
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
