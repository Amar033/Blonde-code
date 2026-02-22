import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { AgentRuntime } from '../../runtime/core.js';
import type { AgentEvent } from '../../types/events.js';
import type { AgentState, Plan, Observation, ToolCall } from '../../types/agent.js';
import Header from './Header.js';
import TaskDisplay from './TaskDisplay.js';
import PlanView from './PlanView.js';
import ActionView from './ActionView.js';
import HistoryView from './HistoryView.js';
import ThinkingView from './ThinkingView.js';
import StatsBar from './StatsBar.js';
import { colors } from '../theme.js';

interface AgentTUIProps {
  runtime: AgentRuntime;
  task: string;
}

const AgentTUI: React.FC<AgentTUIProps> = ({ runtime, task }) => {
  const [state, setState] = useState<AgentState>(runtime.getState());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [currentToolCall, setCurrentToolCall] = useState<ToolCall | null>(null);
  const [lastLLMThinking, setLastLLMThinking] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [abortReason, setAbortReason] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((Date.now() - startTime) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  // Main execution loop
  useEffect(() => {
    (async () => {
      try {
        for await (const event of runtime.run(task)) {
          setState(runtime.getState());

          // Handle different event types
          if (event.type === 'plan_generated') {
            setPlan(event.plan);
          }

          if (event.type === 'llm_response') {
            if (event.parsed.type === 'tool_call') {
              setCurrentToolCall({
                name: event.parsed.tool,
                args: event.parsed.args,
                requiresApproval: event.parsed.requiresApproval || false,
                reasoning: event.parsed.reasoning,
              });
            } else if (event.parsed.type === 'answer') {
              setLastLLMThinking(event.parsed.content);
            }
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
        setAbortReason(`Runtime error: ${error}`);
      }
    })();
  }, []);

  // Calculate stats
  const toolsUsed = observations.length;
  const estimatedCost = toolsUsed * 0.002; // Mock cost calculation

  return (
    <Box flexDirection="column">
      <Header state={state} />
      
      <TaskDisplay task={task} />

      <PlanView 
        plan={plan} 
        currentStep={plan ? Math.min(observations.length, plan.steps.length - 1) : 0}
      />

      <ActionView 
        toolCall={currentToolCall} 
        isExecuting={state.status === 'executing_tool'}
      />

      <HistoryView observations={observations} maxDisplay={5} />

      {lastLLMThinking && !completed && (
        <ThinkingView content={lastLLMThinking} />
      )}

      {completed && finalAnswer && (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor={colors.completed}
          paddingX={2}
          paddingY={1}
          marginTop={1}
        >
          <Text bold color={colors.completed}>
            ✅ TASK COMPLETE
          </Text>
          <Text>{finalAnswer}</Text>
        </Box>
      )}

      {completed && abortReason && (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor={colors.aborted}
          paddingX={2}
          paddingY={1}
          marginTop={1}
        >
          <Text bold color={colors.aborted}>
            ❌ ABORTED
          </Text>
          <Text>{abortReason}</Text>
        </Box>
      )}

      <StatsBar 
        toolsUsed={toolsUsed}
        elapsedTime={elapsedTime}
        estimatedCost={estimatedCost}
      />
    </Box>
  );
};

export default AgentTUI;
