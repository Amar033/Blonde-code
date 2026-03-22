import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ToolCallBlockProps {
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  children?: React.ReactNode;
}

// Claude Code style tool call display
export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
  toolName,
  args,
  status,
  result,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Get status color
  const getStatusColor = () => {
    switch (status) {
      case 'running': return '#F59E0B'; // amber
      case 'success': return '#10B981'; // green
      case 'error': return '#EF4444'; // red
      default: return '#6B7280'; // gray
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case 'running': return '◇';
      case 'success': return '✓';
      case 'error': return '✗';
      default: return '○';
    }
  };

  // Format args for display
  const formatArgs = () => {
    const lines = JSON.stringify(args, null, 2).split('\n');
    if (lines.length <= 3 && !expanded) {
      return JSON.stringify(args);
    }
    return JSON.stringify(args, null, 2);
  };

  // Handle expand toggle
  useInput((input, key) => {
    if (key.return) {
      setExpanded(!expanded);
    }
  });

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Tool header */}
      <Box>
        <Text color={getStatusColor()}>{getStatusIcon()} </Text>
        <Text bold color="#C084FC">{toolName}</Text>
        <Text dimColor>...</Text>
        <Text color={getStatusColor()}>
          {status === 'running' ? 'running' : status === 'success' ? 'completed' : 'failed'}
        </Text>
      </Box>
      
      {/* Arguments (always show first level) */}
      <Box marginLeft={2}>
        <Text dimColor>{formatArgs()}</Text>
      </Box>
      
      {/* Result/observation */}
      {result && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text dimColor>Result: </Text>
          <Box marginLeft={2}>
            <Text color={status === 'error' ? '#EF4444' : '#10B981'}>
              {result.length > 200 && !expanded ? result.slice(0, 200) + '...' : result}
            </Text>
          </Box>
          {result.length > 200 && (
            <Box marginLeft={2}>
              <Text dimColor>{expanded ? '[collapse]' : '[expand]'}</Text>
            </Box>
          )}
        </Box>
      )}
      
      {/* Nested children (for observation chain) */}
      {children}
    </Box>
  );
};

// Tool call chain - shows the sequence of tool calls
interface ToolCallChainProps {
  calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    status: 'pending' | 'running' | 'success' | 'error';
    result?: string;
  }>;
}

export const ToolCallChain: React.FC<ToolCallChainProps> = ({ calls }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#374151" paddingX={1} paddingY={0}>
      {calls.map((call, index) => (
        <ToolCallBlock
          key={index}
          toolName={call.tool}
          args={call.args}
          status={call.status}
          result={call.result}
        />
      ))}
    </Box>
  );
};

// Plan display component
interface PlanDisplayProps {
  steps: string[];
  currentStep?: number;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({ steps, currentStep }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#3B82F6" paddingX={1} paddingY={0}>
      <Box marginBottom={0}>
        <Text bold color="#3B82F6">📋 Plan</Text>
      </Box>
      {steps.map((step, index) => (
        <Box key={index} marginLeft={1}>
          <Text color={index === currentStep ? '#F59E0B' : '#6B7280'}>
            {index === currentStep ? '▸' : '·'} {step}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

// Thinking indicator
interface ThinkingIndicatorProps {
  text?: string;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ text = 'Thinking...' }) => {
  return (
    <Box>
      <Text color="#F59E0B">◐</Text>
      <Text dimColor> {text}</Text>
    </Box>
  );
};
