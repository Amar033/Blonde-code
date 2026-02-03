// Events represent things that happen to the agent 
// Events cause state transitions

export type AgentEvent = 
  | {type: 'user_input'; input: string}
  | {type: 'llm_response'; content: string; parsed: PlannerResponse}
  | {type: 'tool_result'; toolName: string; result: unknown}
  | {type: 'tool_error'; toolName: string; error: string}
  | {type: 'user_approval'; approved: boolean}
  | {type: 'abort'; reason: string}
  | {type: 'complete'; finalResponse: string};

// PlannerResponse is what the llm can respond to the agent runtime, in this we define what all the llm would respond to the runtime.

export type PlannerResponse = 
  | {type: 'plan'; steps: string[]; reasoning: string }
  | {type: 'tool_call'; tool: string; args: Record<string, unknown>; requiresApproval: boolean}
  | {type: 'answer'; content: string}
  | {type: 'need_info'; question: string};

// type guard for events 

export function isEvent<T extends AgentEvent['type']>(
  event: AgentEvent,
  type: T
):  event is Extract<AgentEvent, { type: T}> {
  return event.type === type;
}

// more ref info: 
// AgentState vs AgentEvent: AgentState are the states in which the agent runtime will be in, and agent event are seperate events in the runtime which will have different actions within them.
// llm_Resopnse includes conent which is raw llm response for logging but for the agent we use the PlannerResponse which is parsed and clean.
// PlannerResponse is a seperate event to make it so that the llm would hallucinate less and give a formatted response that follows the type that we have assigned it to.
// Another thing to check for is what would happen if the llm response doesnt match? This cannot be fixed by type checks as they are only for compile time  for runtime type validation we need zod (ts first schema validation)

