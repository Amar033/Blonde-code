import React, { useState, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { theme } from '../theme.js';

function fmtDate(iso: string): string {
  const d    = new Date(iso);
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

  useKeyboard((key) => {
    if (key.name === 'escape' || key.sequence === 'q') { onBack(); return; }
    if (key.name === 'up'   || key.sequence === 'k')  setCursor(c => Math.max(0, c - 1));
    if (key.name === 'down' || key.sequence === 'j')  setCursor(c => Math.min(sessions.length - 1, c + 1));
    if (key.name === 'return' && sessions[cursor])    onResume(sessions[cursor]);
  });

  return (
    <box flexDirection="column" padding={1}>

      <box borderStyle="single" borderColor={theme.border.normal} paddingLeft={2} paddingRight={2} marginBottom={1}>
        <text fg={theme.brand}><strong>◆ Blonde</strong></text>
        <text fg={theme.text.dim}> ╱ </text>
        <text fg={theme.text.secondary}>Sessions</text>
        <text fg={theme.text.dim}>{'    '}↑↓ navigate   Enter resume   Esc back</text>
      </box>

      {loading && <text fg={theme.text.dim}>Loading…</text>}

      {!loading && sessions.length === 0 && (
        <text fg={theme.text.dim}>No saved sessions yet.</text>
      )}

      {sessions.map((s, i) => {
        const sel      = i === cursor;
        const preview  = s.messages.find((m: any) => m.role === 'user')?.content ?? '';
        const msgCount = s.messages.filter((m: any) => m.role === 'user').length;
        const tokens   = (s as any).tokenUsage ? ` · ${((s as any).tokenUsage / 1000).toFixed(1)}k tokens` : '';

        return (
          <box
            key={s.id}
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            borderStyle={sel ? 'single' : undefined}
            borderColor={sel ? theme.border.active : undefined}
          >
            <box gap={2}>
              <text fg={sel ? theme.role.user : theme.text.primary}>
                {sel ? <strong>{s.name.slice(0, 50)}</strong> : s.name.slice(0, 50)}
              </text>
              <text fg={theme.text.dim}>{fmtDate(s.updatedAt)}</text>
              <text fg={theme.text.dim}>{msgCount} msg{msgCount !== 1 ? 's' : ''}{tokens}</text>
            </box>
            {sel && preview && (
              <text fg={theme.text.dim}>  {preview.slice(0, 80)}{preview.length > 80 ? '…' : ''}</text>
            )}
          </box>
        );
      })}
    </box>
  );
};
