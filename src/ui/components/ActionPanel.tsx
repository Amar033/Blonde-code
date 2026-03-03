import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors, icons } from '../design-system.js';

interface ActionPanelProps {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
  isExecuting: boolean;
}

export const ActionPanel: React.FC<ActionPanelProps> = ({ 
  toolName, 
  args, 
  reasoning,
  isExecuting 
}) => {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={colors.working}
      paddingX={2}
      paddingY={0}
    >
      {/* Header */}
      <Box>
        <Text color={colors.working} bold>
          {icons.tool} CURRENT ACTION
        </Text>
      </Box>

      {/* Tool info */}
      <Box marginTop={1}>
        <Text>
          <Text dimColor>Tool: </Text>
          <Text color={colors.brand} bold>{toolName}</Text>
        </Text>
      </Box>

      {/* Arguments */}
      <Box flexDirection="column" marginTop={0}>
        {Object.entries(args).map(([key, value]) => (
          <Box key={key}>
            <Text dimColor>{key}: </Text>
            <Text color={colors.text}>{String(value)}</Text>
          </Box>
        ))}
      </Box>

      {/* Reasoning */}
      {reasoning && (
        <Box marginTop={1}>
          <Text dimColor>
            {icons.chevron} {reasoning}
          </Text>
        </Box>
      )}

      {/* Execution status */}
      {isExecuting && (
        <Box marginTop={1}>
          <Text color={colors.working}>
            <Spinner type="dots" /> Executing...
          </Text>
        </Box>
      )}
    </Box>
  );
};
