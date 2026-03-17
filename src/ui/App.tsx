import React, { useState } from 'react';
import { Box } from 'ink';
import { WelcomeScreen} from './screens/WelcomeScreen.js';
import { UnifiedSession } from './screens/UnifiedSession.js';

type Screen = 'welcome' | 'session';

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [initialTask, setInitialTask] = useState<string | undefined>();

  const handleStart = (task: string) => {
    setInitialTask(task);
    setScreen('session');
  };

  const handleComplete = () => {
    setScreen('welcome');
    setInitialTask(undefined);
  };

  return (
    <Box>
      {screen === 'welcome' && (
        <WelcomeScreen onStart={handleStart} />
      )}

      {screen === 'session' && (
        <UnifiedSession 
          initialTask={initialTask}
          onComplete={handleComplete}
        />
      )}
    </Box>
  );
};