import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';

interface TaskDisplayProps {
  task: string;
}

const TaskDisplay: React.FC<TaskDisplayProps> = ({ task }) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.borderDim}
      paddingX={2}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={colors.primary}>
        {symbols.plan} TASK
      </Text>
      <Text>{task}</Text>
    </Box>
  );
};

export default TaskDisplay;
