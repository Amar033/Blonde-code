import type {LLMProvider, LLMCallOptions, LLMResponse} from './providers/base.js';
import type {PlanenrResponse } from '../types/events.js';
import {OpenRouterProvider} from './providers/openrouter.js';
import {OllamaProvider} from './providers/ollama.js';
import {Tool} from '../tools/base.js';
/**
 * LLM Client 
 * This wraps all the providers and provides clean interface to the agent.
 */

export class LLMClient{
  private provider: LLMProvider;
  constructor(provider: LLMProvider){
    this.provider= provider;
  }

  // create client from environment
  static async fromEnv(): Promise<LLMClient> {
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
      console.log(`[LLM] Initialized with Ollama: ${model}`);
      return new LLMClient(provider);
    }

    if (!apikey){
      throw new Error('OPENROUTER_API_KEY not set in .env');
    }

    const provider = new OpenRouterProvider(apikey,model);
      
    //verification
    const available =  await provider.isAvailable();
    if (!available){
      throw new Error (`Provider ${providerName} is not available`);
    }

    console.log(`LLMClient initialized with ${provider.name}`);
    return new LLMClient(provider);
  }

    // plan mode
    async plan(input: string): Promise<PlannerResponse> {
    const prompt = `You are a coding agent. Create a high-level plan to accomplish this task . UserRequest: ${input} 
        Respond in JSON format:
        {
          "type": "plan",
          "steps": ["step1", "step2", ...],
          "reasoning": "why this approach",
          "estimatedToolCalls": 5
        }`;
    const response = await this.provider.call(prompt, {
      mode: 'plan',
      temperature: 0.7,
      maxTokens: 1500,
    });
    return this.parseResponse(response.content);
  }

  //act mode
  async act(plan: string, observations: string[], availableTools: Tool[], userInput?: string): Promise<PlannerResponse> {
    const toolDescriptions = this.formatToolsForLLM(availableTools);
  
    const prompt = `You are executing a plan to help the user. You have access to these tools:

${toolDescriptions}

USER REQUEST: ${userInput || 'Not provided'}

CURRENT PLAN:
${plan}

OBSERVATIONS FROM PREVIOUS ACTIONS:
${observations.length > 0  ? observations.map((o, i) => `${i + 1}. ${o}`).join('\n'): 'None yet - this is the first action.'}

YOUR JOB:
- Execute the plan step by step using the available tools
- After each tool result, analyze the result and determine what to do next
- If you have the answer to the user's request, respond with {"type": "answer", "content": "your answer"}
- If you need more info, respond with {"type": "need_info", "question": "what you need"}
- Otherwise, call another tool or continue with the plan

Respond with ONE of these formats:
{"type": "tool_call", "tool": "tool_name", "args": {...}, "reasoning": "why this tool"}
{"type": "answer", "content": "final answer to user"}
{"type": "need_info", "question": "what you need from user"}

IMPORTANT: 
- If you just ran a tool and got a result, DON'T run the same tool again - analyze the result!
- If you have the information the user asked for, return an ANSWER, don't call more tools!
- Use tools when needed, but know when to stop!`;

    const response = await this.provider.call(prompt, {
      mode: 'act',
      temperature: 0.5,
      maxTokens: 1000,
    });
  
    return this.parseResponse(response.content);
  }

  // finalize mode 
  async finalize(plan: string, observations: string[]): Promise<PlannerResponse> {
    const prompt = `You are a coding agent summarizing completed work. Plan : ${plan}
        Observations:
          ${observations.map((o,i)=> `${i+1}. ${o}`).join('\n')}
        Summarize what was accomplished.
        Respond in JSON:
        {
          "type":"answer",
          "content":"summary of what was done"
        }`;

  const response = await this.provider.call(prompt,{
      mode: 'finalize',
      temperature: 0.3,
      maxTokens: 800,
    });
    return this.parseResponse(response.content);
  }

  // format the tools for llm 
private formatToolsForLLM(tools: Tool[]): string {
  const formattedTools = tools.map(tool => {
    // Build arguments list
    let argsList = '';
    
    if (tool.argsSchema?.properties) {
      const entries = Object.entries(tool.argsSchema.properties);
      argsList = entries
        .map(([name, schema]: [string, any]) => {
          const desc = schema.description || schema.type || 'unknown';
          return `  - ${name}: ${desc}`;
        })
        .join('\n');
    } else {
      argsList = '  (no arguments)';
    }
    
    const dangerWarning = tool.isDangerous ? ' ⚠️ DANGEROUS' : '';
    const approvalNote = tool.requiresApproval ? 'Yes' : 'No';
    
    // Build the complete tool description
    const lines = [
      `Tool: ${tool.name}${dangerWarning}`,
      `Description: ${tool.description}`,
      'Arguments:',
      argsList,
      `Requires Approval: ${approvalNote}`
    ];
    
    return lines.join('\n');
  });
  
  return formattedTools.join('\n\n---\n\n');
} 
  private extractThinking(content: string) {
    let thinking: string | undefined;
    let cleaned = content;

    // Ollama format
    const start = content.indexOf("Thinking...");
    const end = content.indexOf("...done thinking.");

    if (start !== -1 && end !== -1 && end > start) {
      thinking = content
        .slice(start + "Thinking...".length, end)
        .trim();

      cleaned =
        content.slice(0, start) +
        content.slice(end + "...done thinking.".length);
    }

    // Qwen <think> format fallback
    const thinkMatch = cleaned.match(/<think>([\s\S]*?)<\/think>/);

    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "");
    }

    return { thinking, cleaned: cleaned.trim() };
  }


  // parse llm response => PlanenrResponse (handles the off chance that the llm returns garbage)
  private parseResponse(content: string): PlannerResponse{
    try{
      console.log("RAW LLM RESPONSE:");
      console.log(content);
      // extract thinking from qwen 
      let { thinking, cleaned } = this.extractThinking(content);

      // remove markdown code blocks if it exists
      cleaned = content.replace(/```json\n?/g, '' ).replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      //validates it and match with PlanenrResponseSchema
      if (!parsed.type){
        throw new Error ('Missing type field');
      }

      // attach thinking if exist 
      if (thinking && parsed.type === 'tool_call'){
        (parsed as any).thinking = thinking;
      }

      if (parsed.type ==='tool_call'){
        if(!parsed.tool || !parsed.args){
          throw new Error('tool_call missing required fields (tool,args');
        }
      }

      if (parsed.type ==='answer' || parsed.type === 'need_info'){
        if(!parsed.content && !parsed.question){
          throw new Error(`${parsed.type} missing content/question`); 
        }  
      }

      return parsed as PlannerResponse;        
    } catch (error){
      console.error ('[LLM] Failed to parse response:', content);
      console.error ('[LLM] Error:', error);

      //  fallback 
      return { 
        type: 'answer',
        content: content, 
      };
    }
  }
}
