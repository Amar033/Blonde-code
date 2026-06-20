import React from 'react';
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
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      title=" Context "
      titleColor={theme.text.secondary}
      height={height}
    >
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text fg={theme.text.dim}>{fmt(used)} / {fmt(total)} tokens</text>
        <ProgressBar value={pct} width={14} />
      </box>
    </box>
  );
};
