import type {LLMProvider, LLMCallOptions, LLMResponse} from './providers/base.js';
import type {PlanenrResponse } from '../types/events.js';
import {OpenRouterProvider} from './providers/openrouter.js';
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
    const providerName = process.env.LLMProvider || 'openrouter';
    const apikey = process.env.OPENROUTER_API_KEY;
    const model = process.env.LLM_MODEL;

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
  async act (plan: string, observations : string[], availableTools: Tool[]): Promise<PlannerResponse> {
    const toolDescriptions = this.formatToolsForLLM(availableTools);
    const prompt = `You are a coding agent executing a plan. You have access to these tools: ${toolDescriptions} Plan: ${plan} 
        Previous observations: 
          ${observations.lenght>0? observations.map((o,i)=> `${i+1}. ${o}`).join('\n'):'None yet.'}
        Based on the plan and observations, decide what to do next.
        RESPONSE FORMAT (JSON ONLY):
        Option1 - Use a tool:
        {
          "type":"tool_call",
          "tool":"tool_name",
          "args":{"arg1","value1",...},
          "reasoning":"why this tool now"
        }
        
        Option2 - Task Comple, provide answer:
        {
          "type":"answer"
          "content": "final answer to the user"
        }

        Option3 - Need more info from user:
        {
          "type":"need_info",
          "question": "what do you need to know?"
        }
          Respond with JSON only, no markdown`;
    
    const response = await this.provider.call(prompt,{
      mode:'act',
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
    return tools.map(tool=>{
      const args = tool.argSchema.properties ?
        Object.entries(tool.argsSchema.properties).map(([name,schema]:[string,any])=> ` - ${name}: ${schema.description || schema.type}`).join('\n'): ' (no arguments)';
      const danger = tool.isDangerous ? 'DANGEROUS' : '';
      return `Tool: ${tool.name}${danger} 
              Description: ${tool.description}
              Arguments: ${args}`.trimn();
    }).join('\n\n---\n\n');
  }

  // parse llm response => PlanenrResponse (handles the off chance that the llm returns garbage)
  private parseResponse(content: string): PlannerResponse{
    try{
      // remove markdown code blocks if it exists
      const cleaned = content.replace(/```json\n?/g, '' ).replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      //validates it and match with PlanenrResponseSchema
      if (!parsed.type){
        throw new Error ('Missing type field');
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
