import React from 'react';
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
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      title=" Tools "
      titleColor={theme.text.secondary}
      height={height}
    >
      {visible.length === 0 ? (
        <text fg={theme.text.dim}>  no tools called</text>
      ) : (
        visible.map(t => (
          <box key={t.id} paddingLeft={1} paddingRight={1} gap={1}>
            {t.status === 'running'
              ? <BrailleSpinner color={theme.status.running} />
              : t.status === 'done'
              ? <text fg={theme.status.success}>✓</text>
              : <text fg={theme.status.error}>✗</text>}
            <text fg={theme.text.secondary}>{t.name}</text>
            {t.ms !== undefined && t.status !== 'running' && (
              <text fg={theme.text.dim}>{t.ms}ms</text>
            )}
          </box>
        ))
      )}
    </box>
  );
};
