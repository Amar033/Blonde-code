import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors, symbols } from '../theme.js';
import type { ToolCall } from '../../types/agent.js';

interface ActionViewProps {
  toolCall: ToolCall | null;
  isExecuting: boolean;
}

const ActionView: React.FC<ActionViewProps> = ({ toolCall, isExecuting }) => {
  if (!toolCall) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="bold"
      borderColor={colors.executing}
      paddingX={2}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={colors.executing}>
        {symbols.tool} CURRENT ACTION
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text>
            <Text bold>Tool: </Text>
            <Text color={colors.primary}>{toolCall.name}</Text>
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={0}>
          <Text bold>Arguments:</Text>
          {Object.entries(toolCall.args).map(([key, value]) => (
            <Box key={key} marginLeft={2}>
              <Text>
                <Text color={colors.info}>{key}:</Text> {String(value)}
              </Text>
            </Box>
          ))}
        </Box>

        {toolCall.reasoning && (
          <Box marginTop={1}>
            <Text dimColor>
              Why: <Text color={colors.text}>{toolCall.reasoning}</Text>
            </Text>
          </Box>
        )}

        {isExecuting && (
          <Box marginTop={1}>
            <Text color={colors.executing}>
              <Spinner type="dots" /> Executing...
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ActionView;
