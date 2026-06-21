import React from 'react';
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
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      title=" Files "
      titleColor={theme.text.secondary}
      height={height}
    >
      {visible.length === 0 ? (
        <text fg={theme.text.dim}>  no changes</text>
      ) : (
        visible.map((f, i) => {
          const dir  = path.dirname(f.path);
          const name = path.basename(f.path);
          const dirPart   = dir === '.' ? '' : dir + '/';
          const typeColor = f.type === 'A' ? theme.diff.added
            : f.type === 'D' ? theme.diff.deleted
            : theme.diff.modified;
          return (
            <box key={i} paddingLeft={1} paddingRight={1} gap={1}>
              <text fg={typeColor}><strong>{f.type}</strong></text>
              <text fg={theme.text.dim}>{dirPart}</text>
              <text fg={theme.text.primary}><strong>{name}</strong></text>
            </box>
          );
        })
      )}
    </box>
  );
};
