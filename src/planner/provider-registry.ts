import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LLMProvider } from './providers/base.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { AnthropicProvider } from './providers/anthropic.js';

export type ProviderType = 'ollama' | 'openrouter' | 'openai' | 'anthropic' | 'openai-compatible';

export interface ProviderEntry {
  name:     string;
  type:     ProviderType;
  apiKey?:  string;
  model:    string;
  baseURL?: string;
}

interface StoredConfig {
  providers: Record<string, ProviderEntry>;
  active?:   string;
}

const CONFIG_DIR  = join(homedir(), '.blonde');
const CONFIG_PATH = join(CONFIG_DIR, 'providers.json');

// Default models per provider type
const DEFAULT_MODELS: Record<ProviderType, string> = {
  'ollama':             'llama3:latest',
  'openrouter':         'arcee-ai/trinity-large-preview:free',
  'openai':             'gpt-4o-mini',
  'anthropic':          'claude-haiku-4-5-20251001',
  'openai-compatible':  'llama3',
};

export class ProviderRegistry {
  private cfg: StoredConfig = { providers: {} };
  private ready = false;

  async load(): Promise<void> {
    if (this.ready) return;
    try {
      const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
      this.cfg   = JSON.parse(raw);
    } catch {
      this.cfg = { providers: {} };
    }
    this.ready = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(this.cfg, null, 2), 'utf-8');
  }

  async add(entry: ProviderEntry): Promise<void> {
    await this.load();
    // Fill in default model if not supplied
    if (!entry.model) entry.model = DEFAULT_MODELS[entry.type] ?? 'unknown';
    this.cfg.providers[entry.name] = entry;
    await this.persist();
  }

  async remove(name: string): Promise<boolean> {
    await this.load();
    if (!this.cfg.providers[name]) return false;
    delete this.cfg.providers[name];
    if (this.cfg.active === name) delete this.cfg.active;
    await this.persist();
    return true;
  }

  async setActive(name: string): Promise<boolean> {
    await this.load();
    if (!this.cfg.providers[name]) return false;
    this.cfg.active = name;
    await this.persist();
    return true;
  }

  async clearActive(): Promise<void> {
    await this.load();
    delete this.cfg.active;
    await this.persist();
  }

  async getActive(): Promise<ProviderEntry | null> {
    await this.load();
    if (!this.cfg.active) return null;
    return this.cfg.providers[this.cfg.active] ?? null;
  }

  async list(): Promise<Array<ProviderEntry & { isActive: boolean }>> {
    await this.load();
    return Object.values(this.cfg.providers).map(p => ({
      ...p,
      isActive: p.name === this.cfg.active,
    }));
  }

  async get(name: string): Promise<ProviderEntry | null> {
    await this.load();
    return this.cfg.providers[name] ?? null;
  }

  createProviderInstance(entry: ProviderEntry): LLMProvider {
    switch (entry.type) {
      case 'ollama':
        return new OllamaProvider(entry.model, entry.baseURL ?? 'http://localhost:11434');

      case 'openrouter':
        if (!entry.apiKey) throw new Error(`Provider "${entry.name}" is missing an API key`);
        return new OpenRouterProvider(entry.apiKey, entry.model);

      case 'openai':
        if (!entry.apiKey) throw new Error(`Provider "${entry.name}" is missing an API key`);
        return new OpenAICompatibleProvider(entry.apiKey, entry.model, 'https://api.openai.com/v1', `openai:${entry.name}`);

      case 'anthropic':
        if (!entry.apiKey) throw new Error(`Provider "${entry.name}" is missing an API key`);
        return new AnthropicProvider(entry.apiKey, entry.model);

      case 'openai-compatible':
        if (!entry.baseURL) throw new Error(`Provider "${entry.name}" requires a baseURL`);
        return new OpenAICompatibleProvider(
          entry.apiKey ?? '',
          entry.model,
          entry.baseURL,
          `custom:${entry.name}`,
        );

      default:
        throw new Error(`Unknown provider type: ${(entry as any).type}`);
    }
  }
}

// Singleton — shared across the process
export const providerRegistry = new ProviderRegistry();

// Convenience: parse a /provider add command line into a ProviderEntry.
// Syntax: <name> <type> <apiKey_or_-> [model] [baseURL]
export function parseProviderAdd(args: string[]): ProviderEntry | string {
  const [name, type, apiKeyArg, modelArg, baseURLArg] = args;

  if (!name || !type) {
    return 'Usage: /provider add <name> <type> <apiKey|-> [model] [baseURL]\n' +
           'Types: openai · anthropic · openrouter · openai-compatible · ollama';
  }

  const validTypes: ProviderType[] = ['ollama', 'openrouter', 'openai', 'anthropic', 'openai-compatible'];
  if (!validTypes.includes(type as ProviderType)) {
    return `Unknown type "${type}". Valid types: ${validTypes.join(', ')}`;
  }

  const providerType = type as ProviderType;
  const apiKey       = apiKeyArg && apiKeyArg !== '-' ? apiKeyArg : undefined;
  const model        = modelArg  ?? DEFAULT_MODELS[providerType];
  const baseURL      = baseURLArg ?? undefined;

  // Validation
  if (providerType !== 'ollama' && providerType !== 'openai-compatible' && !apiKey) {
    return `Provider type "${type}" requires an API key (pass - to skip)`;
  }
  if (providerType === 'openai-compatible' && !baseURL) {
    return 'openai-compatible requires a baseURL — e.g. http://localhost:8080/v1';
  }

  return { name, type: providerType, apiKey, model, baseURL };
}
