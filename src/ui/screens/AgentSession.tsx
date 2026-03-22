import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { AgentRuntime } from '../../runtime/core.js';
import type { AgentState, Plan, Observation, ToolCall } from '../../types/agent.js';
import { Header } from '../components/Header.js';
import { TaskPanel } from '../components/TaskPanel.js';
import { PlanPanel } from '../components/PlanPanel.js';
import { ActionPanel } from '../components/ActionPanel.js';
import { HistoryPanel } from '../components/HistoryPanel.js';
import { StatsBar } from '../components/StatsBar.js';
import { colors, icons } from '../design-system.js';
import { ThinkingPanel } from '../components/ThinkingPanel.js';
import type { AgentEvent } from '../../types/events.js';

interface AgentSessionProps {
  runtime: AgentRuntime;
  task: string;
  onComplete: () => void;
  onCancel?: () => void;
}

interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
  resolve: (approved: boolean) => void;
}

interface PendingUpdates {
  state?: AgentState;
  plan?: Plan | null;
  thinking?: string | null;
  toolCall?: ToolCall | null;
  observation?: Observation;
  completed?: boolean;
  finalAnswer?: string | null;
  abortReason?: string | null;
  pendingApproval?: PendingApproval | null;
  streamingContent?: string | null;
}

export const AgentSession: React.FC<AgentSessionProps> = ({ runtime, task, onComplete, onCancel }) => {
  const [currentThinking, setCurrentThinking] = useState<string | null>(null);
  const [state, setState] = useState<AgentState>(runtime.getState());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [currentToolCall, setCurrentToolCall] = useState<ToolCall | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [completed, setCompleted] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [abortReason, setAbortReason] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingUpdatesRef = useRef<PendingUpdates>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);

  const flushUpdates = useCallback(() => {
    const updates = pendingUpdatesRef.current;
    if (updates.state !== undefined) {
      setState(updates.state);
      updates.state = undefined;
    }
    if (updates.plan !== undefined) {
      setPlan(updates.plan);
      updates.plan = undefined;
    }
    if (updates.thinking !== undefined) {
      setCurrentThinking(updates.thinking);
      updates.thinking = undefined;
    }
    if (updates.toolCall !== undefined) {
      setCurrentToolCall(updates.toolCall);
      updates.toolCall = undefined;
    }
    if (updates.observation) {
      setObservations(prev => [...prev, updates.observation!]);
      updates.observation = undefined;
    }
    if (updates.completed !== undefined) {
      setCompleted(updates.completed);
      updates.completed = undefined;
    }
    if (updates.finalAnswer !== undefined) {
      setFinalAnswer(updates.finalAnswer);
      updates.finalAnswer = undefined;
    }
    if (updates.abortReason !== undefined) {
      setAbortReason(updates.abortReason);
      updates.abortReason = undefined;
    }
    if (updates.pendingApproval !== undefined) {
      setPendingApproval(updates.pendingApproval);
      updates.pendingApproval = undefined;
    }
    if (updates.streamingContent !== undefined) {
      setStreamingContent(updates.streamingContent);
      updates.streamingContent = undefined;
    }
    flushTimeoutRef.current = null;
  }, []);

  const scheduleUpdate = useCallback((update: Partial<PendingUpdates>) => {
    Object.assign(pendingUpdatesRef.current, update);
    if (flushTimeoutRef.current === null) {
      flushTimeoutRef.current = setTimeout(flushUpdates, 0);
    }
  }, [flushUpdates]);

  // Handle keyboard input for approval
  useInput((input, key) => {
    if (pendingApproval) {
      if (input === 'y' || input === 'Y' || key.return) {
        pendingApproval.resolve(true);
        setPendingApproval(null);
      } else if (input === 'n' || input === 'N' || key.escape) {
        pendingApproval.resolve(false);
        setPendingApproval(null);
      }
    }
    
    // Allow continuing after completion
    if (completed && key.return) {
      onComplete();
    }
  });

  // Set up approval callback on mount
  useEffect(() => {
    runtime.setApprovalCallback(async (toolName, args, reasoning) => {
      return new Promise<boolean>((resolve) => {
        scheduleUpdate({
          pendingApproval: {
            toolName,
            args,
            reasoning,
            resolve,
          },
        });
        approvalResolveRef.current = resolve;
      });
    });

    return () => {
      runtime.setApprovalCallback(null);
    };
  }, [runtime, scheduleUpdate]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - startTime) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();

    (async () => {
      try {
        for await (const event of runtime.run(task)) {
          if (abortControllerRef.current?.signal.aborted) {
            break;
          }

          scheduleUpdate({ state: runtime.getState() });

          if (event.type === 'plan_generated') {
            scheduleUpdate({ plan: event.plan, streamingContent: null });
          }

          // Handle streaming content
          if (event.type === 'llm_streaming') {
            scheduleUpdate({ streamingContent: event.delta });
          }

          if (event.type === 'llm_response' && event.parsed.type === 'tool_call') {
            if (event.thinking) {
              scheduleUpdate({ thinking: event.thinking });
            }
            scheduleUpdate({
              toolCall: {
                name: event.parsed.tool,
                args: event.parsed.args,
                requiresApproval: event.parsed.requiresApproval || false,
                reasoning: undefined,
              },
            });
          }

          if (event.type === 'observation_ready') {
            scheduleUpdate({ observation: event.observation, toolCall: null });
          }

          if (event.type === 'complete') {
            scheduleUpdate({ completed: true, finalAnswer: event.finalResponse, streamingContent: null });
          }

          if (event.type === 'abort') {
            scheduleUpdate({ completed: true, abortReason: event.reason });
          }
        }
      } catch (error) {
        scheduleUpdate({ completed: true, abortReason: `Error: ${error}` });
      }
    })();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (flushTimeoutRef.current !== null) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, [runtime, task, scheduleUpdate]);

  const handleApprove = () => {
    if (pendingApproval) {
      pendingApproval.resolve(true);
      scheduleUpdate({ pendingApproval: null });
    }
  };

  const handleDeny = () => {
    if (pendingApproval) {
      pendingApproval.resolve(false);
      scheduleUpdate({ pendingApproval: null });
    }
  };

  const toolsUsed = observations.length;
  const estimatedCost = toolsUsed * 0.002;
  const turn = 'turn' in state ? state.turn : 0;
  const loopCount = 'loopCount' in state ? state.loopCount : undefined;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header status={state.status} turn={turn} loopCount={loopCount} />
      <TaskPanel task={task} />

      {plan && (
        <PlanPanel
          steps={plan.steps}
          reasoning={plan.reasoning}
          currentStep={observations.length}
          estimatedToolCalls={plan.estimatedToolCalls}
        />
      )}

      {currentToolCall && (
        <ActionPanel
          toolName={currentToolCall.name}
          args={currentToolCall.args}
          reasoning={currentToolCall.reasoning}
          isExecuting={state.status === 'executing_tool'}
        />
      )}

      {currentThinking && (
        <ThinkingPanel 
          thinking={currentThinking} 
          isActive={state.status === 'acting'}
        />
      )}

      <HistoryPanel observations={observations} maxVisible={5} />

      {pendingApproval && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={colors.warning}
          paddingX={2}
          paddingY={1}
        >
          <Box>
            <Text bold color={colors.warning}>
              {icons.warning} TOOL APPROVAL REQUIRED
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text bold>Tool: </Text>
            <Text color={colors.brand}>{pendingApproval.toolName}</Text>
          </Box>
          <Box>
            <Text bold>Args: </Text>
            <Text color={colors.textDim}>{JSON.stringify(pendingApproval.args)}</Text>
          </Box>
          {pendingApproval.reasoning && (
            <Box marginTop={1}>
              <Text bold>Reasoning: </Text>
              <Text color={colors.textDim}>{pendingApproval.reasoning}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text>
              <Text bold color={colors.success}>[Y]</Text>
              <Text>es / </Text>
              <Text bold color={colors.error}>[N]</Text>
              <Text>o </Text>
              <Text dimColor>(or press Enter/Escape)</Text>
            </Text>
          </Box>
        </Box>
      )}

      {/* Streaming content display */}
      {streamingContent && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={colors.thinking}
          paddingX={2}
          paddingY={1}
        >
          <Box>
            <Text bold color={colors.thinking}>
              {icons.thinking} Generating...
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={colors.text}>{streamingContent}</Text>
            <Text color={colors.thinking}>▌</Text>
          </Box>
        </Box>
      )}

      {completed && finalAnswer && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={colors.success}
          paddingX={2}
          paddingY={1}
        >
          <Text color={colors.success} bold>
            {icons.completed} COMPLETE
          </Text>
          <Text color={colors.text}>{finalAnswer}</Text>
          
          <Box marginTop={1}>
            <Text dimColor>
              Press <Text bold>Enter</Text> to start a new task
            </Text>
          </Box>
        </Box>
      )}

      {completed && abortReason && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={colors.error}
          paddingX={2}
          paddingY={1}
        >
          <Text color={colors.error} bold>
            {icons.error} ABORTED
          </Text>
          <Text color={colors.textDim}>{abortReason}</Text>
        </Box>
      )}

      <StatsBar
        toolsUsed={toolsUsed}
        elapsedSeconds={elapsedSeconds}
        estimatedCost={estimatedCost}
      />
    </Box>
  );
};
