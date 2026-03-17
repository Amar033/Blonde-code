import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { AgentRuntime } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';
import { LLMClient } from '../../planner/llm-client.js';
import { colors, icons } from '../design-system.js';
import type { AgentState, Plan, Observation } from '../../types/agent.js';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolName?: string;
}

interface UnifiedSessionProps {
  initialTask?: string;
  onComplete?: () => void;
}

export const UnifiedSession: React.FC<UnifiedSessionProps> = ({ initialTask, onComplete }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m Blonde Agent. You can chat with me or type "run: <task>" to start an agent task.',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string>('idle');
  const [agentPlan, setAgentPlan] = useState<Plan | null>(null);
  const [agentObservations, setAgentObservations] = useState<Observation[]>([]);
  const [currentStreaming, setCurrentStreaming] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(2);

  // Initialize runtime
  const initializeRuntime = useCallback(async () => {
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
  }, []);

  // Add message helper
  const addMessage = useCallback((role: Message['role'], content: string, isStreaming = false, toolName?: string) => {
    const id = String(messageIdRef.current++);
    setMessages(prev => [...prev, {
      id,
      role,
      content,
      timestamp: new Date(),
      isStreaming,
      toolName,
    }]);
    return id;
  }, []);

  // Update message helper
  const updateMessage = useCallback((id: string, content: string, isStreaming = false) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, content, isStreaming } : msg
    ));
  }, []);

  // Remove streaming from message
  const finishStreaming = useCallback((id: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, isStreaming: false } : msg
    ));
  }, []);

  // Handle chat message with real LLM
  const handleChat = useCallback(async (userInput: string) => {
    const userMsgId = addMessage('user', userInput);
    setAgentStatus('thinking');
    
    // Add placeholder for assistant response
    const assistantMsgId = addMessage('assistant', '', true);
    
    try {
      const runtime = await initializeRuntime();
      const llm = runtime.getRuntimeLLM();
      const tools = runtime.getToolRegistry();
      
      if (!llm) {
        updateMessage(assistantMsgId, 'Error: LLM not initialized', false);
        setAgentStatus('idle');
        return;
      }
      
      // Chat-specific system prompt - conversational, not tool-focused
      const chatSystemPrompt = `You are a helpful and friendly coding assistant. 
Your name is Blonde. Respond to the user's question in a conversational way.
- If the user asks about your capabilities, describe them in plain English
- If the user wants to do something, tell them you can help - they can use "run:" prefix to execute tasks
- Be friendly, concise, and helpful
- Don't respond with JSON or tool calls - just talk naturally`;
      
      // Use LLM directly for chat
      let fullResponse = '';
      
      if (llm.supportsStreaming()) {
        // Build a simple chat prompt
        const chatPrompt = `${chatSystemPrompt}\n\nUser: ${userInput}\n\nAssistant:`;
        
        for await (const delta of llm.streamPrompt(chatPrompt, { mode: 'act', systemPrompt: chatSystemPrompt })) {
          if (delta.type === 'content') {
            fullResponse += delta.content;
            updateMessage(assistantMsgId, fullResponse, true);
          }
        }
        
        // Clean up response after streaming finishes
        fullResponse = fullResponse.replace(/\{"type":.*$/s, '').replace(/\n+$/, '').trim();
        if (!fullResponse) {
          fullResponse = 'I received your message. Type "run:" if you want me to execute a task.';
        }
        updateMessage(assistantMsgId, fullResponse, false);
      } else {
        // Fallback to non-streaming
        const response = await llm.act(
          chatSystemPrompt,
          [],
          tools.getAllTools(),
          userInput
        );
        // Handle different response types
        if (response.type === 'answer') {
          fullResponse = response.content || 'I received your message.';
        } else if (response.type === 'tool_call') {
          fullResponse = `I'd be happy to help with that! Use "run:" prefix to execute tasks.`;
        } else {
          fullResponse = 'I received your message. Type "run:" if you want me to execute something.';
        }
      }
      
      finishStreaming(assistantMsgId);
      setAgentStatus('idle');
    } catch (error) {
      updateMessage(assistantMsgId, `Error: ${error}`, false);
      setAgentStatus('idle');
    }
  }, [addMessage, updateMessage, finishStreaming, initializeRuntime]);

  // Handle agent task
  const handleRunTask = useCallback(async (task: string) => {
    const userMsgId = addMessage('user', `run: ${task}`);
    setIsAgentRunning(true);
    setAgentStatus('planning');
    
    try {
      const runtime = await initializeRuntime();
      
      // Run the agent
      for await (const event of runtime.run(task)) {
        setAgentStatus(runtime.getState().status || 'running');
        
        if (event.type === 'plan_generated') {
          setAgentPlan(event.plan);
          addMessage('system', `📋 Plan: ${event.plan.steps.length} steps`, false);
        }
        
        if (event.type === 'llm_response') {
          if (event.parsed.type === 'tool_call') {
            const toolMsgId = addMessage(
              'tool', 
              `🔧 ${event.parsed.tool}(${JSON.stringify(event.parsed.args)})`,
              false,
              event.parsed.tool
            );
          } else if (event.parsed.type === 'answer') {
            addMessage('assistant', event.parsed.content, false);
          }
        }
        
        if (event.type === 'observation_ready') {
          setAgentObservations(prev => [...prev, event.observation]);
          const obsMsgId = addMessage(
            'system',
            `${event.observation.success ? '✓' : '✗'} ${event.observation.summary}`,
            false
          );
        }
        
        if (event.type === 'complete') {
          addMessage('assistant', event.finalResponse, false);
        }
        
        if (event.type === 'abort') {
          addMessage('system', `⚠️ Aborted: ${event.reason}`, false);
        }
      }
    } catch (error) {
      addMessage('system', `Error: ${error}`, false);
    } finally {
      setIsAgentRunning(false);
      setAgentStatus('idle');
      setAgentPlan(null);
    }
  }, [addMessage, initializeRuntime]);

  // Detect user intent - chat vs task
  const detectIntent = (userInput: string): 'chat' | 'task' => {
    const lower = userInput.toLowerCase();
    
    // Explicit commands
    if (lower.startsWith('run:') || lower.startsWith('execute:') || lower.startsWith('do:')) {
      return 'task';
    }
    
    // Task keywords - file operations, code actions
    const taskPatterns = [
      // File operations
      /\bread\b.*\bfile\b/i, /\bwrite\b.*\bfile\b/i, /\bedit\b.*\bfile\b/i,
      /\blist\b.*\bfiles\b/i, /\bcreate\b.*\bfile\b/i, /\bdelete\b.*\bfile\b/i,
      /\bsearch\b/i, /\bfind\b.*\bfile\b/i, /\bgrep\b/i,
      // Code actions
      /\bimplement\b/i, /\brefactor\b/i, /\bfix\b.*\bbug\b/i, /\bdebug\b/i,
      /\bbuild\b/i, /\btest\b/i, /\brun\b.*\bcode\b/i,
      // Project actions
      /\binstall\b/i, /\bsetup\b/i, /\bconfigure\b/i,
      /\bcheck\b.*\bdependencies\b/i, /\bsummarize\b/i,
      // General task indicators
      /^(list|show|create|make|add|remove|delete|update|fix|check|find|search|read|write)/i,
    ];
    
    for (const pattern of taskPatterns) {
      if (pattern.test(userInput)) {
        return 'task';
      }
    }
    
    // Chat indicators - greetings, questions, general conversation
    const chatPatterns = [
      /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)/i,
      /\bhow are you\b/i, /\bwhat are you\b/i, /\bwho are you\b/i,
      /\bcan you\b/i, /\bcould you\b/i, /\bwould you\b/i,
      /\bhelp me\b/i, /\bexplain\b/i, /\btell me about\b/i,
      /\bwhat is\b/i, /\bwhat are\b/i, /\bhow does\b/i, /\bwhy\b/i,
      /\?$/,  // Ends with question mark
    ];
    
    for (const pattern of chatPatterns) {
      if (pattern.test(userInput)) {
        return 'chat';
      }
    }
    
    // Default to chat for short inputs or ambiguous cases
    if (userInput.split(/\s+/).length <= 5) {
      return 'chat';
    }
    
    // For longer inputs, default to task (more likely to be instructions)
    return 'task';
  };

  // Handle input submission
  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;
    
    const userInput = input.trim();
    setInput('');
    
    // Special commands
    if (userInput === 'stop' && isAgentRunning) {
      runtimeRef.current?.abort();
      setIsAgentRunning(false);
      setAgentStatus('idle');
      addMessage('system', 'Agent stopped.');
      return;
    }
    if (userInput === 'clear') {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: 'Conversation cleared.',
        timestamp: new Date(),
      }]);
      messageIdRef.current = 2;
      return;
    }
    if (userInput === '?') {
      setShowHelp(!showHelp);
      return;
    }
    if (userInput === 'chat') {
      // Force chat mode
      handleChat(userInput);
      return;
    }
    if (userInput.startsWith('run:') || userInput.startsWith('execute:') || userInput.startsWith('do:')) {
      // Explicit task
      const task = userInput.replace(/^(run:|execute:|do:)\s*/i, '').trim();
      if (task) {
        handleRunTask(task);
      }
      return;
    }
    
    // Auto-detect intent
    const intent = detectIntent(userInput);
    
    if (intent === 'task') {
      handleRunTask(userInput);
    } else {
      handleChat(userInput);
    }
  }, [input, isAgentRunning, showHelp, addMessage, handleChat, handleRunTask, detectIntent]);

  // Keyboard shortcuts
  useInput((inputStr, key) => {
    if (key.ctrl && inputStr === 'c') {
      if (isAgentRunning) {
        runtimeRef.current?.abort();
        setIsAgentRunning(false);
        setAgentStatus('idle');
        addMessage('system', 'Operation cancelled.');
      }
    }
    if (key.ctrl && inputStr === 'l') {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: 'Conversation cleared.',
        timestamp: new Date(),
      }]);
      messageIdRef.current = 2;
    }
  });

  // Run initial task if provided
  useEffect(() => {
    if (initialTask) {
      handleRunTask(initialTask);
    }
  }, [initialTask]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor={colors.border}
        paddingX={2}
        paddingY={0}
      >
        <Text bold color={colors.brand}>BLONDE</Text>
        <Text dimColor> / </Text>
        {isAgentRunning ? (
          <>
            <Text color={colors.thinking}>{icons.thinking} Agent running</Text>
            <Text dimColor> ({agentStatus})</Text>
          </>
        ) : (
          <Text color={colors.success}>Ready</Text>
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
        {messages.map((msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            <Box>
              {msg.role === 'user' && <Text bold color={colors.brand}>You: </Text>}
              {msg.role === 'assistant' && <Text bold color={colors.working}>Blonde: </Text>}
              {msg.role === 'system' && <Text bold color={colors.textMuted}>System: </Text>}
              {msg.role === 'tool' && <Text bold color={colors.warning}>🔧 {msg.toolName}: </Text>}
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
        borderColor={isAgentRunning ? colors.warning : colors.borderActive}
        paddingX={2}
        paddingY={0}
      >
        <Text dimColor>{'> '}</Text>
        <TextInput 
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isAgentRunning ? "Agent running... (type 'stop' to cancel)" : "Type message or 'run: <task>'"}
        />
      </Box>

      {/* Help */}
      {showHelp && (
        <Box marginTop={1} paddingX={2} flexDirection="column">
          <Text dimColor>
            <Text bold>Commands: </Text>
            <Text color={colors.brand}>run: &lt;task&gt;</Text> start agent
            {' | '}
            <Text bold>stop</Text> stop agent
            {' | '}
            <Text bold>clear</Text> clear
            {' | '}
            <Text bold>?</Text> toggle help
          </Text>
        </Box>
      )}
    </Box>
  );
};