import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { colors, icons } from '../design-system.js';
import { AgentRuntime } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStreamingContent, setCurrentStreamingContent] = useState('');
  const [showHelp, setShowHelp] = useState(true);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      // Cancel current operation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setIsProcessing(false);
        setCurrentStreamingContent('');
        const cancelMsg: Message = {
          role: 'system',
          content: 'Operation cancelled.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, cancelMsg]);
      }
    }
    if (key.ctrl && input === 'l') {
      // Clear chat
      setMessages([{
        role: 'assistant',
        content: 'Chat cleared. How can I help you?',
        timestamp: new Date(),
      }]);
    }
    if (input === '?') {
      setShowHelp(!showHelp);
    }
  });

  const initializeRuntime = async () => {
    if (!runtimeRef.current) {
      const registry = new ToolRegistry();
      runtimeRef.current = new AgentRuntime(registry, {
        maxTurns: 30,
        maxLoopCount: 20,
        debug: false,
      });
      await runtimeRef.current.initialize();
    }
    return runtimeRef.current;
  };

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    
    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Check if it's a command
    if (userInput.startsWith('run:')) {
      const task = userInput.slice(4).trim();
      if (task) {
        onStartAgent(task);
      }
      return;
    }

    // Start processing
    setIsProcessing(true);
    setCurrentStreamingContent('');
    
    // Add placeholder for streaming response
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const runtime = await initializeRuntime();
      abortControllerRef.current = new AbortController();

      // For chat mode, we'll use a simple approach - just get the response
      // This is a placeholder - in a full implementation, you'd want a chat-specific method
      let fullResponse = '';
      
      // Simulate streaming for now - in real impl, use runtime.streamChat()
      for (let i = 0; i < userInput.length; i++) {
        if (abortControllerRef.current?.signal.aborted) break;
        await new Promise(r => setTimeout(r, 30));
        const char = userInput[i % userInput.length];
        fullResponse += char;
        setCurrentStreamingContent(fullResponse);
        
        // Update the last message
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: fullResponse,
          };
          return updated;
        });
      }

      if (!abortControllerRef.current?.signal.aborted) {
        // Final response when streaming is done
        const finalResponse = `I received: "${userInput}".\n\nFor actual execution, use "run: <task>" to start agent mode.\nExample: "run: read package.json"`;
        
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: finalResponse,
            timestamp: new Date(),
            isStreaming: false,
          };
          return updated;
        });
      }
    } catch (error) {
      const errorMsg: Message = {
        role: 'system',
        content: `Error: ${error}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
      setCurrentStreamingContent('');
    }
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
        {isProcessing && (
          <Text color={colors.thinking}> {icons.thinking} Processing...</Text>
        )}
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
              {msg.role === 'user' && (
                <Text bold color={colors.brand}>You:</Text>
              )}
              {msg.role === 'assistant' && (
                <Text bold color={colors.working}>Blonde:</Text>
              )}
              {msg.role === 'system' && (
                <Text bold color={colors.textMuted}>System:</Text>
              )}
              {msg.isStreaming && (
                <Text color={colors.thinking}> {icons.thinking}</Text>
              )}
            </Box>
            <Box marginLeft={2}>
              <Text color={msg.role === 'system' ? colors.textMuted : colors.text}>
                {msg.content}
                {msg.isStreaming && <Text color={colors.thinking}>▌</Text>}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={isProcessing ? colors.warning : colors.borderActive}
        paddingX={2}
        paddingY={0}
      >
        <Text dimColor>{'> '}</Text>
        <TextInput 
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? "Processing... (Ctrl+C to cancel)" : "Type a message or 'run: <task>' to start agent..."}
        />
      </Box>

      {/* Help */}
      {showHelp && (
        <Box marginTop={1} paddingX={2} flexDirection="column">
          <Text dimColor>
            <Text bold>Commands: </Text>
            <Text color={colors.brand}>run: &lt;task&gt;</Text> start agent
            {' | '}
            <Text bold>?</Text> toggle help
            {' | '}
            <Text bold>Ctrl+L</Text> clear
            {' | '}
            <Text bold>Ctrl+C</Text> cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};