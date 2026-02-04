// the pseudocose i  planned has include the modes for the llm such as plan and act modes for the llm which will make the model plan first and resposnd with a plan that the user can use anf the second is to make use of act mode where the agent runtime can do any tool operations that change the codebase
// in here we plan for all the states for a full plan/act/observe agent


// plan mode - highlevel planning by the llm 
export interface Plan {
  steps: string[]; //all the steps required as an array
  reasoning: string; // why this plan?
  currentStep: number;  //The current step we are on 
  estimatedToolCalls: number; // number of tools we expect to call 
}


// observation result from executing a tool 
export interface Observation {
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  summary: string;
  timestamp: Date;
  success: boolean;
}

// tool call - Request for a tool call (from the llm)
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
  reasoning?: string;
}

/**
  * Agent State - All possible states the agent runtime could be in 
  *
  * Flow
  * waiting_for_input
    * -> planning (generate plan)
    * -> plan_ready 
    * -> executing plan with tools after approval 
      * [validating_tool -> awaiting_approval -> executing_tool -> observing -> acting]
    * -> completed
  */

export type AgentState=
  // initial state
  | { status: 'waiting_for_input'}
  
  // planning phase 
  | { status: 'planning'; thought: string}
  | { status: 'plan_ready'; plan: Plan; turn: number}
  
  // acting phase
  | { status: 'acting'; plan: Plan; observations: Observation[]; turn: number; loopCount: number;}

  // tool validation and execution
  | { status: 'validating_tool'; toolCall: ToolCall; plan: Plan; observations: Observation[]; turn: number;}
  | { status: 'awaiting_approval'; toolCall: ToolCall; plan: Plan; observations: Observation[]; turn: number;}
  | { status: 'executing_tool'; toolCall: ToolCall; plan : Plan; observations: Observation[]; turn: number;} 
  
  // observation and learning
  | { status: 'observing'; result: unknown; toolCall: ToolCall; plan : Plan; observations: Observation[]; turn: number;}
  
  // final/ terminal states
  | { status: 'completed'; finalAnswer: string; turn: number}
  | { status: 'aborted'; reason: string; turn: number};

//  Legacy code from previous iteration,Here for reference int he future
//  | { status: 'detail_planning'; miniPlan: string}
//  | { status: 'validating_plan'; plan: string}
//  | { status: 'awaiting_approval'; toolCall: ToolCall}
//  | { status: 'executing_tool'; toolName: string; args: unknown}
//  | { status: 'summarizing'; results: string}
//  | { status: 'completed'; finalAnswer:   string}
//  | { status: 'aborted'; reason: string};
//


// type guard for agent states
export function isState<T extends AgentState['status']>(
  state: AgentState,
  status: T 
): state is Extract<AgentState, { status: T}> {
  return state.status === status;
}

// check if state is ternminal (finished or aborted)
export function isTerminal(state: AgentState): boolean {
  return state.status == 'completed' || state.status == 'aborted';
}

// get the current turn number from any state
export function getTurn(state: AgentState): number {
  if ('turn' in state) {
    return state.turn;
  }
  return 0;
}


// updated architecture info and rteference 
// states now carry plan and observation as most of the time it the event will go back to the llm so that the llm could respond, so that the llm doesnt lose the context and is aware of the task at hand
// loop count in acting is to prevent infinite loops 
// turn exists in every state so as to keep track if we are doing the same thing again and again without any luck
// planning is a one time thing, or a task the agent does in the very first time, but acting is a loop of actions that the agent does repeatedly 
// Plan, observation and tool call  are seperate interfaces as these are different components that will be called at different states but having the same consitution.


// Some info about things i learned here, if i am checking this code again in ts a single variable can have different types, even if it is typed, it can be done using the union type created by | 
// the status field is used to denote the status the agent run time is in right now.
// (unkown vs any) - any disables all typechecking but unknown requires type checking before operations can be performed.
// In the current file, isState function checks the agent state thats right now and assigns the status to the agent, it is to narrow the typescript type based on current status, enabling safe access to proper status fields. [only specific states have specific abilities/fields]
