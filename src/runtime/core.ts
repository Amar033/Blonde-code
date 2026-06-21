// core event loop 

import type {AgentState, Plan, Observation, ToolCall} from '../types/agent.js'
import type {AgentEvent, PlannerResponse} from '../types/events.js'
import {isState, isTerminal} from '../types/agent.js'
import {LLMClient} from '../planner/llm-client.js'
import {PlanningStrategy} from '../runtime/strategies/planning-strategy.js'
import {ChainOfThoughtStrategy} from '../runtime/strategies/planning-strategy.js'
import {ToolRegistry} from '../tools/registry.js'
import type {Tool} from '../tools/base.js'
import type {AgentConfig} from '../agent/agent'
import {classifyIntent, isConversational} from '../planner/intent-classifier.js'
import {repoMapService} from '../services/repo-map.js'
import {exec} from 'child_process'
import {promisify} from 'util'
import {extname} from 'path'

const execAsync = promisify(exec);
// runtime configuration (global configuration for the runtime to prevebnt infinite loops and max iterations)
export interface RuntimeConfig{
  maxTurns: number;
  maxLoopCount: number;
  maxConsecutiveErrors: number;
  debug: boolean;
  agent?: string;
  workspacePath?: string;
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

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
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
  private agentName: string = 'build';
  // Sliding conversation history — kept across run() calls so the LLM knows what was discussed
  private conversationHistory: ConversationTurn[] = [];
  // Dynamically computed once the context window is known — see getHistoryCharLimit()
  private historyCharLimit = 8000;
  private compacting = false; // prevents re-entrant compaction calls


  constructor(toolRegistry: ToolRegistry, config: Partial<RuntimeConfig> = {}){
    this.state = { status: 'waiting_for_input'};
    this.toolRegistry = toolRegistry;
    this.config = {
      maxTurns: config.maxTurns ?? 10,  // if the config isnt set up globally it defaults to 10 
      maxLoopCount: config.maxLoopCount ?? 5,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      debug: config.debug ?? true,
      agent: config.agent ?? 'build',
    };
    this.agentName = this.config.agent ?? 'build';
    this.planningStrategy = new ChainOfThoughtStrategy();
  }

  // Set callback for tool approval requests
  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  getRuntimeLLM(): LLMClient | undefined {
    return this.llmClient;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getTokenUsage(): number {
    return this.llmClient?.getTokenUsage() ?? 0;
  }

  async getContextWindow(): Promise<number> {
    return this.llmClient?.getContextWindow() ?? 8192;
  }

  getConversationHistory(): ConversationTurn[] {
    return [...this.conversationHistory];
  }

  loadConversationHistory(turns: ConversationTurn[]): void {
    this.conversationHistory = [...turns];
    // Apply the same sliding-window limit as pushHistory
    while (
      this.conversationHistory.reduce((n, t) => n + t.content.length, 0) > this.historyCharLimit &&
      this.conversationHistory.length > 2
    ) {
      this.conversationHistory.shift();
    }
  }

  private pushHistory(role: 'user' | 'assistant', content: string): void {
    this.conversationHistory.push({ role, content });

    const totalChars = () => this.conversationHistory.reduce((n, t) => n + t.content.length, 0);

    // Compact early at 70% capacity when there are enough turns to summarise.
    // This is much better than blindly dropping turns at 100%: the agent retains
    // a coherent written summary of what it did rather than just losing context.
    if (
      this.llmClient &&
      totalChars() > this.historyCharLimit * 0.70 &&
      this.conversationHistory.length >= 4 &&
      !this.compacting
    ) {
      this.compactHistoryAsync();
    }

    // Hard fallback: if compaction hasn't finished yet and we're at the limit, just drop
    while (totalChars() > this.historyCharLimit && this.conversationHistory.length > 2) {
      this.conversationHistory.shift();
    }
  }

  // Summarise the oldest half of conversation history into a single synthetic turn.
  // Runs asynchronously — the guard flag prevents multiple simultaneous compactions.
  private async compactHistoryAsync(): Promise<void> {
    if (!this.llmClient || this.compacting) return;
    this.compacting = true;

    try {
      // Take the oldest half of turns to compact — keep the recent half intact
      const cutoff  = Math.floor(this.conversationHistory.length / 2);
      const toCompact = this.conversationHistory.slice(0, cutoff);
      const toKeep    = this.conversationHistory.slice(cutoff);

      const block = toCompact
        .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
        .join('\n');

      const res = await this.llmClient.callProvider(
        `Summarise this conversation history in 2-4 sentences. Focus on what files were edited, what tools were called, what errors were found, and what was accomplished. Be specific about file names and outcomes.\n\n${block}`,
        { mode: 'plan', maxTokens: 300, temperature: 0.3 }
      );

      const summary: ConversationTurn = {
        role: 'assistant',
        content: `[Earlier in this session: ${res.content.trim()}]`,
      };

      this.conversationHistory = [summary, ...toKeep];
    } catch {
      // Non-fatal — history will just hard-trim on the next pushHistory call
    } finally {
      this.compacting = false;
    }
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
    }
    this.eventListeners.forEach(listener => listener(event));
  }

  async initialize(): Promise<void> {
    const { getAgent } = await import('../agent/agent');
    const agentConfig  = await getAgent(this.agentName);
    this.llmClient     = await LLMClient.fromEnv(agentConfig);

    // Set history budget based on the real context window:
    // reserve 30% for the active prompt (tools + repo map + plan + observations)
    // 1 token ≈ 3 chars of mixed prose+code
    this.llmClient.getContextWindow().then(ctxTokens => {
      const historyTokens  = Math.floor(ctxTokens * 0.70);
      this.historyCharLimit = historyTokens * 3;
    }).catch(() => { /* keep default 8000 */ });

    // Build repo map in background — inject into LLMClient once ready
    const root = this.config.workspacePath ?? process.cwd();
    repoMapService.build(root).then(() => {
      this.llmClient?.setRepoMap(repoMapService.getFormatted());
    }).catch(() => { /* non-fatal */ });
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

    // Reset tool call history before each new run (conversation history persists)
    this.toolCallHistory = [];

    // Record user message before planning
    this.pushHistory('user', input);

    // Pre-flight: skip plan/act entirely for greetings and small talk.
    // Small models hallucinate plans (e.g. "create a project") for casual messages.
    if (isConversational(input)) {
      const priorHistory = this.conversationHistory.slice(0, -1); // exclude the turn we just pushed
      try {
        const reply = await this.llmClient!.quickReply(input, priorHistory);
        this.pushHistory('assistant', reply);
        this.state = { status: 'completed', finalAnswer: reply, turn: 1 };
        const ce: AgentEvent = { type: 'complete', finalResponse: reply };
        yield ce;
        this.emit(ce);
      } catch {
        this.state = { status: 'completed', finalAnswer: 'Hey! How can I help?', turn: 1 };
        const ce: AgentEvent = { type: 'complete', finalResponse: 'Hey! How can I help?' };
        yield ce;
        this.emit(ce);
      }
      return;
    }

    // pass a snapshot of history (minus the turn we just added) so planner has prior context
    const historySnapshot = this.conversationHistory.slice(0, -1);

    // transition to planning
    yield* this.planningPhase(input, ac.signal, historySnapshot);

    if (ac.signal.aborted) {
      yield { type: 'abort', reason: 'Aborted during planning' };
      return;
    }

    // When the planner returns a direct answer (simple question, no tools needed)
    // emit it as a complete event rather than treating it as a planning failure
    if (this.state.status === 'completed') {
      const answer = (this.state as any).finalAnswer as string;
      const ce: AgentEvent = { type: 'complete', finalResponse: answer };
      yield ce;
      this.emit(ce);
      return;
    }

    if (this.state.status !== 'plan_ready') {
      const stateReason = (this.state as any).reason as string | undefined;
      // Surface the real error (API failures, auth errors, etc.) so the user knows what's wrong
      const reason = stateReason
        ? stateReason.startsWith('Planning Error:')
          ? stateReason.replace('Planning Error: Error: ', '').replace('Planning Error: ', '')
          : stateReason
        : 'Planning failed — model did not return a valid plan. Try rephrasing.';
      yield { type: 'abort', reason };
      return;
    }

    // yield acting phase
    yield* this.actingPhase(input, ac.signal, historySnapshot);

    // Cast to full union to reset the plan_ready narrowing TypeScript holds after the early-return check above
    const finalState = this.state as AgentState;
    if (finalState.status === 'completed'){
      // Record assistant answer into sliding history
      this.pushHistory('assistant', finalState.finalAnswer);
      const completeEvent: AgentEvent = {
        type: 'complete',
        finalResponse: finalState.finalAnswer
      };
      yield completeEvent;
      this.emit(completeEvent);
    } else if (finalState.status === 'aborted'){
      const abortEvent: AgentEvent = {
        type: 'abort',
        reason: finalState.reason
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
  private async * planningPhase(input:string, signal: AbortSignal, history: ConversationTurn[] = []): AsyncGenerator<AgentEvent>{
    this.state = {status: 'planning', thought: input};
    try{
      signal.throwIfAborted();

      // Stream plan tokens so the UI can show live thinking text
      let planResponse = null as import('../types/events.js').PlannerResponse | null;
      for await (const chunk of this.llmClient!.planStream(input, history)) {
        signal.throwIfAborted();
        if (chunk.type === 'token') {
          const ev: AgentEvent = { type: 'llm_streaming', delta: chunk.delta, thinking: chunk.thinking, inThinkBlock: chunk.inThinkBlock };
          yield ev;
          this.emit(ev);
        } else {
          planResponse = chunk.response;
        }
      }
      if (!planResponse) {
        this.state = { status: 'aborted', reason: 'Plan stream produced no response', turn: 1 };
        return;
      }

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
      } else if (planResponse.type === 'answer') {
        this.state = { status: 'completed', finalAnswer: planResponse.content, turn: 1 };
      } else if ((planResponse as any).type === 'need_info') {
        // Model asked a clarifying question — surface it as a direct response instead of aborting
        this.state = {
          status: 'completed',
          finalAnswer: (planResponse as any).question ?? 'I need more information to help you.',
          turn: 1,
        };
      } else {
        this.state = { status: 'aborted', reason: 'Model returned an unrecognised response type.', turn: 1 };
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
  private async *actingPhase(userInput: string, signal: AbortSignal, history: ConversationTurn[] = []): AsyncGenerator<AgentEvent>{
    if(this.state.status != 'plan_ready') return;
    const plan = this.state.plan;
    let observations: Observation[] = [];
    let loopCount=0;
    let turn = this.state.turn;

    // Select only the tools relevant to this query — keeps act prompts small
    const allTools = this.toolRegistry.getAllTools();
    const relevantNames = classifyIntent(userInput ?? '', allTools.length);
    const contextTools = relevantNames.length > 0
      ? allTools.filter(t => relevantNames.includes(t.name))
      : allTools;

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
        break;
      }

      if (turn >= this.config.maxTurns){
        this.state={
          status: 'aborted',
          reason: `Max turns (${this.config.maxTurns}) exceeded`,
          turn
        };
        break;
      }

      this.state={
        status: 'acting',
        plan,
        observations,
        turn,
        loopCount
      };

      const availableTools = contextTools;

      const observationSummaries = observations.map(o => o.summary);

      // Inject targeted directives for actionable observation kinds.
      // These sit at the end of the summaries list so the LLM sees them right before it acts.
      const latestObs = observations[observations.length - 1];
      if (latestObs?.kind === 'type_error') {
        observationSummaries.push('⚠️ DIRECTIVE: Fix ALL TypeScript errors listed above before writing any other files or calling any other tools. Do not proceed until tsc is clean.');
      } else if (latestObs?.kind === 'test_failure') {
        observationSummaries.push('⚠️ DIRECTIVE: Fix the failing tests above. Do not call any other tools until all tests pass.');
      }

      const toolCallHistorySummary = this.getToolCallSummary();

      // Force synthesis if we have too many observations
      const forceSynthesis = observations.length >= 8;

      try{
        // Check for abort before LLM call
        signal.throwIfAborted();
        
        const planText = `Steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nReasoning: ${plan.reasoning}`;

        // Stream the act tokens live
        let response = null as import('../types/events.js').PlannerResponse | null;
        for await (const chunk of this.llmClient!.actStream(
          planText, observationSummaries, availableTools,
          userInput, toolCallHistorySummary, forceSynthesis, history
        )) {
          signal.throwIfAborted();
          if (chunk.type === 'token') {
            const ev: AgentEvent = { type: 'llm_streaming', delta: chunk.delta, thinking: chunk.thinking, inThinkBlock: chunk.inThinkBlock };
            yield ev;
            this.emit(ev);
          } else {
            response = chunk.response;
          }
        }

        if (!response) {
          this.state = { status: 'aborted', reason: 'Act stream produced no response', turn };
          break;
        }

        signal.throwIfAborted();

        const llmEvent: AgentEvent={
          type: 'llm_response',
          content: JSON.stringify(response),
          parsed: response
        };
        yield llmEvent;
        this.emit(llmEvent);

        if(response.type === 'answer'){
          this.state= {
            status: 'completed',
            finalAnswer: response.content,
            turn
          };
          break;
        } else if (response.type === 'need_info'){
          //  Need user input (futre: pause ans wait)
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


          // Nudge instead of abort on duplicate — give the LLM a chance to recover
          if (this.isDuplicateToolCall(toolCall.name, toolCall.args)) {
            const nudge = this.createErrorObservation(
              toolCall.name, toolCall.args,
              `You already called ${toolCall.name} with these same arguments. Do NOT repeat it. Use the results you already have and move to the next step in the plan.`
            );
            observations.push(nudge);
            const nudgeEvent: AgentEvent = { type: 'observation_ready', observation: nudge };
            yield nudgeEvent;
            this.emit(nudgeEvent);
            loopCount++;
            turn++;
            continue;
          }

          if (this.isLoopingOnSimilarActions()) {
            this.state = {
              status: 'aborted',
              reason: 'Looping detected: repeatedly calling same tool. Use information already gathered and provide a final answer.',
              turn,
            };
            break;
          }

          // Record this tool call
          this.recordToolCall(toolCall.name, toolCall.args);

          // Check if tool requires approval — use the TOOL DEFINITION, not the LLM response.
          // The LLM never sets requiresApproval, so toolCall.requiresApproval is always false.
          const toolDef = this.toolRegistry.get(toolCall.name);
          const needsApproval = toolDef?.requiresApproval || toolDef?.isDangerous;
          if (needsApproval && this.approvalCallback) {
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

            const approved = await this.approvalCallback(toolCall.name, toolCall.args, toolCall.reasoning);

            if (!approved) {
              // Don't abort the whole agent — just skip this tool call and let the LLM try something else
              const denyObs = this.createErrorObservation(
                toolCall.name, toolCall.args,
                `User denied execution of ${toolCall.name}. Try a different approach.`
              );
              observations.push(denyObs);
              const denyEvent: AgentEvent = { type: 'observation_ready', observation: denyObs };
              yield denyEvent;
              this.emit(denyEvent);
              loopCount++;
              turn++;
              continue;
            }
          }

          // validation and execution
          const observation = await this.executeToolCall(toolCall, plan, observations, turn);

          if (observation){
            observations.push(observation);

            const obsEvent: AgentEvent={
              type: 'observation_ready',
              observation
            };
            yield obsEvent;
            this.emit(obsEvent);

            // Emit sources from web_search so the UI can display citations
            if (toolCall.name === 'web_search' && observation.success && observation.result) {
              const rawResults = (observation.result as any)?.results;
              if (Array.isArray(rawResults) && rawResults.length > 0) {
                const sources = rawResults
                  .filter((r: any) => r.url && r.title)
                  .map((r: any) => ({ title: String(r.title), url: String(r.url) }));
                if (sources.length > 0) {
                  const sourcesEvent: AgentEvent = { type: 'sources_ready', sources };
                  yield sourcesEvent;
                  this.emit(sourcesEvent);
                }
              }
            }

            // After any edit_file (success or failure), allow one verification read
            // by clearing that path from the duplicate-detection history.
            if (toolCall.name === 'edit_file') {
              const p = toolCall.args.path as string | undefined;
              if (p) {
                this.toolCallHistory = this.toolCallHistory.filter(
                  c => !(c.name === 'read_file' && c.args.path === p)
                );
              }
            }

            // Invalidate repo map for any file that was written or edited
            if (toolCall.name === 'write_file' || toolCall.name === 'edit_file') {
              const p = toolCall.args.path as string | undefined;
              if (p && observation?.success) {
                const root = this.config.workspacePath ?? process.cwd();
                repoMapService.invalidate(p, root).then(() => {
                  this.llmClient?.setRepoMap(repoMapService.getFormatted());
                }).catch(() => {});

                // Run tsc after every successful TypeScript edit.
                // If there are errors, push them as a new observation so the agent
                // sees them immediately and can self-correct in the next loop turn.
                const diagText = await this.runTypeDiagnostics(p);
                if (diagText) {
                  const diagObs = this.createErrorObservation(toolCall.name, toolCall.args, `⚠️ ${diagText}`, 'type_error');
                  observations.push(diagObs);
                  const diagEvent: AgentEvent = { type: 'observation_ready', observation: diagObs };
                  yield diagEvent;
                  this.emit(diagEvent);
                }
              }
            }
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
        console.error('[Runtime] Act mode error:', error);
        this.state={
          status: 'aborted',
          reason: `Act mode Failed: ${error}`,
          turn 
        };
        break;
      }
    }
  }

  // Run tsc --noEmit after a TypeScript file is written/edited.
  // Returns null if clean, or the error text if there are type errors.
  // This is what closes the write→verify loop — the agent sees errors as observations
  // and can fix them before it ever returns a final answer.
  private async runTypeDiagnostics(filePath: string): Promise<string | null> {
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.ts' && ext !== '.tsx') return null;

    try {
      await execAsync('npx tsc --noEmit 2>&1', {
        cwd: this.config.workspacePath ?? process.cwd(),
        timeout: 20_000,
      });
      return null; // clean
    } catch (e: any) {
      // tsc exits non-zero when there are errors — that's expected, not a crash
      const raw: string = e.stdout ?? e.message ?? '';
      // Cap output — no need to flood the agent with 500 lines
      const lines = raw.trim().split('\n').filter(Boolean);
      const errors = lines.filter(l => l.includes(': error TS'));
      if (errors.length === 0) return null; // warnings only, not errors
      const capped = errors.slice(0, 15).join('\n');
      const tail   = errors.length > 15 ? `\n(+${errors.length - 15} more errors)` : '';
      return `TypeScript errors after editing ${filePath}:\n${capped}${tail}`;
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
      console.error(`[Runtime] Tool ${toolCall.name}:`, validation.errors);
      return this.createErrorObservation(
        toolCall.name,
        toolCall.args,
        `Invalid args: ${(validation.errors ?? []).join(', ')}`
      );
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
          const content = typeof output.content === 'string' ? output.content : '';
          const lines = content.split('\n').length;
          const wasTruncated = result.metadata?.truncated || content.length > 2500;
          const preview = content.slice(0, 2500);
          summary = `Read ${input.path}: ${lines} lines${wasTruncated ? ' (truncated)' : ''}\n${preview}${wasTruncated ? '\n...' : ''}`;
        } else {
          summary = `Failed to read ${input.path}: ${result.error}`;
        }
        break;

      case 'list_files':
        if (result.success && result.metadata) {
          const { fileCount, dirCount, files, directories } = result.metadata;
          const fileList = (files as string[] || []).slice(0, 8).join(', ');
          const dirList  = (directories as string[] || []).map(d => `${d}/`).join(', ');
          summary = `Listed ${input.path}: ${fileCount} files, ${dirCount} dirs.`;
          if (fileList) summary += ` Files: ${fileList}${(files as string[])?.length > 8 ? '…' : ''}.`;
          if (dirList)  summary += ` Subdirs: ${dirList}`;
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
          const findPrev  = String(input.find    ?? '').slice(0, 60);
          const replaceNew = String(input.replace ?? '').slice(0, 60);
          const net = result.output.netChange;
          summary = `Edited ${input.path} (net ${net >= 0 ? '+' : ''}${net} chars).\n  - "${findPrev}${(input.find as string)?.length > 60 ? '…' : ''}"\n  + "${replaceNew}${(input.replace as string)?.length > 60 ? '…' : ''}"`;
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
          // Strip markdown links and collapse whitespace so the preview is a clean single line
          const rawPreview = (content || '') as string;
          const preview = rawPreview
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[#*`_>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
          summary = `Fetched ${input.url}: HTTP ${statusCode}, ${contentLength} chars. ${preview}…`;
        } else {
          summary = `Web fetch failed: ${result.error}`;
        }
        break;

      case 'web_search':
        if (result.success && result.output) {
          const { resultsCount, results, provider } = result.output;
          const via = provider === 'searxng' ? 'SearXNG' : provider === 'duckduckgo' ? 'DuckDuckGo' : provider ?? 'unknown';
          summary = `Web search via ${via} — ${resultsCount} results. Top: ${(results || []).slice(0, 3).map((r: any) => r.title).join(' | ')}`;
        } else {
          summary = `Web search failed: ${result.error}`;
        }
        break;

      case 'git_status':
        if (result.success && result.output) {
          const { branch, changes } = result.output as { branch: string; changes: string[] };
          summary = `Git status — branch: ${branch}. ${changes.length} change(s): ${changes.slice(0, 5).join(', ')}${changes.length > 5 ? '…' : ''}`;
        } else {
          summary = `git_status failed: ${result.error}`;
        }
        break;

      case 'git_diff':
        if (result.success && result.output) {
          const { diff, path: diffPath } = result.output as { diff: string; path: string };
          const { additions = 0, deletions = 0 } = result.metadata ?? {};
          const diffLines = diff.split('\n');
          const preview = diffLines
            .filter((l: string) => l.startsWith('@@') || l.startsWith('+') || l.startsWith('-') || l.startsWith(' '))
            .slice(0, 80)
            .join('\n');
          summary = `Git diff (${diffPath}): +${additions} -${deletions} lines.\n${preview}`;
        } else {
          summary = `git_diff failed: ${result.error}`;
        }
        break;

      case 'git_log':
        if (result.success && result.output) {
          const { commits } = result.output as { commits: Array<{ hash: string; message: string }> };
          summary = `Git log — ${commits.length} commits:\n${commits.map(c => `  ${c.hash} ${c.message}`).join('\n')}`;
        } else {
          summary = `git_log failed: ${result.error}`;
        }
        break;

      case 'git_add':
        summary = result.success
          ? `Staged: ${(result.output as any)?.paths}. Staged files: ${((result.output as any)?.staged ?? []).join(', ')}`
          : `git_add failed: ${result.error}`;
        break;

      case 'git_commit':
        summary = result.success
          ? `Committed: "${(result.output as any)?.message}" (${(result.output as any)?.hash})`
          : `git_commit failed: ${result.error}`;
        break;

      case 'git_branch':
        if (result.success && result.output) {
          const out = result.output as any;
          summary = out.branches
            ? `Branches: ${out.branches.join(', ')} (current: ${out.current})`
            : out.message ?? 'Branch operation done';
        } else {
          summary = `git_branch failed: ${result.error}`;
        }
        break;

      case 'git_stash':
        summary = result.success
          ? `Stash ${(result.output as any)?.action}: ${(result.output as any)?.message ?? 'done'}`
          : `git_stash failed: ${result.error}`;
        break;

      case 'delete_file':
        summary = result.success
          ? `Deleted: ${(result.output as any)?.path}`
          : `delete_file failed: ${result.error}`;
        break;

      case 'rename_file':
        summary = result.success
          ? `Moved: ${(result.output as any)?.from} → ${(result.output as any)?.to}`
          : `rename_file failed: ${result.error}`;
        break;

      case 'search_codebase':
        if (result.success && result.output) {
          const { query, matchCount, formatted } = result.output as any;
          summary = `Codebase search "${query}" — ${matchCount} match(es):\n${formatted ?? ''}`;
        } else {
          summary = `search_codebase failed: ${result.error}`;
        }
        break;

      case 'file_tree':
        if (result.success && result.output) {
          const { tree, path: treePath } = result.output as { tree: string; path: string };
          const { fileCount = 0, dirCount = 0 } = result.metadata ?? {};
          const lines = tree.split('\n').slice(0, 30);
          summary = `Tree of ${treePath}: ${fileCount} files, ${dirCount} dirs.\n${lines.join('\n')}${tree.split('\n').length > 30 ? '\n…' : ''}`;
        } else {
          summary = `file_tree failed: ${result.error}`;
        }
        break;

      default:
        if (result.success) {
          summary = `Executed ${toolName} successfully`;
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

    const kind = this.kindForTool(toolName, result.success);
    return {
      toolName,
      input,
      result: result.output,
      summary,
      timestamp: new Date(),
      success: result.success,
      kind,
    };
  }

  private kindForTool(toolName: string, success: boolean): import('../types/agent.js').ObservationKind {
    if (!success) return 'error';
    if (['read_file', 'list_files', 'file_tree', 'glob', 'grep'].includes(toolName)) return 'file_read';
    if (['write_file', 'edit_file', 'replace_block', 'delete_file', 'rename_file'].includes(toolName)) return 'file_write';
    if (toolName === 'bash') return 'shell_output';
    if (['web_search', 'web_fetch', 'search_codebase'].includes(toolName)) return 'search_result';
    if (toolName.startsWith('git_')) return 'git_result';
    return 'shell_output';
  }

  // Create error observations
  private createErrorObservation(
    toolName: string,
    input: Record<string,unknown>,
    error: string,
    kind: import('../types/agent.js').ObservationKind = 'error'
  ): Observation {
    return {
      toolName,
      input,
      result: null,
      summary: `Error: ${error}`,
      timestamp: new Date(),
      success: false,
      kind,
    };
  }

  // check if consecutive errors came in 
   private hasConsecutiveErrors(observations: Observation[], n: number): boolean{
    if(observations.length<n)return false;
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
      return {status: 'planning', thought: event.input};
    }

    if (isState(current, 'planning') && event.type === 'llm_response'){
      return {
        status: 'completed',
        finalAnswer: event.parsed.type === 'answer' ? event.parsed.content : 'Done',
        turn: 1
      };
    }

    // no valid transition case: stay in current state
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

  // Check if a tool call is a duplicate (same tool + same key arg) — scans ALL history
  isDuplicateToolCall(name: string, args: Record<string, unknown>): boolean {
    if (this.toolCallHistory.length === 0) return false;

    return this.toolCallHistory.some(call => {
      if (call.name !== name) return false;

      if (name === 'list_files' || name === 'glob' || name === 'read_file') {
        return call.args.path === args.path;
      }

      if (name === 'web_search') {
        return call.args.query === args.query;
      }

      if (name === 'web_fetch') {
        return call.args.url === args.url;
      }

      if (name === 'grep') {
        return call.args.pattern === args.pattern && call.args.path === args.path;
      }

      return JSON.stringify(call.args) === JSON.stringify(args);
    });
  }

  // Check if we're looping on similar actions (e.g., searching the same query repeatedly)
  isLoopingOnSimilarActions(): boolean {
    if (this.toolCallHistory.length < 3) return false;

    const recent = this.toolCallHistory.slice(-3);
    const first = recent[0];

    if (!['list_files', 'glob', 'read_file', 'web_search', 'web_fetch'].includes(first.name)) return false;

    return recent.every(call => {
      if (call.name !== first.name) return false;
      if (first.name === 'web_search') return call.args.query === first.args.query;
      if (first.name === 'web_fetch')  return call.args.url   === first.args.url;
      return call.args.path === first.args.path;
    });
  }

  // Get tool call history summary for LLM
  getToolCount(): number {
    return this.toolRegistry.getAllTools().length;
  }

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



