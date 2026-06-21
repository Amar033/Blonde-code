import React, { useState } from 'react';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { UnifiedSession } from './screens/UnifiedSession.js';
import { SessionsScreen } from './screens/SessionsScreen.js';
import { StartupScreen } from './screens/StartupScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { useTerminalDimensions } from '@opentui/react';
import type { Session } from '../sessions/session-manager.js';

type Screen = 'startup' | 'welcome' | 'session' | 'sessions-list' | 'settings';

interface AppProps {
  mockMode?: boolean;
  workspacePath: string;
}

export const App: React.FC<AppProps> = ({ mockMode, workspacePath }) => {
  const [screen,        setScreen]        = useState<Screen>(mockMode ? 'session' : 'startup');
  const [initialTask,   setInitialTask]   = useState<string | undefined>(
    mockMode ? 'Build a FastAPI backend with SQLite database' : undefined
  );
  const [resumeSession, setResumeSession] = useState<Session | undefined>();
  const { width: columns, height: rows } = useTerminalDimensions();

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
    <box width={columns} height={rows} flexDirection="column">
      {screen === 'startup' && (
        <StartupScreen onDone={() => setScreen('welcome')} />
      )}
      {screen === 'welcome' && (
        <WelcomeScreen
          columns={columns}
          rows={rows}
          onStart={handleStart}
          onShowSessions={() => setScreen('sessions-list')}
          onShowSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'sessions-list' && (
        <SessionsScreen onBack={() => setScreen('welcome')} onResume={handleResumeSession} />
      )}
      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen('welcome')} />
      )}
      {screen === 'session' && (
        <UnifiedSession
          initialTask={initialTask}
          resumeSession={resumeSession}
          mockMode={mockMode}
          workspacePath={workspacePath}
          onComplete={handleComplete}
          onShowSessions={() => setScreen('sessions-list')}
        />
      )}
    </box>
  );
};
