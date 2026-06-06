import React from 'react';
import { Box, Text } from 'ink';
import path from 'path';
import { theme } from '../theme.js';

export interface FileChange {
  path: string;
  type: 'A' | 'M' | 'D';
}

interface FilesPanelProps {
  files: FileChange[];
  focused?: boolean;
  height?: number;
}

export const FilesPanel: React.FC<FilesPanelProps> = ({ files, focused, height }) => {
  const borderColor = focused ? theme.border.active : theme.border.dim;
  const maxItems = height ? Math.max(1, height - 3) : 8;
  const visible = files.slice(-maxItems);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} height={height} overflow="hidden">
      <Box paddingX={1}>
        <Text color={theme.text.secondary} bold>Files</Text>
      </Box>
      {visible.length === 0 ? (
        <Box paddingX={1} paddingBottom={1}>
          <Text color={theme.text.dim}>no changes</Text>
        </Box>
      ) : (
        visible.map((f, i) => {
          const dir = path.dirname(f.path);
          const name = path.basename(f.path);
          const dirPart = dir === '.' ? '' : dir + '/';
          const typeColor = f.type === 'A' ? theme.diff.added
            : f.type === 'D' ? theme.diff.deleted
            : theme.diff.modified;
          return (
            <Box key={i} paddingX={1} gap={1}>
              <Text color={typeColor} bold>{f.type}</Text>
              <Text color={theme.text.dim}>{dirPart}</Text>
              <Text color={theme.text.primary} bold>{name}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
};
