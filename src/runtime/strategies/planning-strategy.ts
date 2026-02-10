
export interface PlanningStrategy{
  plan(input: string, context: Context): Promise<Plan>;
}

// single call (Chain of thought)
export class ChainOfThoughtStrategy implements PlanningStrategy {
  async plan(input: string): Promise<Plan>{
    // one llm call, one plan
  }
}

// multiple calls (Tree of thought) - great idea that i found when researched, dont plan on implementing it right now, but just food for though
export class TreeOfThoughtStrategy implements PlanningStrategy {
  async plan(input: string): Promise<Plan>{
    // generate 3 plans, score and return the best
  }
}
