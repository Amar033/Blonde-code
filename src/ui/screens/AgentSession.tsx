import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { AgentRuntime } from '../../runtime/core.js';
import type { AgentState, Plan, Observation, ToolCall } from '../../types/agent.js';
import { Header } from '../components/Header.js';
import { TaskPanel } from '../components/TaskPanel.js';
import { PlanPanel } from '../components/PlanPanel.js';
import { ActionPanel } from '../components/ActionPanel.js';
import { HistoryPanel } from '../components/HistoryPanel.js';
import { StatsBar } from '../components/StatsBar.js';
import { colors, icons } from '../design-system.js';

interface AgentSessionProps {
  runtime: AgentRuntime;
  task: string;
  onComplete: () => void;
}

export const AgentSession: React.FC<AgentSessionProps> = ({ runtime, task, onComplete }) => {
  const [state, setState] = useState<AgentState>(runtime.getState());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [currentToolCall, setCurrentToolCall] = useState<ToolCall | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [completed, setCompleted] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [abortReason, setAbortReason] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - startTime) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  useEffect(() => {
    (async () => {
      try {
        for await (const event of runtime.run(task)) {
          setState(runtime.getState());

          if (event.type === 'plan_generated') {
            setPlan(event.plan);
          }

          if (event.type === 'llm_response' && event.parsed.type === 'tool_call') {
            setCurrentToolCall({
              name: event.parsed.tool,
              args: event.parsed.args,
              requiresApproval: event.parsed.requiresApproval || false,
              reasoning: event.parsed.reasoning,
            });
          }

          if (event.type === 'observation_ready') {
            setObservations(prev => [...prev, event.observation]);
            setCurrentToolCall(null);
          }

          if (event.type === 'complete') {
            setCompleted(true);
            setFinalAnswer(event.finalResponse);
          }

          if (event.type === 'abort') {
            setCompleted(true);
            setAbortReason(event.reason);
          }
        }
      } catch (error) {
        setCompleted(true);
        setAbortReason(`Error: ${error}`);
      }
    })();
  }, []);

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

      <HistoryPanel observations={observations} maxVisible={5} />

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
              Press <Text bold>Ctrl+C</Text> to exit or start a new task
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
