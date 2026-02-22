import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';
import type { Plan } from '../../types/agent.js';

interface PlanViewProps {
  plan: Plan | null;
  currentStep?: number;
}

const PlanView: React.FC<PlanViewProps> = ({ plan, currentStep = 0 }) => {
  if (!plan) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.info}
      paddingX={2}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={colors.info}>
        {symbols.thinking} PLAN
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {plan.steps.map((step, index) => {
          let icon: string;
          let stepColor: string;

          if (index < currentStep) {
            icon = symbols.done;
            stepColor = colors.success;
          } else if (index === currentStep) {
            icon = symbols.current;
            stepColor = colors.warning;
          } else {
            icon = symbols.pending;
            stepColor = colors.textDim;
          }

          return (
            <Box key={index} marginBottom={0}>
              <Text color={stepColor}>
                {index + 1}. {icon} {step}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Reasoning: <Text color={colors.text}>{plan.reasoning}</Text>
        </Text>
      </Box>

      <Box marginTop={0}>
        <Text dimColor>
          Estimated tools: {plan.estimatedToolCalls}
        </Text>
      </Box>
    </Box>
  );
};

export default PlanView;
