import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { colors, icons } from '../design-system.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatScreenProps {
  onStartAgent: (task: string) => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ onStartAgent }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m Blonde Agent. You can chat with me or give me a task to execute. Type "run: <task>" to start agent mode.',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Check if it's a command
    if (input.startsWith('run:')) {
      const task = input.slice(4).trim();
      onStartAgent(task);
      return;
    }

    // Simulate assistant response (replace with real LLM call later)
    setTimeout(() => {
      const assistantMessage: Message = {
        role: 'assistant',
        content: `I understand you said: "${input}". To execute a task, use "run: <task>". For example: "run: read package.json"`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    }, 500);

    setInput('');
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height="100%">
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor={colors.border}
        paddingX={2}
        paddingY={0}
      >
        <Text bold color={colors.brand}>BLONDE</Text>
        <Text dimColor> / chat mode</Text>
      </Box>

      {/* Messages */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={colors.border}
        paddingX={2}
        paddingY={1}
        flexGrow={1}
      >
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={i < messages.length - 1 ? 1 : 0}>
            <Box>
              <Text bold color={msg.role === 'user' ? colors.brand : colors.working}>
                {msg.role === 'user' ? 'You' : 'Blonde'}:
              </Text>
            </Box>
            <Box marginLeft={2}>
              <Text color={colors.text}>{msg.content}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={colors.borderActive}
        paddingX={2}
        paddingY={0}
      >
        <Text dimColor>{'> '}</Text>
        <TextInput 
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type a message or 'run: <task>' to start agent..."
        />
      </Box>

      {/* Help */}
      <Box marginTop={1} paddingX={2}>
        <Text dimColor>
          Tip: Use <Text bold>run: &lt;task&gt;</Text> to start agent execution
        </Text>
      </Box>
    </Box>
  );
};
