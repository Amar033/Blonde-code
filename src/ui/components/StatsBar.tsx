import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';

interface StatsBarProps {
  toolsUsed: number;
  elapsedTime: number;
  estimatedCost: number;
}

const StatsBar: React.FC<StatsBarProps> = ({ 
  toolsUsed, 
  elapsedTime, 
  estimatedCost 
}) => {
  const formatTime = (seconds: number): string => {
    return seconds < 60 
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
  };

  return (
    <Box
      marginTop={1}
      paddingX={2}
      justifyContent="space-between"
    >
      <Text dimColor>
        Stats: {' '}
        <Text color={colors.info}>{toolsUsed}</Text> tools used | {' '}
        <Text color={colors.warning}>{formatTime(elapsedTime)}</Text> elapsed | {' '}
        <Text color={colors.success}>${estimatedCost.toFixed(4)}</Text> cost
      </Text>
    </Box>
  );
};

export default StatsBar;
