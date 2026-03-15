// core event loop 

import type {AgentState, Plan} from '../types/agent.js'
import type {AgentEvent, PlannerResponse} from '../types/events.js'
import {isState, isTerminal} from '../types/agent.js'
import {LLMClient} from '../planner/llm-client.js'
import {PlanningStrategy} from '../runtime/strategies/planning-strategy.js'
import {ToolRegistry} from '../tools/registry.js'
import type {Tool} from '../tools/base.js'
// runtime configuration (global configuration for the runtime to prevebnt infinite loops and max iterations)
export interface RuntimeConfig{
  maxTurns: number;
  maxLoopCount: number;
  maxConsecutiveErrors: number;
  debug: boolean;
}

export interface ExecutionSafety{
  validateToolCall(call: ToolCall): ValidationResult;
  requiresApproval(call: ToolCall): boolean;
  canAbort(): boolean;
  recordAction(action:Action): void; // for audit
}

// agent runtime, the core event loop
// It maintains current state, processes events, transitions between state, emit events for ui and logging
// currently for now its going to be a simple  run like: waiting_for_input -> planning -> completed
// I wil implement the complete plan/act/observe loop in the near future

export class AgentRuntime {
  private state: AgentState;
  private config: RuntimeConfig;
  private planningStrategy: PlanningStrategy;
  private eventListeners: ((event: AgentEvent)=> void)[] = [];
  private llmClient? : LLMClient;
  private toolRegistry: ToolRegistry;


  constructor(toolRegistry: ToolRegistry, config: Partial<RuntimeConfig> = {}){
    this.state = { status: 'waiting_for_input'};
    this.toolRegistry = toolRegistry;
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
    console.log('[Runtime] initialized with ', this.toolRegistry.getAllTools().length, 'Tools');
  }

  // mamin execution loop, an async generatror that yields events as they happen.  Currently simple flow and it can be updated to have PLAN/ACT/OBSERVE
  /** 
   * Previous pseudocode, kept as legacy
   * async *run(input:string): AsyncGenerator<AgentEvent> {
    // start   // const planResponse = await this.llmClient.plan(input);

   // console.log(`LLM Response`, planResponse);

   // // for now just the plan, but in time i will add the functionality to use the plan to enable acting phase
   // const finalAnswer = planResponse.type === 'plan'
   //   ? `Plan created: \n${planResponse.steps.join('\n')}\n\nReasoning: ${planResponse.reasoning}`
   //   : planResponse.type === 'answer'
   //   ? planResponse.content
   //   : 'Unable to create plan';

   // this.state = {status: 'completed', finalAnswer, turn: 1};
   // const completeEvent: AgentEvent ={
   //   type: 'complete',
   //   finalResponse: finalAnswer
   // };
  with input from user
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
    yield* this.planningPhase(input);

    // check if planning is complete/suceeded
    if (this.state.status !== 'plan_ready'){
      console.log('[Runtime] Planning failed, aborting');
      return 
    }

    // yield acting phase
    yield* this.actingPhase(input);

    // emit final Result
    if (this.state.status == 'completed'){
      const completeEvent: AgnetEvent = {
        type: 'complete',
        finalResponse: this.state.finalAnswer
      };
      yield completeEvent;
      this.emit(completeEvent);
    } else if (this.state.status=== 'aborted'){
      const abortEvent: AgnetEvent={
        type: 'abort',
        reason: this.state.reason
      };
      yield abortEvent;
      this.emit(abortEvent);
    }
   // this.state = {status: 'planning', thought: input , turn:  1};

   // // LLMCall 
   // console.log(`Calling llm in plan mode`);
   // const planResponse = await this.llmClient.plan(input);

   // console.log(`LLM Response`, planResponse);

   // // for now just the plan, but in time i will add the functionality to use the plan to enable acting phase
   // const finalAnswer = planResponse.type === 'plan'
   //   ? `Plan created: \n${planResponse.steps.join('\n')}\n\nReasoning: ${planResponse.reasoning}`
   //   : planResponse.type === 'answer'
   //   ? planResponse.content
   //   : 'Unable to create plan';

   // this.state = {status: 'completed', finalAnswer, turn: 1};
   // const completeEvent: AgentEvent ={
   //   type: 'complete',
   //   finalResponse: finalAnswer
   // };
   // yield completeEvent;
   // this.emit(completeEvent);
 
  }
  
  // planning phase function 
  private async * planningPhase(input:string): AsyncGenerator<AgentEvent>{
    this.state = {status: 'planning', thought: input};
    try{
      console.log('[Runtime] Calling llm in planm mode');
      const planResponse = await this.llmClient!.plan(input);
      const llmEvent: AgentEvent= {
        type: 'llm_response',
        content: JSON.stringify(planResponse),
        parsed: planResponse,
        thinking: (planResponse as any).thinking,
      };
      yield llmEvent;
      this.emit(llmEvent);

      if (planResponse.type === 'plan'){
        const plan: Plan= {
          steps: planResponse.steps,
          reasoning: planResponse.reasoning,
          currentStep: 0,
          estimatedToolCalls: planResponse.estimatedToolCalls || 5,
        };
        this.state = {
          status: 'plan_ready',
          plan,
          turn:1
        }
        const planEvent: AgentEvent={
          type : 'plan_generated',
          plan
        };
        yield planEvent;
        this.emit(planEvent);
      }else if (planResponse.type === 'answer'){
        // direct answer
        this.state={
          status: 'completed',
          finalAnswer: planResponse.content,
          turn: 1
        };
      }else {
        // failed
        this.state={
          status: 'aborted',
          reason: 'LLM failed to generate plan',
          turn: 1
        };
      }

   // // for now just the plan, but in time i will add the functionality to use the plan to enable acting phase
   // const finalAnswer = planResponse.type === 'plan'
   //   ? `Plan created: \n${planResponse.steps.join('\n')}\n\nReasoning: ${planResponse.reasoning}`
   //   : planResponse.type === 'answer'
   //   ? planResponse.content
   //   : 'Unable to create plan';

   // this.state = {status: 'completed', finalAnswer, turn: 1};
   // const completeEvent: AgentEvent ={
   //   type: 'complete',
   //   finalResponse: finalAnswer
   // };
  
    } catch (error){
      console.error('[Runtime] Planning Failed', error);
      this.state={
        status: 'aborted',
        reason: `Planning Error: ${error}`,
        turn: 1
      };
    }
  }

  // Acting Phase
  private async *actingPhase(userInput: string): AsyncGenerator<AgentEvent>{
    if(this.state.status != 'plan_ready') return;
    const plan = this.state.plan;
    let observations: Observation[] = [];
    let loopCount=0;
    let turn = this.state.turn;

    console.log('[Runtime] Starting acting phase...');

    // acting loop 
    while (true){
      if (loopCount >= this.config.maxLoopCount){
        this.state={
          status: 'aborted',
          reason: `Max loop count (${this.config.maxLoopCount}) exceeded`,
          turn 
        };
        console.log('[Runtime] Aborted: max loop count');
        break;
      }

      if (turn >= this.config.maxTurns){
        this.state={
          status: 'aborted',
          reason: `${this.config.maxConsecutiveErrors} Consecutive Errors`,
          turn
        };
        console.log('[Runtime] Aborted too many errors');
        break;
      }

      this.state={
        status: 'acting',
        plan,
        observations,
        turn,
        loopCount
      };

      const availableTools = this.toolRegistry.getAllTools();

      console.log(`[Runtime] Act mode (loop ${loopCount}, turn ${turn})...`);
      const observationSummaries= observations.map(o=>o.summary);

      try{
        const response = await this.llmClient!.act(
          plan.reasoning,
          observationSummaries,
          availableTools,
          userInput
        );
        const llmEvent: AgentEvent={
          type: 'llm_response',
          content: JSON.stringify(response),
          parsed: response 
        };
        yield llmEvent;
        this.emit(llmEvent);

        if(response.type === 'answer'){
          console.log('[Runtime] LLM returned final answer');
          this.state= {
            status: 'completed',
            finalAnswer: response.content,
            turn
          };
          break;
        } else if (response.type === 'need_info'){
          //  Need user input (futre: pause ans wait)
          console.log('[Runtime] LLM needs more info:', response.question);
          this.state={
            status: 'aborted',
            reason: `Need more info: ${response.question}`,
            turn
          };
          break;
        } else if (response.type === 'tool_call'){
          const toolCall: ToolCall={
            name: response.tool,
            args: response.args,
            requiresApproval: response.requiresApproval || false,
            reasoning: response.reasoning,
          };

          console.log(`[Runtime] Tool Call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

          // validation and execution
          const observation = await this.executeToolCall(toolCall, plan, observations, turn);

          if (observations){
            observations.push(observation);

            const obsEvent: AgentEvent={
              type: 'observation_ready',
              observation
            };
            yield obsEvent;
            this.emit(obsEvent);
          }

          loopCount++;
          turn++;
        }else{
          // unknown type
          console.error('[Runtime] unknown LLM response type: ', response);
          this.state={
            status: 'aborted',
            reason: 'Invalid LLM response',
            turn
          };
          break;
        }
      }catch (error){
        console.error('[Runtime] Act mode error:, error');
        this.state={
          status: 'aborted',
          reason: `Act mode Failed: ${error}`,
          turn 
        };
        break;
      }
    }
  }

  // execute tool with validation 
  private async executeToolCall(
    toolCall: ToolCall,
    plan: Plan,
    observations: Observation[],
    turn: number
  ): Promise<Observation | null>{

    // transition to validation state
    this.state={
      status: 'validating_tool',
      toolCall,
      plan,
      observations,
      turn
    };

    // check tool exists
    const tool = this.toolRegistry.get(toolCall.name);

    if (!tool){
      console.error(`[Runtime] Tool ${toolCall.name} not found`);

      const availableTools= this.toolRegistry.getAllTools().map(t=>t.name);
      return this.createErrorObservation(
        toolCall.name,
        toolCall.args,
        `Tool ${toolCall.name} does not exist. Available: ${availableTools.join(',')}`
      );
    }

    // validating args
    const validation = tool.validate(toolCall.args);
    if(!validation.valid){
      console.error(`[Runtime] Tool ${toolCall.name}:`, validation.errors );
      return this.createErrorObservation(
        toolCall.name,
        toolCall.args,
        `Invalid args: ${validation.errors.join(' ,')}`
      );
    }

    // approval check 
    if (toolCall.requiresApproval || tool.isDangerous){
      console.warn(`[Runtime] Tool ${toolCall.name} requires approval(autoapproving for now)`);
      // need to implement approval flow
    }

    // execution 
    this.state={
      status: 'executing_tool',
      toolCall,
      plan,
      observations,
      turn 
    };

    try {
      console.log(`[Runtime] Executing: ${toolCall.name}`);
      const result = await tool.execute(toolCall.args);

      // create observation
      this.state={
        status: 'observing',
        result: result.output, 
        toolCall,
        plan,
        observations, 
        turn,
      };

      return this.createObservation(toolCall.name, toolCall.args, result);
    }catch(error){
      console.error(`[Runtime] Tool Execution failed:`, error);
      return this.createErrorObservation(
        toolCall.name, 
        toolCall.args,
        `Execution failed: ${error}`
      );
    }
  }

  
  // create observation 
  private createObservation(
    toolName: string,
    input:Record<string, unknown>,
    result: any
  ): Observation{
    let summary: string;
    
    switch(toolName){
      case 'read_file':
        if (result.success && result.output) {
          const output = result.output;
          const lines = typeof output.content === 'string' ? output.content.split('\n').length : 0;
          summary = `Read ${input.path}: ${lines} lines${result.metadata?.truncated ? ' (truncated)' : ''}`;
        } else {
          summary = `Failed to read ${input.path}: ${result.error}`;
        }
        break;

      case 'list_files':
        if (result.success && result.metadata) {
          const { fileCount, dirCount, files, directories } = result.metadata;
          summary = `Listed ${input.path}: Found ${fileCount} files, ${dirCount} directories. Files: ${(files || []).slice(0, 10).join(', ')}${(files?.length || 0) > 10 ? '...' : ''}`;
        } else {
          summary = `Failed to list ${input.path}: ${result.error}`;
        }
        break;

      case 'write_file':
        if (result.success && result.output) {
          summary = `Wrote ${result.output.bytesWritten} bytes to ${input.path} (${result.output.linesWritten} lines)`;
        } else {
          summary = `Failed to write ${input.path}: ${result.error}`;
        }
        break;

      case 'edit_file':
        if (result.success && result.output) {
          summary = `Edited ${input.path}: replaced ${result.output.charsReplaced} chars, net change: ${result.output.netChange > 0 ? '+' : ''}${result.output.netChange} chars`;
        } else {
          summary = `Failed to edit ${input.path}: ${result.error}`;
        }
        break;

      case 'bash':
        if (result.success && result.output) {
          const { stdout, stderr, exitCode } = result.output;
          const outputPreview = stdout ? stdout.slice(0, 500) : '';
          summary = `Executed bash: exit code ${exitCode}. Output: ${outputPreview}${stdout?.length > 500 ? '...(truncated)' : ''}`;
        } else {
          summary = `Bash failed: ${result.error}`;
        }
        break;

      case 'grep':
        if (result.success && result.output) {
          const { matches, results, filesMatched } = result.output;
          summary = `Search found ${matches} matches in ${filesMatched} files. First results: ${(results || []).slice(0, 3).map((r: any) => `${r.file}:${r.line}`).join(', ')}`;
        } else {
          summary = `Search failed: ${result.error}`;
        }
        break;

      case 'glob':
        if (result.success && result.output) {
          const { matches, files } = result.output;
          summary = `Found ${matches} files matching pattern. Files: ${(files || []).slice(0, 10).join(', ')}${(files?.length || 0) > 10 ? '...' : ''}`;
        } else {
          summary = `Glob failed: ${result.error}`;
        }
        break;

      case 'web_fetch':
        if (result.success && result.output) {
          const { statusCode, contentLength, content } = result.output;
          summary = `Fetched ${input.url}: HTTP ${statusCode}, ${contentLength} chars. Content preview: ${(content || '').slice(0, 200)}...`;
        } else {
          summary = `Web fetch failed: ${result.error}`;
        }
        break;

      case 'web_search':
        if (result.success && result.output) {
          const { resultsCount, results } = result.output;
          summary = `Web search found ${resultsCount} results. Top: ${(results || []).slice(0, 3).map((r: any) => r.title).join(' | ')}`;
        } else {
          summary = `Web search failed: ${result.error}`;
        }
        break;

      default:
        // For any new tools, provide helpful info
        if (result.success) {
          summary = `Executed ${toolName} successfully`;
          // Try to add useful info if available
          if (result.output) {
            const outputStr = typeof result.output === 'string' 
              ? result.output.slice(0, 200) 
              : JSON.stringify(result.output).slice(0, 200);
            summary += `. Result: ${outputStr}`;
          }
        } else {
          summary = `${toolName} failed: ${result.error || 'Unknown error'}`;
        }
    }

    return {
      toolName,
      input,
      result: result.output,
      summary,
      timestamp: new Date(),
      success: result.success,
    };
  }

  // Create error observations
  private createErrorObservation(
    toolName: string,
    input: Record<string,unknown>,
    error: string
  ): Observation {
    return {
      toolName,
      input,
      result: null,
      summary: `Error: ${error}`,
      timestamp: new Date(),
      success: false,
    };
  }

  // check if consecutive errors came in 
   private hasConsecutiveErrors(observations: Observation[], n: number): boolean{
    if(observation.length<n)return false;
    const lastN = observations.slice(-n);
    return lastN.every(o=>!o.success);
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

// some code is dead code now likw the transition function, this was not my plan, but i showed the code that i have till now and claude suggested these changes, i will implement the other code but lets go with these for now

// async * makes run () a generator that can yield multiple events overtime. A regular async can return only once, but with this we can stream events as they happen, the caller can iterate with for await to receive inputs progressievely.
// yield sends data back to the caller generating a generator object, sends event to the caller and emit is used to trigger events 
// Transition? why? => immutability principle; running new task instead of mutating tasks
// eventListener is an array? why? => since multiple listeners may exist for a single function.



