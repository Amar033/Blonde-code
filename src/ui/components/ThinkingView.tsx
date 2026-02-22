import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';

interface ThinkingViewProps {
  content: string | null;
}

const ThinkingView: React.FC<ThinkingViewProps> = ({ content }) => {
  if (!content) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.borderDim}
      paddingX={2}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={colors.warning}>
        {symbols.chat} LLM THINKING
      </Text>
      
      <Box marginTop={1}>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
};

export default ThinkingView;
