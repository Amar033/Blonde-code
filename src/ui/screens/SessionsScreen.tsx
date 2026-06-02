import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { colors } from '../design-system.js';

interface SessionsScreenProps {
  onBack: () => void;
  onResume: (session: Session) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const SessionsScreen: React.FC<SessionsScreenProps> = ({ onBack, onResume }) => {
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [cursor,   setCursor]     = useState(0);
  const [loading,  setLoading]    = useState(true);

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(s => { setSessions(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') { onBack(); return; }
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(sessions.length - 1, c + 1));
    if (key.return && sessions[cursor]) onResume(sessions[cursor]);
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box gap={2} marginBottom={1}>
        <Text bold color={colors.brand}>Sessions</Text>
        <Text dimColor>↑↓ navigate · Enter resume · Esc back</Text>
      </Box>

      {loading && <Text dimColor>Loading sessions…</Text>}

      {!loading && sessions.length === 0 && (
        <Text dimColor>No saved sessions yet.</Text>
      )}

      {sessions.map((s, i) => {
        const selected = i === cursor;
        const preview  = s.messages.find(m => m.role === 'user')?.content ?? '';
        return (
          <Box
            key={s.id}
            flexDirection="column"
            marginBottom={0}
            paddingX={1}
            borderStyle={selected ? 'single' : undefined}
            borderColor={selected ? colors.brand : undefined}
          >
            <Box gap={2}>
              <Text color={selected ? colors.brand : colors.text} bold={selected}>
                {s.name}
              </Text>
              <Text dimColor>{s.model}</Text>
              <Text dimColor>{formatDate(s.updatedAt)}</Text>
              <Text dimColor>{s.messages.filter(m => m.role === 'user').length} msgs</Text>
            </Box>
            {selected && preview && (
              <Text dimColor>  {preview.slice(0, 80)}{preview.length > 80 ? '…' : ''}</Text>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>Press Esc or q to go back</Text>
      </Box>
    </Box>
  );
};
