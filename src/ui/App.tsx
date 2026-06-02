import React, { useState } from 'react';
import { Box } from 'ink';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { UnifiedSession } from './screens/UnifiedSession.js';
import { SessionsScreen } from './screens/SessionsScreen.js';
import type { Session } from '../sessions/session-manager.js';

type Screen = 'welcome' | 'session' | 'sessions-list';

export const App: React.FC = () => {
  const [screen,      setScreen]      = useState<Screen>('welcome');
  const [initialTask, setInitialTask] = useState<string | undefined>();
  const [resumeSession, setResumeSession] = useState<Session | undefined>();

  const handleStart = (task: string) => {
    setInitialTask(task);
    setResumeSession(undefined);
    setScreen('session');
  };

  const handleShowSessions = () => setScreen('sessions-list');

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
      {screen === 'welcome' && (
        <WelcomeScreen onStart={handleStart} onShowSessions={handleShowSessions} />
      )}

      {screen === 'sessions-list' && (
        <SessionsScreen
          onBack={() => setScreen('welcome')}
          onResume={handleResumeSession}
        />
      )}

      {screen === 'session' && (
        <UnifiedSession
          initialTask={initialTask}
          resumeSession={resumeSession}
          onComplete={handleComplete}
          onShowSessions={handleShowSessions}
        />
      )}
    </Box>
  );
};