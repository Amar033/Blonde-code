import type {LLMProvider, LLMCallOptions, LLMStreamDelta} from './providers/base.js';
import type { ConversationTurn } from '../runtime/core.js';

// Chunk yielded by planStream / actStream
export type StreamChunk =
  | { type: 'token'; content: string; thinking?: string; inThinkBlock: boolean }
  | { type: 'done';  response: PlannerResponse };

// Extracts <think>...</think> from a partial stream in real time.
// While inside the block, `inThinkBlock` is true and `thinking` holds everything so far.
// Once </think> is seen, `thinking` is the complete thought and `inThinkBlock` is false.
function extractThinkingLive(text: string): { thinking: string; inThinkBlock: boolean } {
  const start = text.indexOf('<think>');
  if (start === -1) return { thinking: '', inThinkBlock: false };

  const end = text.indexOf('</think>', start);
  if (end === -1) {
    // Still inside the block
    return { thinking: text.slice(start + '<think>'.length).trim(), inThinkBlock: true };
  }
  return { thinking: text.slice(start + '<think>'.length, end).trim(), inThinkBlock: false };
}
import type {PlannerResponse} from '../types/events.js';
import {OpenRouterProvider} from './providers/openrouter.js';
import {OllamaProvider, findOllamaModelsDirs} from './providers/ollama.js';
import {Tool} from '../tools/base.js';
import type {AgentConfig} from '../agent/agent';

export class LLMClient {
  private provider: LLMProvider;
  private agentConfig?: AgentConfig;
  // Tracks the prompt token count of the most recent LLM call.
  // We use the latest prompt_eval_count (not a running sum) because each act() call
  // re-sends the entire observation history — so the latest value reflects true context usage.
  private latestPromptTokens = 0;
  private cachedContextWindow: number | null = null;

  constructor(provider: LLMProvider, agentConfig?: AgentConfig) {
    this.provider = provider;
    this.agentConfig = agentConfig;
  }

  getTokenUsage(): number {
    return this.latestPromptTokens;
  }

  async getContextWindow(): Promise<number> {
    if (this.cachedContextWindow === null) {
      this.cachedContextWindow = await this.provider.getContextWindow();
    }
    return this.cachedContextWindow;
  }

  private trackUsage(response: { usage?: { promptTokens: number } }): void {
    if (response.usage?.promptTokens) {
      this.latestPromptTokens = response.usage.promptTokens;
    }
  }

  static async fromEnv(agentConfig?: AgentConfig): Promise<LLMClient> {
    const providerName = process.env.LLM_PROVIDER || 'ollama';
    const apikey = process.env.OPENROUTER_API_KEY;
    const model = process.env.LLM_MODEL || 'qwen3.5:latest';

    if (providerName === 'ollama') {
      const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const provider = new OllamaProvider(model, baseURL);

      const available = await provider.isAvailable();
      if (!available) {
        // Scan for model directories on USB drives / mounted media
        const candidates = await findOllamaModelsDirs();
        if (candidates.length > 0) {
          const best = candidates[0];
          // Auto-set for this process (only affects Ollama if we also start the server)
          process.env.OLLAMA_MODELS = best.path;
          const locations = candidates.map(c => `  • ${c.path}  (${c.source})`).join('\n');
          throw new Error(
            `Ollama server is not running.\n` +
            `Found model directories:\n${locations}\n\n` +
            `Start Ollama pointing to your models:\n` +
            `  OLLAMA_MODELS="${best.path}" ollama serve\n\n` +
            `Or add to your .env:\n` +
            `  OLLAMA_MODELS=${best.path}`
          );
        }
        throw new Error(
          'Ollama server is not running.\n' +
          'Start it with:  ollama serve\n' +
          'If your models are on a USB drive, start with:\n' +
          '  OLLAMA_MODELS=/path/to/drive/models ollama serve\n' +
          'Add OLLAMA_MODELS to your .env file to make it permanent.'
        );
      }
      return new LLMClient(provider, agentConfig);
    }

    if (!apikey) {
      throw new Error('OPENROUTER_API_KEY not set in .env');
    }

    const provider = new OpenRouterProvider(apikey, model);

    const available = await provider.isAvailable();
    if (!available) {
      throw new Error(`Provider ${providerName} is not available`);
    }

    return new LLMClient(provider, agentConfig);
  }

  private getTemperature(mode: 'plan' | 'act' | 'finalize'): number {
    if (!this.agentConfig?.temperature) {
      switch (mode) {
        case 'plan':     return 0.7;
        case 'act':      return 0.5;
        case 'finalize': return 0.3;
      }
    }
    return this.agentConfig.temperature;
  }

  supportsStreaming(): boolean {
    return typeof this.provider.stream === 'function';
  }

  async *streamPrompt(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown> {
    if (!this.supportsStreaming()) {
      const response = await this.provider.call(prompt, options);
      yield { type: 'content', content: response.content };
      yield { type: 'done', content: '' };
      return;
    }
    yield* this.provider.stream!(prompt, options);
  }

  // Build the system prompt: agent's configured prompt (if any) prepended to the mode-specific one
  private buildSystemPrompt(modePrompt: string): string {
    const agentPrompt = this.agentConfig?.prompt;
    return agentPrompt ? `${agentPrompt}\n\n---\n\n${modePrompt}` : modePrompt;
  }

  // ── Prompt builders (shared between blocking and streaming callers) ───────────

  private buildHistorySection(history: ConversationTurn[]): string {
    if (!history.length) return '';
    const lines = history.map(t => {
      const prefix = t.role === 'user' ? 'User' : 'Assistant';
      // Truncate very long responses to save tokens
      const body = t.content.length > 400 ? t.content.slice(0, 400) + '…' : t.content;
      return `${prefix}: ${body}`;
    }).join('\n');
    return `PREVIOUS CONVERSATION (use this to understand references like "that", "it", "again"):\n${lines}\n\n`;
  }

  private buildPlanPrompt(input: string, history: ConversationTurn[] = []): { prompt: string; systemPrompt: string } {
    return {
      systemPrompt: this.buildSystemPrompt(
        'You are a strategic planning assistant. Analyze the user request and create a high-level plan. Always respond in valid JSON format.'
      ),
      prompt: `${this.buildHistorySection(history)}Create a step-by-step plan for this task. Make autonomous decisions — do NOT ask the user for clarification.

UserRequest: ${input}

Rules:
- If the request is vague (e.g. "edit any file"), pick one yourself and plan around it.
- If the request asks to edit an existing file, plan to use edit_file (not write_file).
- ALWAYS respond with type "plan". Never respond with "need_info" or "answer" here.
- If the request refers to something from the conversation history (e.g. "do that again", "repeat it"), look at the history to understand what to repeat.

Respond ONLY with this JSON (no markdown fences, no extra text):
{"type":"plan","steps":["step1","step2"],"reasoning":"why this approach","estimatedToolCalls":3}`,
    };
  }

  async plan(input: string, history: ConversationTurn[] = []): Promise<PlannerResponse> {
    const { prompt, systemPrompt } = this.buildPlanPrompt(input, history);
    const response = await this.provider.call(prompt, {
      mode: 'plan', systemPrompt,
      temperature: this.getTemperature('plan'),
      maxTokens: 1500,
    });
    this.trackUsage(response);
    return this.parseResponse(response.content);
  }

  // Streams plan tokens. Yields {type:'token',...} per chunk then {type:'done', response} at end.
  async *planStream(input: string, history: ConversationTurn[] = []): AsyncGenerator<StreamChunk> {
    const { prompt, systemPrompt } = this.buildPlanPrompt(input, history);
    const opts: LLMCallOptions = { mode: 'plan', systemPrompt, temperature: this.getTemperature('plan'), maxTokens: 1500 };

    if (!this.supportsStreaming()) {
      const res = await this.provider.call(prompt, opts);
      this.trackUsage(res);
      yield { type: 'done', response: this.parseResponse(res.content) };
      return;
    }

    let accumulated = '';
    for await (const delta of this.provider.stream!(prompt, opts)) {
      if (delta.type === 'content') {
        accumulated += delta.content;
        const { thinking, inThinkBlock } = extractThinkingLive(accumulated);
        yield { type: 'token', content: accumulated, thinking, inThinkBlock };
      }
    }
    yield { type: 'done', response: this.parseResponse(accumulated) };
  }

  async generateSessionName(firstMessage: string): Promise<string> {
    try {
      const response = await this.provider.call(
        `Create a short 3-5 word title for this session. Return ONLY the title, no quotes, no punctuation, no explanation.\n\nUser said: "${firstMessage.slice(0, 200)}"`,
        { mode: 'plan', maxTokens: 20, temperature: 0.5, timeout: 30_000 }
      );
      const name = response.content
        .replace(/^["']|["']$/g, '')
        .replace(/\n.*/s, '')
        .trim();
      return name.length > 2 && name.length < 60 ? name : firstMessage.slice(0, 40);
    } catch {
      return firstMessage.slice(0, 40);
    }
  }

  private buildActPrompt(
    plan: string,
    observations: string[],
    availableTools: Tool[],
    userInput?: string,
    toolCallHistory?: string,
    forceSynthesis?: boolean,
    history: ConversationTurn[] = []
  ): { prompt: string; systemPrompt: string } {
    const toolDescriptions      = this.formatToolsForLLM(availableTools);
    const lastObs               = observations.at(-1) ?? '';
    const secondLastObs         = observations.at(-2) ?? '';
    const loopWarning = (lastObs && secondLastObs &&
      lastObs.substring(0, 50) === secondLastObs.substring(0, 50))
      ? '\n⚠️ WARNING: You appear to be repeating the same action! Try a DIFFERENT approach.\n' : '';
    const historyNote = toolCallHistory
      ? `\nTOOLS ALREADY CALLED:\n${toolCallHistory}\n\nIMPORTANT: Don't call a tool again with the same arguments!\n` : '';
    const synthesisWarning = forceSynthesis
      ? `\n⚠️ CRITICAL: You have gathered ${observations.length} observations! STOP calling tools and provide your final answer now.\n` : '';

    const historySection = this.buildHistorySection(history);
    const prompt = `You are executing a plan to help the user. You have access to these tools:

${toolDescriptions}

${historySection}USER REQUEST: ${userInput || 'Not provided'}

CURRENT PLAN:
${plan}

OBSERVATIONS FROM PREVIOUS ACTIONS:
${observations.length > 0 ? observations.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'None yet - this is the first action.'}
${loopWarning}${historyNote}${synthesisWarning}

YOUR JOB:
- Execute the plan step by step using the available tools
- After each tool result, analyze the result and decide what to do next
- If you have the answer to the user's request, respond with {"type": "answer", "content": "your answer"}
- If you need more info, respond with {"type": "need_info", "question": "what you need"}
- Otherwise, call another tool or continue with the plan

Respond with ONE of these formats:
{"type": "tool_call", "tool": "tool_name", "args": {...}, "reasoning": "why this tool"}
{"type": "answer", "content": "final answer to user"}
{"type": "need_info", "question": "what you need from user"}

CRITICAL RULES:
1. Analyze each tool result before calling the next tool — never re-read a file you already read.
2. EDITING an existing file: use edit_file (find exact text → replace). Do NOT use write_file unless creating a brand-new file.
3. edit_file requires a non-empty "find" string — the exact text that currently exists in the file. Always read the file first, then copy a unique snippet as "find".
4. When the user says "add a space", "add a line", "change a word" — read the file once, then call edit_file immediately.
5. When asked to "choose any file" or given a vague instruction: make the choice yourself, do NOT ask.
6. {"type":"need_info"} is BANNED for choices you can make autonomously. Only use it when the user must supply something you literally cannot guess (e.g. a password or API key).
7. list_files shows subdirectory names — call list_files(subdir) to explore them.
8. git_diff shows changes after an edit — use it to verify your work.
9. NEVER repeat a tool call with the same arguments. If a web search returned 0 results, try a different query or conclude there is no data — do NOT search the same query again.
${forceSynthesis ? '10. STOP NOW — provide your final answer immediately.' : ''}`;

    return {
      prompt,
      systemPrompt: this.buildSystemPrompt(
        'You are an execution assistant for a coding agent. Decide the next action based on the plan, tools, and observations. Always respond in valid JSON format.'
      ),
    };
  }

  async act(
    plan: string, observations: string[], availableTools: Tool[],
    userInput?: string, toolCallHistory?: string, forceSynthesis?: boolean, history: ConversationTurn[] = []
  ): Promise<PlannerResponse> {
    const { prompt, systemPrompt } = this.buildActPrompt(plan, observations, availableTools, userInput, toolCallHistory, forceSynthesis, history);
    const response = await this.provider.call(prompt, {
      mode: 'act', systemPrompt,
      temperature: this.getTemperature('act'),
      maxTokens: 1000,
    });
    this.trackUsage(response);
    return this.parseResponse(response.content);
  }

  // Streams act tokens. Yields {type:'token',...} per chunk then {type:'done', response} at end.
  async *actStream(
    plan: string, observations: string[], availableTools: Tool[],
    userInput?: string, toolCallHistory?: string, forceSynthesis?: boolean, history: ConversationTurn[] = []
  ): AsyncGenerator<StreamChunk> {
    const { prompt, systemPrompt } = this.buildActPrompt(plan, observations, availableTools, userInput, toolCallHistory, forceSynthesis, history);
    const opts: LLMCallOptions = { mode: 'act', systemPrompt, temperature: this.getTemperature('act'), maxTokens: 1000 };

    if (!this.supportsStreaming()) {
      const res = await this.provider.call(prompt, opts);
      this.trackUsage(res);
      yield { type: 'done', response: this.parseResponse(res.content) };
      return;
    }

    let accumulated = '';
    for await (const delta of this.provider.stream!(prompt, opts)) {
      if (delta.type === 'content') {
        accumulated += delta.content;
        const { thinking, inThinkBlock } = extractThinkingLive(accumulated);
        yield { type: 'token', content: accumulated, thinking, inThinkBlock };
      }
    }
    yield { type: 'done', response: this.parseResponse(accumulated) };
  }

  async finalize(plan: string, observations: string[]): Promise<PlannerResponse> {
    const prompt = `You are a coding agent summarizing completed work.
Plan: ${plan}
Observations:
${observations.map((o, i) => `${i + 1}. ${o}`).join('\n')}
Summarize what was accomplished.
Respond in JSON:
{
  "type": "answer",
  "content": "summary of what was done"
}`;

    const systemPrompt = this.buildSystemPrompt(
      'You are a summarization assistant. Review completed work and provide a clear summary. Always respond in valid JSON format.'
    );
    const response = await this.provider.call(prompt, {
      mode: 'finalize',
      systemPrompt,
      temperature: this.getTemperature('finalize'),
      maxTokens: 800,
    });
    return this.parseResponse(response.content);
  }

  private formatToolsForLLM(tools: Tool[]): string {
    return tools.map(tool => {
      const tags = [
        tool.isDangerous ? '⚠️' : '',
        tool.requiresApproval ? '[APPROVAL]' : '',
      ].filter(Boolean).join(' ');

      const header = `${tool.name}${tags ? ' ' + tags : ''}: ${tool.description}`;

      if (!tool.argsSchema?.properties) return header;

      const required = new Set<string>(tool.argsSchema.required ?? []);
      const args = Object.entries(tool.argsSchema.properties)
        .map(([name, schema]: [string, any]) => {
          const req = required.has(name) ? '' : '?';
          const desc = schema.description || schema.type || '';
          return `  ${name}${req}: ${desc}`;
        })
        .join('\n');

      return `${header}\n${args}`;
    }).join('\n');
  }

  // Strips <think>…</think> blocks (Qwen) and Ollama "Thinking..." markers.
  // Returns the extracted thinking text and the cleaned response body separately.
  private extractThinking(content: string): { thinking: string | undefined; cleaned: string } {
    let thinking: string | undefined;
    let cleaned = content;

    // Ollama format: "Thinking...<text>...done thinking."
    const start = content.indexOf('Thinking...');
    const end   = content.indexOf('...done thinking.');

    if (start !== -1 && end !== -1 && end > start) {
      thinking = content.slice(start + 'Thinking...'.length, end).trim();
      cleaned  = content.slice(0, start) + content.slice(end + '...done thinking.'.length);
    }

    // Qwen <think>…</think> format
    const thinkMatch = cleaned.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      cleaned  = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    }

    return { thinking, cleaned: cleaned.trim() };
  }

  private parseResponse(content: string): PlannerResponse {
    let thinking: string | undefined;
    let cleaned: string;

    try {
      ({ thinking, cleaned } = this.extractThinking(content));

      // Strip markdown code fences if the model wrapped the JSON
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(cleaned);

      if (!parsed.type) throw new Error('Missing type field');

      if (thinking && parsed.type === 'tool_call') {
        (parsed as any).thinking = thinking;
      }

      if (parsed.type === 'tool_call' && (!parsed.tool || !parsed.args)) {
        throw new Error('tool_call missing required fields (tool, args)');
      }

      if ((parsed.type === 'answer' || parsed.type === 'need_info') && !parsed.content && !parsed.question) {
        throw new Error(`${parsed.type} missing content/question`);
      }

      return parsed as PlannerResponse;
    } catch {
      // JSON is malformed (often an unescaped " inside the content field from small models).
      // Try to salvage a readable answer by extracting the content value via regex.
      const src = (typeof cleaned! === 'string' ? cleaned! : content);

      const typeMatch = src.match(/"type"\s*:\s*"(\w+)"/);
      const type = typeMatch?.[1];

      if (type === 'tool_call') {
        const toolMatch = src.match(/"tool"\s*:\s*"([^"]+)"/);
        // Can't safely reconstruct args — return a no-op so the runtime can recover
        return { type: 'answer', content: toolMatch
          ? `[Could not parse tool call for "${toolMatch[1]}". The model may have generated invalid JSON.]`
          : '[Could not parse tool call — invalid JSON from model.]' };
      }

      // For answer/plan/etc — extract the raw text after `"content": "`
      const contentIdx = src.indexOf('"content"');
      if (contentIdx !== -1) {
        const afterKey = src.slice(contentIdx + '"content"'.length).replace(/^\s*:\s*"/, '');
        const extracted = afterKey
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '')
          .replace(/\\"/g, '"')
          .replace(/"\s*}?\s*$/, '')
          .trim();
        if (extracted.length > 10) {
          return { type: 'answer', content: extracted };
        }
      }

      // Absolute fallback — return the raw text (toLines will still render it readably)
      return { type: 'answer', content };
    }
  }
}
