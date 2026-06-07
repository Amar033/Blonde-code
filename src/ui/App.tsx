import React, { useState } from 'react';
import { Box } from 'ink';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { UnifiedSession } from './screens/UnifiedSession.js';
import { SessionsScreen } from './screens/SessionsScreen.js';
import { StartupScreen } from './screens/StartupScreen.js';
import type { Session } from '../sessions/session-manager.js';

type Screen = 'startup' | 'welcome' | 'session' | 'sessions-list';

interface AppProps {
  mockMode?: boolean;
}

export const App: React.FC<AppProps> = ({ mockMode }) => {
  const [screen,        setScreen]        = useState<Screen>(mockMode ? 'session' : 'startup');
  const [initialTask,   setInitialTask]   = useState<string | undefined>(
    mockMode ? 'Build a FastAPI backend with SQLite database' : undefined
  );
  const [resumeSession, setResumeSession] = useState<Session | undefined>();

  const handleStart = (task: string) => {
    setInitialTask(task);
    setResumeSession(undefined);
    setScreen('session');
  };

  const handleResumeSession = (session: Session) => {
    setResumeSession(session);
    setInitialTask(undefined);
    setScreen('session');
  };

  const handleComplete = () => {
    setScreen('welcome');
    setInitialTask(undefined);
    setResumeSession(undefined);
  };

  return (
    <Box>
      {screen === 'startup' && (
        <StartupScreen onDone={() => setScreen('welcome')} />
      )}
      {screen === 'welcome' && (
        <WelcomeScreen onStart={handleStart} onShowSessions={() => setScreen('sessions-list')} />
      )}
      {screen === 'sessions-list' && (
        <SessionsScreen onBack={() => setScreen('welcome')} onResume={handleResumeSession} />
      )}
      {screen === 'session' && (
        <UnifiedSession
          initialTask={initialTask}
          resumeSession={resumeSession}
          mockMode={mockMode}
          onComplete={handleComplete}
          onShowSessions={() => setScreen('sessions-list')}
        />
      )}
    </Box>
  );
};
