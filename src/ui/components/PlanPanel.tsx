import React from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../design-system.js';

interface PlanPanelProps {
  steps: string[];
  reasoning: string;
  currentStep: number;
  estimatedToolCalls: number;
}

export const PlanPanel: React.FC<PlanPanelProps> = ({ 
  steps, 
  reasoning, 
  currentStep,
  estimatedToolCalls 
}) => {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={colors.borderActive}
      paddingX={2}
      paddingY={0}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={colors.borderActive} bold>
          {icons.planning} PLAN
        </Text>
        <Text dimColor>
          {currentStep + 1}/{steps.length} steps
        </Text>
      </Box>

      {/* Steps */}
      <Box flexDirection="column" marginTop={1}>
        {steps.map((step, index) => {
          const isDone = index < currentStep;
          const isCurrent = index === currentStep;
          const isPending = index > currentStep;

          let icon: string;
          let textColor: string;

          if (isDone) {
            icon = icons.success;
            textColor = colors.success;
          } else if (isCurrent) {
            icon = icons.arrow;
            textColor = colors.working;
          } else {
            icon = icons.idle;
            textColor = colors.textDim;
          }

          return (
            <Box key={index}>
              <Text color={textColor}>
                {icon} {index + 1}. {step}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Reasoning */}
      <Box marginTop={1}>
        <Text dimColor>
          {icons.chevron} {reasoning}
        </Text>
      </Box>

      {/* Estimated tool calls */}
      <Box marginTop={0}>
        <Text dimColor>
          Est. {estimatedToolCalls} tool calls
        </Text>
      </Box>
    </Box>
  );
};
