import React from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../design-system.js';

interface Observation {
  toolName: string;
  input: Record<string, unknown>;
  summary: string;
  success: boolean;
  timestamp: Date;
}

interface HistoryPanelProps {
  observations: Observation[];
  maxVisible?: number;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ 
  observations, 
  maxVisible = 5 
}) => {
  if (observations.length === 0) return null;

  const visible = observations.slice(-maxVisible);

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={colors.border}
      paddingX={2}
      paddingY={0}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Text dimColor bold>HISTORY</Text>
        <Text dimColor>{observations.length} operations</Text>
      </Box>

      {/* Observations */}
      <Box flexDirection="column" marginTop={1}>
        {visible.map((obs, index) => {
          if (!obs) return null;
          const displayIcon = obs.success ? icons.success : icons.error;
          const displayColor = obs.success ? colors.success : colors.error;

          return (
            <Box key={index} flexDirection="column" marginBottom={index < visible.length - 1 ? 1 : 0}>
              {/* Tool call */}
              <Box>
                <Text color={displayColor}>{displayIcon}</Text>
                <Text> </Text>
                <Text bold>{obs.toolName}</Text>
                <Text dimColor>(</Text>
                <Text color={colors.textDim}>
                  {Object.entries(obs.input)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')
                    .slice(0, 40)}
                  {Object.entries(obs.input).length > 1 ? '...' : ''}
                </Text>
                <Text dimColor>)</Text>
              </Box>

              {/* Summary */}
              <Box marginLeft={2}>
                <Text color={colors.textDim}>
                  {icons.arrow} {obs.summary}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
