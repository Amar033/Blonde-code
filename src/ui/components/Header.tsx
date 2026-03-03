import React from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../design-system.js';

interface HeaderProps {
  status: string;
  turn: number;
  loopCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ status, turn, loopCount }) => {
  // Map status to display info
  const statusMap: Record<string, { icon: string; color: string; label: string }> = {
    waiting_for_input: { icon: icons.idle, color: colors.idle, label: 'Idle' },
    planning: { icon: icons.thinking, color: colors.thinking, label: 'Planning' },
    plan_ready: { icon: icons.success, color: colors.success, label: 'Ready' },
    acting: { icon: icons.working, color: colors.working, label: 'Acting' },
    validating_tool: { icon: icons.thinking, color: colors.thinking, label: 'Validating' },
    executing_tool: { icon: icons.working, color: colors.working, label: 'Executing' },
    observing: { icon: icons.observing, color: colors.thinking, label: 'Observing' },
    completed: { icon: icons.completed, color: colors.success, label: 'Complete' },
    aborted: { icon: icons.error, color: colors.error, label: 'Aborted' },
  };

  const statusInfo = statusMap[status] || { 
    icon: icons.idle, 
    color: colors.text, 
    label: status 
  };

  return (
    <Box
      borderStyle="round"
      borderColor={colors.border}
      paddingX={2}
      paddingY={0}
    >
      <Box width="100%" justifyContent="space-between">
        {/* Left: Branding */}
        <Box>
          <Text bold color={colors.brand}>Blonde</Text>
          <Text dimColor> / agent</Text>
        </Box>

        {/* Right: Status */}
        <Box gap={2}>
          {loopCount !== undefined && (
            <Text dimColor>
              loop <Text color={colors.text}>{loopCount}</Text>
            </Text>
          )}
          
          <Text dimColor>
            turn <Text color={colors.text}>{turn}</Text>
          </Text>
          
          <Box gap={1}>
            <Text color={statusInfo.color}>{statusInfo.icon}</Text>
            <Text color={statusInfo.color} bold>{statusInfo.label}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
