import type { Plan } from '../../types/agent.js';

export interface PlanningStrategy {
  plan(input: string): Promise<Plan>;
}

// Single LLM call — the approach currently wired into AgentRuntime via LLMClient.plan()
export class ChainOfThoughtStrategy implements PlanningStrategy {
  async plan(_input: string): Promise<Plan> {
    throw new Error('ChainOfThoughtStrategy.plan() is a stub — planning goes through LLMClient directly');
  }
}

// Generate N plans, score them, return best — not yet implemented
export class TreeOfThoughtStrategy implements PlanningStrategy {
  async plan(_input: string): Promise<Plan> {
    throw new Error('TreeOfThoughtStrategy.plan() not yet implemented');
  }
}
