import React from 'react';
import { Box, Text } from 'ink';
import os from 'os';
import { theme } from '../theme.js';

const CWD = process.cwd().replace(os.homedir(), '~');

export interface AppHeaderProps {
  model: string;
  provider?: string;
  branch?: string | null;
  tokenUsage?: number;
  timeDisplay?: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  model,
  provider,
  branch,
  tokenUsage,
  timeDisplay,
}) => (
  <Box height={3} borderStyle="round" borderColor={theme.border.normal} paddingX={2}>
    <Text bold color={theme.brand}>◆ Blonde</Text>
    <Text color={theme.text.dim}> ╱ </Text>
    <Text color={theme.text.secondary}>{model}</Text>
    {provider && (
      <>
        <Text color={theme.text.dim}> · </Text>
        <Text color={theme.text.dim}>{provider}</Text>
      </>
    )}
    {branch && (
      <>
        <Text color={theme.text.dim}> ╱ </Text>
        <Text color={theme.status.warning}>{branch}</Text>
      </>
    )}
    {tokenUsage !== undefined && tokenUsage > 0 && (
      <>
        <Text color={theme.text.dim}> ╱ </Text>
        <Text color={theme.text.link}>↑{tokenUsage.toLocaleString()} tokens</Text>
      </>
    )}
    {timeDisplay && (
      <>
        <Text color={theme.text.dim}> ╱ </Text>
        <Text color={theme.text.dim}>{timeDisplay}</Text>
      </>
    )}
    <Text color={theme.text.dim}> ╱ </Text>
    <Text color={theme.text.dim}>{CWD}</Text>
  </Box>
);
