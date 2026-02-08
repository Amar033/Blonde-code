import type {LLMProvider, LLMCallOptions, LLMResponse} from '../base.js';

/**
 * Uses open ai sdk (was the initial plan) with openrouter api has free model calls till 100 times a day 
*/

// change of plans since the open ai sdk seems to fail hence planning with raw http (better option), turns out the error was with the apidefiniton i did on the .env :_)


export class OpenRouterProvider implements LLMProvider{
  name = 'openrouter';
  private apiKey: string;
  private baseURL = 'https://openrouter.ai/api/v1';
  private model: string;

  constructor(apiKey: string, model?: string){ // stupid me had the naming set to apikey, but i use apiKey everywhere else :_)
    this.apiKey = apiKey;
    this.model = model || 'arcee-ai/trinity-large-preview:free';
  }

  async isAvailable(): Promise<boolean>{
    try{
      const response = await fetch(`${this.baseURL}/models`,{
        headers:{
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch (error){
      console.error('[OPENROUTER] Not Available:', error);
      return false;
    }
  }

  async call(prompt:string, options?: LLMCallOptions): Promise<LLMResponse>{
    const systemPrompt = options?.systemPrompt || this.getSystemPrompt(options?.mode);
    try{
      const response = await fetch(`${this.baseURL}/chat/completions`,{
        method: `POST`,
        headers: {
          'Authorization' : `Bearer ${this.apiKey}`,
          'Content-type': 'application/json',
          'HTTP-Referer': 'https://github.com/Amar033/blonde-code',
          'X-Title': 'Blonde-Code' ,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: prompt}
          ],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2000,
        }),
      });
      if (!response.ok){
        const errorText = await response.text();
        throw new Error(`OpenRouter Api error (${response.status}): ${errorText}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      return {
        content,
        usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        }: undefined,
        model: data.model,
      };
    } catch (error){
      console.error('[OPENROUTER] Error',error);
      throw new Error(`Openrouter call failed: ${error}`);
    }
  }


  // get systemPrompt based on the mode 
  private getSystemPrompt(mode?: string): string {
    switch(mode){
      case 'plan':
        return `You are a strategic planning assistant for a coding agent.
          your job is to  analyze the users request and create a high-level plan.
            Respond with JSON object in this EXACT format:
            {
              "type": "plan",
              "steps": ["step 1", "step 2", "step 3"],
              "reasoning": "why these steps make sense",
              "estimatedToolCalls": 3
            }
        Be consise and specific. Focus on WHAT needs to be done, not HOW.`;
       case 'act':
        return `You are an action-taking assistant for a coding agent.
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
            }`;

        case 'finalize':
          return `You are a completion assistant for coding agent. Review the plan and all observations, then provide a final summary.
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
