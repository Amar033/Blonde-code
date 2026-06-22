
/**
 * Base inference that all the llm providers must implement 
 * I plan to make it modular as i can make it to add new providers in the fututre, 
 * currently the plan is to have the major providers and also some local model running via ollama or llama.cpp
 * Another plan is to make the project (blonde-code) to also act as an llm hosting service on its own which can run on the cpu simillar to llama.cpp, i havent planned on this portion so thats all i have in mind.
 */

export interface LLMProvider {
  name: string;
  call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;
  stream?(prompt: string, options?: LLMCallOptions): AsyncGenerator<LLMStreamDelta, void, unknown>;
  isAvailable(): Promise<boolean>;
  // Returns the model's context window token limit (used for usage warnings)
  getContextWindow(): Promise<number>;
}

//options for llm LLMCalls
export interface LLMCallOptions{
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: 'plan'|'act'|'finalize';
  timeout?: number; // ms — overrides provider default
  signal?: AbortSignal; // caller-side abort (e.g. Ctrl+C)
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

// Streaming delta from LLM
export interface LLMStreamDelta {
  type: 'content' | 'thinking' | 'done';
  content: string;
}
