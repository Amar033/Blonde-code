// core event loop 

import type {AgentState, Plan} from '../types/agent.js'
import type {AgentEvent, PlannerResponse} from '../types/events.js'
import {isState, isTerminal} from '../types/agent.js'
import {LLMClient} from '../planner/llm-client.js'

// runtime configuration (global configuration for the runtime to prevebnt infinite loops and max iterations)
export interface RuntimeConfig{
  maxTurns: number;
  maxLoopCount: number;
  debug: boolean;
}

// agent runtime, the core event loop
// It maintains current state, processes events, transitions between state, emit events for ui and logging
// currently for now its going to be a simple  run like: waiting_for_input -> planning -> completed
// I wil implement the complete plan/act/observe loop in the near future

export class AgentRuntime {
  private state: AgentState;
  private config: RuntimeConfig;
  private eventListeners: ((event: AgentEvent)=> void)[] = [];
  private llmClient? : LLMClient;


  constructor(config: Partial<RuntimeConfig> = {}){
    this.state = { status: 'waiting_for_input'};
    this.config = {
      maxTurns: config.maxTurns ?? 10,  // if the config isnt set up globally it defaults to 10 
      maxLoopCount: config.maxLoopCount ?? 5,
      debug: config.debug ?? true,
    };
  }

  // get current state
  getState(): AgentState {
    return this.state;
  }

  // subscribe to events
  onEvent(listener: (event:AgentEvent) => void): void {
    this.eventListeners.push(listener);
  }

  // emit event to all listeners 
  private emit(event: AgentEvent): void {
    if (this.config.debug){
      console.log('[EVENT]',event.type,event)
    }
    this.eventListeners.forEach(listener => listener(event));
  }

  async initialize(): Promise<void> {
    this.llmClient = await LLMClient.fromEnv();
  }

  // mamin execution loop, an async generatror that yields events as they happen.  Currently simple flow and it can be updated to have PLAN/ACT/OBSERVE
  /** 
   * Previous pseudocode, kept as legacy
   * async *run(input:string): AsyncGenerator<AgentEvent> {
    // start with input from user
    const event: AgentEvent = {type: 'user_input', input};
    yield event;
    this.emit(event);

    //transition to planning
    this.state = {status: 'planning', thought: input , turn: 1 };

    // fake response
    const fakeAnswer = `I understand we have to "${input}". This is a placeholder`

    // simulate thinking time
    await this.sleep(1000)

    // transition to completed
    this.state = { status: 'completed', finalAnswer: fakeAnswer, turn: 1 };

    const completeEvent: AgnetEvent = {
      type: 'complete',
      finalResponse: fakeAnswer 
    };
    yield completeEvent;
    this.emit(completeEvent);
  }
*/
  async *run(input: string): AsyncGenerator<AgentEvent>{
    if (!this.llmClient){
      throw new Error('Runtime not initialized. Call initialized() first.');
    }

    // input from the user 
    const event: AgentEvent = {type: 'user_input', input};
    yield event;
    this.emit(event);

    // transition to planning 
    this.state = {status: 'planning', thought: input , turn 1};

    // LLMCall 
    console.log(`Calling llm in plan mode`);
    const planResponse = await this.llmClient.plan(input);

    const.log(`LLM Response`, planResponse);

    // for now just the plan, but in time i will add the functionality to use the plan to enable acting phase
    const finalAnswer = planResponse.type === 'plan'
      ? `Plan created: \n${planResponse.steps.join('\n')}\n\nReasoning: ${planResponse.reasoning}`
      : planResponse.type === 'answer'
      ? planResponse.content
      : 'Unable to create plan';

    this.state = {status: 'completed', finalAnswer, turn: 1};
    const completeEvent: AgentEvent ={
      type: 'complete',
      finalResponse: finalAnswer
    };
    yield completeEvent;
    this.emit(completeEvent);
  }
  


  // process single evnt and transition state
  // [where the state machine log lives]eg: state->event->newstate
  // simple transition only for now
  
  private transition(event: AgentEvent): AgentState {
    const current = this.state;

    // for now only simple flow
    if (isState(current, 'waiting_for_input') && event.type === 'user_input'){
      return {status: 'planning', thought: event.input, turn: 1 };
    }

    if (isState(current, 'planning') && event.type === 'llm_response'){
      // now its just complete, later we will generate plan and plan_ready
      return {
        status: 'completed',
        finalAnswer: event.parsed.type === 'answer' ? event.parsed.content : 'Done',
        turn: current.turn 
      };
    }

    // no valid transition case: stay in current state
    console.warn('[WARN] No valid transition for ', current.status, event.type);
    return current;
  }

  // check if we need to abort
  private shouldAbort(): boolean {
    const turn = 'turn' in this.state ? this.state.turn : 0 ;

    if (turn >= this.config.maxTurns){
      return true;
    }

    if (isState(this.state, 'acting') && this.state.loopCount >= this.config.maxLoopCount) {
      return true;
    }

    return false;
  }

  // helper function for sleep for ms
  private sleep(ms:number):  Promise<void> {
    return new Promise(resolve => setTimeout(resolve,ms));
  }

  // reset to initial state
  reset(): void {
    this.state = {status : 'waiting_for_input'};
  }
}


// async * makes run () a generator that can yield multiple events overtime. A regular async can return only once, but with this we can stream events as they happen, the caller can iterate with for await to receive inputs progressievely.
// yield sends data back to the caller generating a generator object, sends event to the caller and emit is used to trigger events 
// Transition? why? => immutability principle; running new task instead of mutating tasks
// eventListener is an array? why? => since multiple listeners may exist for a single function.



