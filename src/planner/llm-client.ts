import type {LLMProvider, LLMCallOptions, LLMResponse} from './providers/base.js';
import type {PlanenrResponse } from '../types/events.js';
import {OpeenRouterProvider} from './providers/openrouter.js';

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

    const provider = new OpeenRouterProvider(apikey,model);

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
    const prompt = `UserRequest: ${input}  Create a plan to accomplish this.`;
    const response = await this.provider.call(prompt, {
      mode: 'plan',
      temperature: 0.7,
      maxTokens: 1500,
    });
    return this.parseResponse(response.content);
  }

  //act mode
  async act (plan: string, observations : string[]): Promise<PlannerResponse> {
    const prompt = `Plan: ${plan} 
        Previous observations: 
          ${observations.map((o,i)=> `${i+1}. ${o}`).join('\n')}
        What should we do next?`;
    
    const response = await this.provider.call(prompt,{
      mode:'act',
      temperature: 0.5,
      maxTokens: 1000,
    });

    return this.parseResponse(response.content);
  }

  // finalize mode 
  async finalize(plan: string, observations: string[]): Promise<PlannerResponse> {
    const prompt = `Plan : ${plan}
        Observations:
          ${observations.map((o,i)=> `${i+1}. ${o}`.join('\n')}
        Summarize what was accomplished.`;

  const response = await this.provider.call(prompt,{
      mode: 'finalize',
      temperature: 0.3,
      maxTokens: 800,
    });
    return this.parseResponse(response.content);
  }

  // parse llm response => PlanenrResponse (handles the off chance that the llm returns garbage)
  private parseResponse(content: string): PlannerResponse{
    try{
      // remove markdown code blocks if it exists
      const cleaned = content.replace(/```json\n?/g, '' ).replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      //validates it and match with PlanenrResponseSchema
      if (!parse.type){
        throw new Error {'Missing type field'}
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
