// core event loop 

import type {AgentState, Plan} from '../types/agent.js'
import type {AgentEvent, PlannerResponse} from '../types/events.js'
import {isState, isTerminal} from '../types/agent.js'
import {LLMClient} from '../planner/llm-client.js'
import {PlanningStrategy} from '../runtime/strategies/planning-strategy.js'
import {ChainOfThoughtStrategy} from '../runtime/strategies/planning-strategy.js'
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

export type ApprovalCallback = (toolName: string, args: Record<string, unknown>, reasoning?: string) => Promise<boolean>;

// Tool call tracking for loop detection
interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  timestamp: Date;
}

export class AgentRuntime {
  private state: AgentState;
  private config: RuntimeConfig;
  private planningStrategy: PlanningStrategy;
  private eventListeners: ((event: AgentEvent)=> void)[] = [];
  private llmClient? : LLMClient;
  private toolRegistry: ToolRegistry;
  private abortController: AbortController | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private toolCallHistory: ToolCallRecord[] = [];


  constructor(toolRegistry: ToolRegistry, config: Partial<RuntimeConfig> = {}){
    this.state = { status: 'waiting_for_input'};
    this.toolRegistry = toolRegistry;
    this.config = {
      maxTurns: config.maxTurns ?? 10,  // if the config isnt set up globally it defaults to 10 
      maxLoopCount: config.maxLoopCount ?? 5,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      debug: config.debug ?? true,
    };
    this.planningStrategy = new ChainOfThoughtStrategy();
  }

  // Set callback for tool approval requests
  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  // Public accessors for UI
  getRuntimeLLM(): LLMClient | undefined {
    return this.llmClient;
  }
  
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  // Check if runtime is aborted
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  // Abort the current execution
  abort(reason: string = 'Aborted by user'): void {
    if (this.abortController) {
      this.abortController.abort(reason);
    }
  }

  // Create a new abort controller for a run
  private createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
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

  // Stream LLM response and yield events for each token
  // Returns the accumulated content when done
  async streamWithEvents(
    prompt: string, 
    mode: 'plan' | 'act', 
    signal: AbortSignal,
    onChunk: (content: string) => void
  ): Promise<string> {
    let fullContent = '';
    
    if (!this.llmClient?.supportsStreaming()) {
      // Fallback to non-streaming
      if (mode === 'plan') {
        const response = await this.llmClient!.plan(prompt);
        return JSON.stringify(response);
      } else {
        return '';
      }
    }
    
    try {
      for await (const delta of this.llmClient!.streamPrompt(prompt, { mode })) {
        signal.throwIfAborted();
        
        if (delta.type === 'content') {
          fullContent += delta.content;
          onChunk(fullContent);
        }
      }
    } catch (error) {
      console.error('[Runtime] Stream error:', error);
    }
    
    return fullContent;
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

    // Create abort controller for this run
    const ac = this.createAbortController();

    // input from the user 
    const event: AgentEvent = {type: 'user_input', input};
    yield event;
    this.emit(event);

    // Check if aborted before starting
    if (ac.signal.aborted) {
      yield { type: 'abort', reason: 'Aborted before start' };
      return;
    }

    // transition to planning 
    yield* this.planningPhase(input, ac.signal);

    // Reset tool call history for new run
    this.toolCallHistory = [];

    // check if planning is complete/suceeded
    if (ac.signal.aborted) {
      yield { type: 'abort', reason: 'Aborted during planning' };
      return;
    }

    if (this.state.status !== 'plan_ready'){
      console.log('[Runtime] Planning failed, aborting');
      yield { type: 'abort', reason: 'Planning failed' };
      return; 
    }

    // yield acting phase
    yield* this.actingPhase(input, ac.signal);

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
  private async * planningPhase(input:string, signal: AbortSignal): AsyncGenerator<AgentEvent>{
    this.state = {status: 'planning', thought: input};
    try{
      console.log('[Runtime] Calling llm in planm mode');
      
      // Check for abort
      signal.throwIfAborted();
      
      const planResponse = await this.llmClient!.plan(input);
      
      // Check for abort after LLM call
      signal.throwIfAborted();
      
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
  private async *actingPhase(userInput: string, signal: AbortSignal): AsyncGenerator<AgentEvent>{
    if(this.state.status != 'plan_ready') return;
    const plan = this.state.plan;
    let observations: Observation[] = [];
    let loopCount=0;
    let turn = this.state.turn;

    console.log('[Runtime] Starting acting phase...');

    // acting loop 
    while (true){
      // Check for abort at start of each iteration
      signal.throwIfAborted();
      
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
      const toolCallHistorySummary = this.getToolCallSummary();
      
      // Force synthesis if we have too many observations
      const forceSynthesis = observations.length >= 8;

      try{
        // Check for abort before LLM call
        signal.throwIfAborted();
        
        const response = await this.llmClient!.act(
          plan.reasoning,
          observationSummaries,
          availableTools,
          userInput,
          toolCallHistorySummary,
          forceSynthesis
        );
        
        // Check for abort after LLM call
        signal.throwIfAborted();
        
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

          // Check for duplicate/looping tool call
          if (this.isDuplicateToolCall(toolCall.name, toolCall.args)) {
            console.warn('[Runtime] Duplicate tool call detected, aborting');
            this.state = {
              status: 'aborted',
              reason: `Duplicate tool call: ${toolCall.name} with same arguments`,
              turn,
            };
            break;
          }

          if (this.isLoopingOnSimilarActions()) {
            console.warn('[Runtime] Looping on similar actions detected, aborting');
            this.state = {
              status: 'aborted',
              reason: `Looping detected: repeatedly calling same tool with same arguments`,
              turn,
            };
            break;
          }

          // Record this tool call
          this.recordToolCall(toolCall.name, toolCall.args);

          // Check if tool requires approval
          if (toolCall.requiresApproval && this.approvalCallback) {
            // Emit approval needed event
            const approvalEvent: AgentEvent = {
              type: 'tool_approval_needed',
              toolCall: {
                name: toolCall.name,
                args: toolCall.args,
                reasoning: toolCall.reasoning,
              },
            };
            yield approvalEvent;
            this.emit(approvalEvent);

            // Wait for user approval
            const approved = await this.approvalCallback(toolCall.name, toolCall.args, toolCall.reasoning);
            
            if (!approved) {
              this.state = {
                status: 'aborted',
                reason: `Tool ${toolCall.name} denied by user`,
                turn,
              };
              break;
            }
          }

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

  // Reset to initial state
  reset(): void {
    this.state = {status : 'waiting_for_input'};
    this.toolCallHistory = [];
  }

  // Record a tool call for loop detection
  recordToolCall(name: string, args: Record<string, unknown>): void {
    this.toolCallHistory.push({
      name,
      args,
      timestamp: new Date(),
    });
  }

  // Check if a tool call is a duplicate (same tool + similar args)
  isDuplicateToolCall(name: string, args: Record<string, unknown>): boolean {
    if (this.toolCallHistory.length === 0) return false;
    
    const lastCall = this.toolCallHistory[this.toolCallHistory.length - 1];
    if (lastCall.name !== name) return false;
    
    // For list_files, glob, grep - check if same path was queried
    if (name === 'list_files' || name === 'glob') {
      const lastPath = lastCall.args.path as string;
      const newPath = args.path as string;
      return lastPath === newPath;
    }
    
    // For read_file - check if same file
    if (name === 'read_file') {
      const lastPath = lastCall.args.path as string;
      const newPath = args.path as string;
      return lastPath === newPath;
    }
    
    // For other tools, check if args are similar
    return JSON.stringify(lastCall.args) === JSON.stringify(args);
  }

  // Check if we're looping on similar actions (e.g., listing same directory)
  isLoopingOnSimilarActions(): boolean {
    if (this.toolCallHistory.length < 2) return false;
    
    const recent = this.toolCallHistory.slice(-3);
    if (recent.length < 2) return false;
    
    // Check if all recent calls are to the same tool with same path
    const first = recent[0];
    if (!['list_files', 'glob', 'read_file'].includes(first.name)) return false;
    
    return recent.every(call => 
      call.name === first.name && 
      call.args.path === first.args.path
    );
  }

  // Get tool call history summary for LLM
  getToolCallSummary(): string {
    if (this.toolCallHistory.length === 0) return 'No tools called yet.';
    
    const recent = this.toolCallHistory.slice(-10);
    return recent.map((call, i) => {
      const path = call.args.path ? ` (${call.args.path})` : '';
      return `${i + 1}. ${call.name}${path}`;
    }).join('\n');
  }
}

// some code is dead code now likw the transition function, this was not my plan, but i showed the code that i have till now and claude suggested these changes, i will implement the other code but lets go with these for now

// async * makes run () a generator that can yield multiple events overtime. A regular async can return only once, but with this we can stream events as they happen, the caller can iterate with for await to receive inputs progressievely.
// yield sends data back to the caller generating a generator object, sends event to the caller and emit is used to trigger events 
// Transition? why? => immutability principle; running new task instead of mutating tasks
// eventListener is an array? why? => since multiple listeners may exist for a single function.



