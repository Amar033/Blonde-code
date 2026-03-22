import React from 'react';
import { Box, Text } from 'ink';

interface ToolCallBoxProps {
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
}

const MAX_RESULT_LENGTH = 500;

const formatToolName = (name: string): string => {
  return name.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
};

const formatArgs = (args: Record<string, unknown>): string => {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const formatResult = (result: string, status: string): string => {
  if (status === 'error') {
    return result;
  }

  let cleaned = result
    .replace(/<!doctype html>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
};

const ToolCallBox: React.FC<ToolCallBoxProps> = ({
  toolName,
  args,
  status,
  result,
}) => {
  const formattedName = formatToolName(toolName);
  const formattedArgs = formatArgs(args);
  const formattedResult = result ? formatResult(result, status) : '';

  const getStatusText = () => {
    switch (status) {
      case 'running': return 'Running';
      case 'success': return 'Completed';
      case 'error': return 'Failed';
      default: return 'Pending';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return '#F59E0B';
      case 'success': return '#10B981';
      case 'error': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const shouldTruncate = formattedResult.length > MAX_RESULT_LENGTH;
  const displayResult = shouldTruncate 
    ? formattedResult.slice(0, MAX_RESULT_LENGTH) + '...'
    : formattedResult;

  return (
    <Box 
      flexDirection="column" 
      borderStyle="round" 
      borderColor={status === 'error' ? '#EF4444' : '#374151'}
      marginY={0}
    >
      <Box>
        <Text dimColor>├─ </Text>
        <Text bold color="#C084FC">{formattedName}</Text>
        <Text dimColor> </Text>
        <Text color={getStatusColor()}>{getStatusText()}</Text>
        {status === 'running' && (
          <Text color="#F59E0B">...</Text>
        )}
        <Text dimColor> │</Text>
      </Box>

      <Box marginLeft={2} flexDirection="column">
        <Text dimColor>│ args:</Text>
        <Box marginLeft={2}>
          <Text dimColor>{formattedArgs}</Text>
        </Box>
      </Box>

      {result && (
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>│ result:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color={status === 'error' ? '#EF4444' : '#10B981'}>
              {displayResult}
            </Text>
            {shouldTruncate && (
              <Text dimColor color="#6B7280">
                │ (truncated - {formattedResult.length} chars total)
              </Text>
            )}
          </Box>
        </Box>
      )}

      {status === 'running' && !result && (
        <Box marginLeft={2}>
          <Text color="#F59E0B">│ ◐ Running...</Text>
        </Box>
      )}

      <Box>
        <Text dimColor>└─</Text>
      </Box>
    </Box>
  );
};

interface ToolCallBoxChainProps {
  calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    status: 'pending' | 'running' | 'success' | 'error';
    result?: string;
  }>;
}

export const ToolCallBoxChain: React.FC<ToolCallBoxChainProps> = ({ calls }) => {
  return (
    <Box flexDirection="column">
      {calls.map((call, index) => (
        <ToolCallBox
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

export const ToolCallLog = ToolCallBox;
export const ToolCallLogChain = ToolCallBoxChain;
