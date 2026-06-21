import React, { useState, useEffect } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { theme } from '../theme.js';

function fmtDate(iso: string): string {
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 7)  return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function trunc(s: string, n: number): string {
  if (n <= 1) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

interface SessionsScreenProps {
  onBack:   () => void;
  onResume: (session: Session) => void;
}

export const SessionsScreen: React.FC<SessionsScreenProps> = ({ onBack, onResume }) => {
  const { width: cols, height: rows } = useTerminalDimensions();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cursor,   setCursor]   = useState(0);
  const [loading,  setLoading]  = useState(true);
  const renderer = useRenderer();

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(s => { setSessions(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c')              { renderer.destroy(); return; }
    if (key.name === 'escape' || key.sequence === 'q') { onBack(); return; }
    if (key.name === 'up'   || key.sequence === 'k')   setCursor(c => Math.max(0, c - 1));
    if (key.name === 'down' || key.sequence === 'j')   setCursor(c => Math.min(sessions.length - 1, c + 1));
    if (key.name === 'return' && sessions[cursor])     onResume(sessions[cursor]);
  });

  // ── Layout ────────────────────────────────────────────────────────────────────
  // Panel is 80% of terminal, min 60, max 110
  const panelW  = Math.min(110, Math.max(60, Math.floor(cols * 0.80)));
  const leftPad = Math.max(0, Math.floor((cols - panelW) / 2));
  const inner   = panelW - 2; // inside border

  // Column widths inside: │ SEL(2) NAME(flex) DATE(7) MODEL(20) │
  const selW   = 2;
  const dateW  = 7;
  const mdlW   = Math.min(22, Math.floor(inner * 0.24));
  const nameW  = inner - selW - 1 - dateW - 1 - mdlW - 2; // 2 side spaces

  // Scrolling: how many rows can we show
  const headerRows  = 4; // top border + title + col header + divider
  const previewRows = 2; // divider + preview line
  const footerRows  = 3; // bottom border + blank + hints
  const maxVisible  = Math.max(1, rows - headerRows - previewRows - footerRows);
  const scrollTop   = Math.max(0, cursor - maxVisible + 1);
  const visible     = sessions.slice(scrollTop, scrollTop + maxVisible);

  // ── Hand-drawn box lines ───────────────────────────────────────────────────────
  const hr      = '─'.repeat(inner);
  const hrMid   = '─'.repeat(inner);
  const title   = ' BLONDE  ·  SESSIONS ';
  const titlePad = Math.max(0, Math.floor((inner - title.length) / 2));
  const titleRow = ' '.repeat(titlePad) + title + ' '.repeat(Math.max(0, inner - titlePad - title.length));

  const colHdr = ' '
    + pad('session', nameW + selW + 1)
    + '  '
    + pad('when', dateW)
    + '  '
    + pad('model', mdlW)
    + ' ';

  // Selected session preview
  const sel        = sessions[cursor];
  const preview    = sel
    ? (sel.messages.find((m: any) => m.role === 'user')?.content ?? '').slice(0, inner - 4)
    : '';
  const msgCount   = sel ? sel.messages.filter((m: any) => m.role === 'user').length : 0;
  const previewStr = sel
    ? trunc(`"${preview}"  ·  ${msgCount} message${msgCount !== 1 ? 's' : ''}`, inner - 2)
    : '';

  // ── Rendering helpers ─────────────────────────────────────────────────────────
  type BoxLine = { text: string; color: string };

  const lines: BoxLine[] = [];
  const B  = (text: string, color = theme.border.normal)  => lines.push({ text, color });
  const BD = (text: string, color = theme.border.dim)     => lines.push({ text, color });

  BD('┌' + hr + '┐');
  B('│' + titleRow + '│', theme.brand);
  BD('├' + hrMid + '┤');
  BD('│' + colHdr + '│');
  BD('├' + hrMid + '┤');

  if (loading) {
    BD('│' + pad('  Loading…', inner) + '│');
  } else if (sessions.length === 0) {
    BD('│' + pad('  No saved sessions.', inner) + '│');
  } else {
    for (let vi = 0; vi < visible.length; vi++) {
      const s      = visible[vi]!;
      const absIdx = scrollTop + vi;
      const isSel  = absIdx === cursor;
      const selMark = isSel ? '▶ ' : '  ';
      const nameStr = trunc(s.name || '(untitled)', nameW);
      const dateStr = fmtDate(s.updatedAt);
      const mdlStr  = trunc(s.model || '—', mdlW);
      const row = ' '
        + selMark
        + pad(nameStr, nameW)
        + '  '
        + pad(dateStr, dateW)
        + '  '
        + pad(mdlStr, mdlW)
        + ' ';
      lines.push({
        text: '│' + row + '│',
        color: isSel ? theme.text.primary : theme.text.secondary,
      });
    }
  }

  BD('├' + hrMid + '┤');
  const pvRow = '  ' + pad(previewStr, inner - 2);
  BD('│' + pvRow + '│', theme.text.dim);
  BD('└' + hr + '┘');

  // Scroll indicator
  const scrollInfo = sessions.length > maxVisible
    ? `${cursor + 1} / ${sessions.length}`
    : `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  return (
    <box flexDirection="column" width={cols} height={rows}>

      <box flexGrow={1} />

      {/* ── NFO panel ── */}
      {lines.map((line, i) => (
        <box key={i} paddingLeft={leftPad}>
          <text fg={line.color}>{line.text}</text>
        </box>
      ))}

      {/* ── Scroll info + hints ── */}
      <box paddingLeft={leftPad + 2}>
        <text fg={theme.text.dim}>{scrollInfo}</text>
        <text fg={theme.border.dim}>{'   ·   '}</text>
        <text fg={theme.text.dim}>{'↑↓ / j·k  navigate    enter  resume    esc  back'}</text>
      </box>

      <box flexGrow={1} />

    </box>
  );
};
