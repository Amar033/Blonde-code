import React from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../design-system.js';

interface TaskPanelProps {
  task: string;
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ task }) => {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={colors.border}
      paddingX={2}
      paddingY={0}
    >
      <Text dimColor>TASK</Text>
      <Text color={colors.text}>{task}</Text>
    </Box>
  );
};
