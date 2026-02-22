import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { colors, symbols } from '../theme.js';
import type { AgentState } from '../../types/agent.js';

interface HeaderProps {
  state: AgentState;
}

const Header: React.FC<HeaderProps> = ({ state }) => {
  const getStatusColor = (status: string): string => {
    const colorMap: Record<string, string> = {
      waiting_for_input: colors.waiting,
      planning: colors.planning,
      plan_ready: colors.success,
      acting: colors.acting,
      validating_tool: colors.info,
      executing_tool: colors.executing,
      observing: colors.observing,
      completed: colors.completed,
      aborted: colors.aborted,
    };
    return colorMap[status] || colors.text;
  };

  const getStatusLabel = (status: string): string => {
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const turn = 'turn' in state ? state.turn : 0;
  const loopCount = 'loopCount' in state ? state.loopCount : 0;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="double"
      borderColor={colors.border}
      paddingX={2}
      paddingY={0}
    >
      <Box>
        <Gradient name="rainbow">
          <Text bold>
            {symbols.agent} BLONDE AGENT
          </Text>
        </Gradient>
      </Box>

      <Box flexDirection="row" gap={2}>
        {state.status === 'acting' && (
          <Text dimColor>
            Loop {loopCount}
          </Text>
        )}
        
        <Text>
          <Text dimColor>[</Text>
          <Text color={getStatusColor(state.status)} bold>
            ●
          </Text>
          <Text dimColor>] </Text>
          <Text color={getStatusColor(state.status)}>
            {getStatusLabel(state.status)}
          </Text>
        </Text>

        <Text dimColor>
          Turn {turn}
        </Text>
      </Box>
    </Box>
  );
};

export default Header;
