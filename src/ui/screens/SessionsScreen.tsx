import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { theme } from '../theme.js';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface SessionsScreenProps {
  onBack: () => void;
  onResume: (session: Session) => void;
}

export const SessionsScreen: React.FC<SessionsScreenProps> = ({ onBack, onResume }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cursor,   setCursor]   = useState(0);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(s => { setSessions(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q')    { onBack(); return; }
    if (key.upArrow || input === 'k')   setCursor(c => Math.max(0, c - 1));
    if (key.downArrow || input === 'j') setCursor(c => Math.min(sessions.length - 1, c + 1));
    if (key.return && sessions[cursor]) onResume(sessions[cursor]);
  });

  return (
    <Box flexDirection="column" padding={1}>

      <Box borderStyle="round" borderColor={theme.border.normal} paddingX={2} paddingY={0} marginBottom={1}>
        <Text bold color={theme.brand}>◆ Blonde</Text>
        <Text color={theme.text.dim}> ╱ </Text>
        <Text color={theme.text.secondary}>Sessions</Text>
        <Text color={theme.text.dim}>{' '.repeat(4)}↑↓ navigate   Enter resume   Esc back</Text>
      </Box>

      {loading && <Text color={theme.text.dim}>Loading…</Text>}

      {!loading && sessions.length === 0 && (
        <Text color={theme.text.dim}>No saved sessions yet.</Text>
      )}

      {sessions.map((s, i) => {
        const sel = i === cursor;
        const preview = s.messages.find(m => m.role === 'user')?.content ?? '';
        const msgCount = s.messages.filter(m => m.role === 'user').length;
        return (
          <Box key={s.id} flexDirection="column" paddingX={1} marginBottom={0}
            borderStyle={sel ? 'round' : undefined}
            borderColor={sel ? theme.border.active : undefined}>
            <Box gap={2}>
              <Text color={sel ? theme.role.user : theme.text.primary} bold={sel}>
                {s.name.slice(0, 40)}
              </Text>
              <Text color={theme.text.dim}>{s.model}</Text>
              <Text color={theme.text.dim}>{fmtDate(s.updatedAt)}</Text>
              <Text color={theme.text.dim}>{msgCount} msgs</Text>
            </Box>
            {sel && preview && (
              <Text color={theme.text.dim}>
                {'  '}{preview.slice(0, 72)}{preview.length > 72 ? '…' : ''}
              </Text>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color={theme.text.dim}>Esc or q to go back</Text>
      </Box>
    </Box>
  );
};
