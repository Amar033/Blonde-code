import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';
import type { Observation } from '../../types/agent.js';

interface HistoryViewProps {
  observations: Observation[];
  maxDisplay?: number;
}

const HistoryView: React.FC<HistoryViewProps> = ({ 
  observations, 
  maxDisplay = 5 
}) => {
  if (observations.length === 0) return null;

  const displayObservations = observations.slice(-maxDisplay);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.borderDim}
      paddingX={2}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={colors.secondary}>
        {symbols.history} EXECUTION HISTORY ({observations.length})
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {displayObservations.map((obs, index) => {
          const icon = obs.success ? symbols.success : symbols.failure;
          const summaryColor = obs.success ? colors.success : colors.error;

          // Calculate duration (mock for now)
          const duration = '0.2s'; // TODO: Calculate from timestamp

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Box>
                <Text>
                  <Text color={summaryColor}>{icon}</Text>
                  {' '}
                  <Text bold>{obs.toolName}</Text>
                  <Text dimColor>(</Text>
                  <Text color={colors.info}>
                    {Object.entries(obs.input)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')}
                  </Text>
                  <Text dimColor>)</Text>
                  {' '}
                  <Text dimColor>[{duration}]</Text>
                </Text>
              </Box>
              
              <Box marginLeft={2}>
                <Text dimColor>→ </Text>
                <Text>{obs.summary}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default HistoryView;
