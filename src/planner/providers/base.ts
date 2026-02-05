import type (PlannerResponse) from '../../types/event.js'


/**
 * Base inference that all the llm providers must implement 
 * I plan to make it modular as i can make it to add new providers in the fututre, 
 * currently the plan is to have the major providers and also some local model running via ollama or llama.cpp
 * Another plan is to make the project (blonde-code) to also act as an llm hosting service on its own which can run on the cpu simillar to llama.cpp, i havent planned on this portion so thats all i have in mind.
 */

export inference LLMProvider {
  // provider name (mainly for logging)
  name: string;
  
  // call llm with a prompt and gert structures response 
  call (prompt:string, options?:LLMCallOptions):Promise<LLMResponse>;
  
  // check if provider is available 
  isAvailable(); Promise<boolean>;
}

//options for llm LLMCalls
export interface LLMCallOptions{
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: 'plan'|'act'|'finalize'; //the 3 modes planned right now 
}

// Raw response from llm 
export interface LLMResponse{
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
}
