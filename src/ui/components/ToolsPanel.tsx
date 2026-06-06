import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { BrailleSpinner } from './BrailleSpinner.js';

export interface ToolEntry {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  ms?: number;
}

interface ToolsPanelProps {
  tools: ToolEntry[];
  focused?: boolean;
  height?: number;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({ tools, focused, height }) => {
  const borderColor = focused ? theme.border.active : theme.border.dim;
  const maxItems = height ? Math.max(1, height - 3) : 8;
  const visible = tools.slice(-maxItems);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} height={height} overflow="hidden">
      <Box paddingX={1}>
        <Text color={theme.text.secondary} bold>Tools</Text>
      </Box>
      {visible.length === 0 ? (
        <Box paddingX={1} paddingBottom={1}>
          <Text color={theme.text.dim}>no tools called</Text>
        </Box>
      ) : (
        visible.map(t => (
          <Box key={t.id} paddingX={1} gap={1}>
            {t.status === 'running'
              ? <BrailleSpinner color={theme.status.running} />
              : t.status === 'done'
              ? <Text color={theme.status.success}>✓</Text>
              : <Text color={theme.status.error}>✗</Text>}
            <Text color={theme.text.secondary}>{t.name}</Text>
            {t.ms !== undefined && t.status !== 'running' && (
              <Text color={theme.text.dim}>{t.ms}ms</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  );
};
