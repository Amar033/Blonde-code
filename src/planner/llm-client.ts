import type {LLMProvider, LLMCallOptions, LLMStreamDelta} from './providers/base.js';
import type {PlannerResponse} from '../types/events.js';
import {OpenRouterProvider} from './providers/openrouter.js';
import {OllamaProvider} from './providers/ollama.js';
import {Tool} from '../tools/base.js';
import type {AgentConfig} from '../agent/agent';

export class LLMClient {
  private provider: LLMProvider;
  private agentConfig?: AgentConfig;

  constructor(provider: LLMProvider, agentConfig?: AgentConfig) {
    this.provider = provider;
    this.agentConfig = agentConfig;
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
        throw new Error('Ollama server not running. Start it with: ollama serve');
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

  async plan(input: string): Promise<PlannerResponse> {
    const systemPrompt = this.buildSystemPrompt(
      'You are a strategic planning assistant. Analyze the user request and create a high-level plan. Always respond in valid JSON format.'
    );
    const prompt = `Create a step-by-step plan for this task. Make autonomous decisions — do NOT ask the user for clarification.

UserRequest: ${input}

Rules:
- If the request is vague (e.g. "edit any file"), pick one yourself and plan around it.
- If the request asks to edit an existing file, plan to use edit_file (not write_file).
- ALWAYS respond with type "plan". Never respond with "need_info" or "answer" here.

Respond ONLY with this JSON (no markdown fences, no extra text):
{"type":"plan","steps":["step1","step2"],"reasoning":"why this approach","estimatedToolCalls":3}`;
    const response = await this.provider.call(prompt, {
      mode: 'plan',
      systemPrompt,
      temperature: this.getTemperature('plan'),
      maxTokens: 1500,
    });
    return this.parseResponse(response.content);
  }

  async act(
    plan: string,
    observations: string[],
    availableTools: Tool[],
    userInput?: string,
    toolCallHistory?: string,
    forceSynthesis?: boolean
  ): Promise<PlannerResponse> {
    const toolDescriptions = this.formatToolsForLLM(availableTools);

    const lastObservation       = observations.at(-1) ?? '';
    const secondLastObservation = observations.at(-2) ?? '';

    const loopWarning = (lastObservation && secondLastObservation &&
      lastObservation.substring(0, 50) === secondLastObservation.substring(0, 50))
      ? `\n⚠️ WARNING: You appear to be repeating the same action! Try a DIFFERENT approach.\n`
      : '';

    const historyNote = toolCallHistory
      ? `\nTOOLS ALREADY CALLED:\n${toolCallHistory}\n\nIMPORTANT: Don't call a tool again with the same arguments!\n`
      : '';

    const synthesisWarning = forceSynthesis
      ? `\n⚠️ CRITICAL: You have gathered ${observations.length} observations! STOP calling tools and provide your final answer now.\n`
      : '';

    const prompt = `You are executing a plan to help the user. You have access to these tools:

${toolDescriptions}

USER REQUEST: ${userInput || 'Not provided'}

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

    const systemPrompt = this.buildSystemPrompt(
      'You are an execution assistant for a coding agent. Decide the next action based on the plan, tools, and observations. Always respond in valid JSON format.'
    );
    const response = await this.provider.call(prompt, {
      mode: 'act',
      systemPrompt,
      temperature: this.getTemperature('act'),
      maxTokens: 1000,
    });

    return this.parseResponse(response.content);
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
      let argsList = '  (no arguments)';

      if (tool.argsSchema?.properties) {
        argsList = Object.entries(tool.argsSchema.properties)
          .map(([name, schema]: [string, any]) => {
            const desc = schema.description || schema.type || 'unknown';
            return `  - ${name}: ${desc}`;
          })
          .join('\n');
      }

      const dangerTag  = tool.isDangerous      ? ' ⚠️ DANGEROUS' : '';
      const approvalNote = tool.requiresApproval ? 'Yes' : 'No';

      return [
        `Tool: ${tool.name}${dangerTag}`,
        `Description: ${tool.description}`,
        'Arguments:',
        argsList,
        `Requires Approval: ${approvalNote}`,
      ].join('\n');
    }).join('\n\n---\n\n');
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
