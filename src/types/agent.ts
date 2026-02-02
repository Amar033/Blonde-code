// shows all possible states the agent could be in 

export type AgentState=
  | { status: 'waiting_for_input'}
  | { status: 'planning'; thought: string}
  | { status: 'detail_planning'; miniPlan: string}
  | { status: 'validating_plan'; plan: string}
  | { status: 'awaiting_approval'; toolCall: ToolCall}
  | { status: 'executing_tool'; toolName: string; args: unknown}
  | { status: 'summarizing'; results: string}
  | { status: 'completed'; finalAnswer:   string}
  | { status: 'aborted'; reason: string};


//tool call - Represents the request to   execute a tool

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
}


// type guard for agent states

export function isState<T extends AgentState['status']>(
  state: AgentState,
  status: T 
): state is Extract<AgentState, { status: T}> {
  return state.status === status;
}


// Some info about things i learned here, if i am checking this code again in ts a single variable can have different types, even if it is typed, it can be done using the union type created by | 
// the status field is used to denote the status the agent run time is in right now.
// (unkown vs any) - any disables all typechecking but unknown requires type checking before operations can be performed.
// In the current file, isState function checks the agent state thats right now and assigns the status to the agent, it is to narrow the typescript type based on current status, enabling safe access to proper status fields. [only specific states have specific abilities/fields]
