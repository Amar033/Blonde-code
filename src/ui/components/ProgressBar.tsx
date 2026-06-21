import React from 'react';
import { theme } from '../theme.js';

interface ProgressBarProps {
  value: number;
  width?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, width = 12 }) => {
  const pct    = Math.max(0, Math.min(100, value));
  const filled = Math.round((pct / 100) * width);
  const empty  = width - filled;
  const color  = pct >= 95 ? theme.status.error
    : pct >= 80 ? theme.status.warning
    : theme.status.success;

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color}>{'█'.repeat(filled)}{'░'.repeat(empty)}</text>
      <text fg={theme.text.secondary}>{pct}%</text>
    </box>
  );
};
