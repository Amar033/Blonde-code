import React from 'react';
import { Box, Text } from 'ink';
import { colors,icons } from '../design-system.js';

interface StatsBarProps {
  toolsUsed: number;
  elapsedSeconds: number;
  estimatedCost: number;
}

export const StatsBar: React.FC<StatsBarProps> = ({ 
  toolsUsed, 
  elapsedSeconds,
  estimatedCost 
}) => {
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <Box marginTop={1} paddingX={2}>
      <Text dimColor>
        {toolsUsed} tools {icons.bullet} {formatTime(elapsedSeconds)} {icons.bullet} ${estimatedCost.toFixed(4)}
      </Text>
    </Box>
  );
};
