import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../design-system.js';

interface ThinkingPanelProps {
  thinking: string;
  isActive?: boolean;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ 
  thinking, 
  isActive = false 
}) => {
  const [expanded, setExpanded] = useState(isActive);

  if (!thinking) return null;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={isActive ? colors.thinking : colors.border}
      paddingX={2}
      paddingY={0}
    >
      {/* Header - clickable to expand/collapse */}
      <Box>
        <Text color={colors.thinking} bold>
          {icons.thinking} THINKING
        </Text>
        <Text dimColor> {expanded ? '(click to collapse)' : '(click to expand)'}</Text>
      </Box>

      {/* Thinking content - collapsible */}
      {expanded && (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.text}>{thinking}</Text>
        </Box>
      )}

      {/* Collapsed state */}
      {!expanded && (
        <Box marginTop={0}>
          <Text dimColor>
            {thinking.slice(0, 80)}...
          </Text>
        </Box>
      )}
    </Box>
  );
};
