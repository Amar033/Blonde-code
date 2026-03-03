import React, { useState } from 'react';
import { Box } from 'ink';
import { AgentRuntime } from '../runtime/core.js';
import { ToolRegistry } from '../tools/registry.js';
import { ReadFileTool } from '../tools/file-read.js';
import { ListFilesTool } from '../tools/list-files.js';
import { WelcomeScreen} from './screens/WelcomeScreen.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { AgentSession } from './screens/AgentSession.js';

type Screen = 'welcome' | 'chat' | 'agent';

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [task, setTask] = useState('');
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);

  const initializeRuntime = async () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new ListFilesTool());

    const rt = new AgentRuntime(registry, {
      maxTurns: 30,
      maxLoopCount: 20,
      debug: false,
    });

    await rt.initialize();
    return rt;
  };

  const handleStartFromWelcome = async (userTask: string) => {
    setTask(userTask);
    const rt = await initializeRuntime();
    setRuntime(rt);
    setScreen('agent');
  };

  const handleStartFromChat = async (userTask: string) => {
    setTask(userTask);
    const rt = await initializeRuntime();
    setRuntime(rt);
    setScreen('agent');
  };

  const handleComplete = () => {
    setScreen('welcome');
    setRuntime(null);
  };

  return (
    <Box>
      {screen === 'welcome' && (
        <WelcomeScreen onStart={handleStartFromWelcome} />
      )}

      {screen === 'chat' && (
        <ChatScreen onStartAgent={handleStartFromChat} />
      )}

      {screen === 'agent' && runtime && (
        <AgentSession 
          runtime={runtime} 
          task={task}
          onComplete={handleComplete}
        />
      )}
    </Box>
  );
};
