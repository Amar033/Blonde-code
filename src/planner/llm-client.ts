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
    const model = process.env.LLM_MODEL || 'qwen3:latest';

    if (providerName === 'ollama') {
      const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const provider = new OllamaProvider(model, baseURL);

      const available = await provider.isAvailable();
      if (!available) {
        throw new Error('Ollama server not running. Start it with: ollama serve');
      }
      console.log(`[LLM] Initialized with Ollama: ${model}`);
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

    console.log(`[LLM] Initialized with ${provider.name}: ${model}`);
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

  async plan(input: string): Promise<PlannerResponse> {
    const prompt = `You are a coding agent. Create a high-level plan to accomplish this task. UserRequest: ${input}
Respond in JSON format:
{
  "type": "plan",
  "steps": ["step1", "step2", ...],
  "reasoning": "why this approach",
  "estimatedToolCalls": 5
}`;
    const response = await this.provider.call(prompt, {
      mode: 'plan',
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
1. If you just ran a tool and got a result, analyze it BEFORE calling another tool!
2. If the observation shows files, paths, or results - USE THAT INFORMATION in your answer
3. If you have the information the user asked for, return {"type": "answer"} - don't call more tools!
4. Don't call the same tool twice with the same arguments - that's looping!
5. Know when to stop - you don't need more tools if the task is complete!
${forceSynthesis ? '6. STOP NOW - You have enough information. Answer the user!' : ''}`;

    const response = await this.provider.call(prompt, {
      mode: 'act',
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

    const response = await this.provider.call(prompt, {
      mode: 'finalize',
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
    try {
      console.log('RAW LLM RESPONSE:');
      console.log(content);

      let { thinking, cleaned } = this.extractThinking(content);

      // Strip markdown code fences if the model wrapped the JSON
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(cleaned);

      if (!parsed.type) {
        throw new Error('Missing type field');
      }

      if (thinking && parsed.type === 'tool_call') {
        (parsed as any).thinking = thinking;
      }

      if (parsed.type === 'tool_call') {
        if (!parsed.tool || !parsed.args) {
          throw new Error('tool_call missing required fields (tool, args)');
        }
      }

      if (parsed.type === 'answer' || parsed.type === 'need_info') {
        if (!parsed.content && !parsed.question) {
          throw new Error(`${parsed.type} missing content/question`);
        }
      }

      return parsed as PlannerResponse;
    } catch (error) {
      console.error('[LLM] Failed to parse response:', content);
      console.error('[LLM] Error:', error);

      // Last-resort fallback — surface raw text rather than silently dying
      return { type: 'answer', content };
    }
  }
}
