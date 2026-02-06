import OpenAI from 'openai';
import type {LLMProvider, LLMCallOptions, LLMResponse} from './base.js';

/**
 * Uses open ai sdk  with openrouter api has free model calls till 100 times a day 
 */

export class OpenRouterProvider implements LLMProvider{
  name: 'openrouter';
  private client: OpenAI;
  private model: string;

  constructor(apikey: string, model?: string){
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apikey: apikey,
      defaultHeaders: {
        'HTTP-Referer': 'http://github.com/Amar033/blonde-code',
        'x-Title': 'Blonde-code',
      },
    });

    // let default model for openrouter provider be trinity large
    this.model = model || 'arcee-ai/trinity-large-preview:free';
  }

  async isAvailable(): Promise<boolean>{
    try{
      await this.client.models.list();
      return true;
    }
    catch (error){
      console.error('[OPENROUTER] Not Available:',error);
      return false;
    }
  }

  async call(prompt:string, options?: LLMCallOptions): Promise<LLMResponse>{
    const systemPrompt = options?.systemPrompt || this.getSystemPrompt(options?.mode);
    try{
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages:[
          {role:'system', content: systemPrompt},
          {role:'user', content: prompt},
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 2000,
      });

      const content = response.choices[0]?message?.content || '';

      return {
        content,
        usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        }: undefined,
        model: response.model,
      };
    }catch (error){
      console.errror('[OPENROUTER] Error',error);
      throw new Error(`Openrouter call failed: ${errror}`);
    }
  }


  // get systemPrompt based on the mode 
  private getSystemPrompt(mode?: string) string {
    switch(mode){
      case 'plan':
        return 'You are a strategic planning assistant for a coding agent.
          your job is to  analyze the users request and create a high-level plan.
            Respond with JSON object in this EXACT format:
            {
              "type": "plan",
              "steps": ["step 1", "step 2", "step 3"],
              "reasoning": "why these steps make sense",
              "estimatedToolCalls": 3
            }
        Be consise and specific. Focus on WHAT needs to be done, not HOW.';
       case 'act':
        return 'You are an action-taking assistant for a coding agent.
          You have a plan and observations from previous tool executions. Your jon is to decide the NEXT action.
          Respond with a JSON object in ONE of these formats:
            Tool Call:
              {
              "type": "tool_call",
              "tool": "tool_name",
              "args": {"arg1", "value1"},
              "requiresApproval": true, 
              "reasoning": "why this tool call"
            }
            
            Final answer: 
              {
              "type": "answer",
              "content": "the final response to the user"
            }
            
            Need more info:
              {
              "type": "need_info",
              "question": "what information do you need?"
            }';

        case 'finalize':
          return 'You are a completion assistant for coding agent. Review the plan and all observations, then provide a final summary.
            Respond with a JSON object:
            {
              "type": "answer"
              "content": "clear summary of what was accomplished"
            }`;
            
        default: 
          return 'You are a helpful coding assistant';
      
    }
  }
}
