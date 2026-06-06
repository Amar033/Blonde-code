import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { ProgressBar } from './ProgressBar.js';

interface ContextPanelProps {
  used: number;
  total: number;
  focused?: boolean;
  height?: number;
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ used, total, focused, height }) => {
  const borderColor = focused ? theme.border.active : theme.border.dim;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} height={height} overflow="hidden">
      <Box paddingX={1}>
        <Text color={theme.text.secondary} bold>Context</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        <Text color={theme.text.dim}>{fmt(used)} / {fmt(total)} tokens</Text>
        <ProgressBar value={pct} width={14} />
      </Box>
    </Box>
  );
};
