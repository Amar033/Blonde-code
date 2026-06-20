import React, { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { theme } from '../theme.js';

const COMMANDS = [
  { name: '/clear',         desc: 'Clear conversation history' },
  { name: '/new',           desc: 'Start a fresh session' },
  { name: '/sessions',      desc: 'Browse previous sessions' },
  { name: '/model',         desc: 'List or switch models' },
  { name: '/provider',      desc: 'List / add / switch LLM providers' },
  { name: '/provider help', desc: 'Show provider command reference' },
  { name: '/theme',         desc: 'Switch theme (dark/light/dark-ansi)' },
  { name: 'stop',           desc: 'Interrupt the running agent' },
  { name: '?',              desc: 'Toggle help panel' },
];

interface CommandPaletteProps {
  onSelect: (command: string) => void;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ onSelect, onClose }) => {
  const [query,  setQuery]  = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = COMMANDS.filter(c =>
    !query || c.name.includes(query) || c.desc.toLowerCase().includes(query.toLowerCase())
  );
  const clamp = Math.max(0, Math.min(cursor, filtered.length - 1));

  useKeyboard((key) => {
    if (key.name === 'escape')  { onClose(); return; }
    if (key.name === 'up')      { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.name === 'down')    { setCursor(c => Math.min(filtered.length - 1, c + 1)); return; }
    if (key.name === 'return')  {
      const cmd = filtered[clamp];
      if (cmd) { onSelect(cmd.name); }
      onClose();
    }
  });

  return (
    <box flexDirection="column" borderStyle="rounded" borderColor={theme.border.active} marginTop={1}>
      <box paddingLeft={1} paddingRight={1} gap={1}>
        <text fg={theme.text.dim}>{'>'}</text>
        <input
          value={query}
          onInput={(v: string) => { setQuery(v); setCursor(0); }}
          onSubmit={() => {
            const cmd = filtered[clamp];
            if (cmd) onSelect(cmd.name);
            onClose();
          }}
          placeholder="search commands…"
          width={40}
          textColor={theme.text.primary}
          cursorColor={theme.text.link}
        />
      </box>
      <box paddingLeft={1} paddingRight={1}>
        <text fg={theme.border.subtle}>{'─'.repeat(28)}</text>
      </box>
      {filtered.length === 0 ? (
        <box paddingLeft={1} paddingBottom={1}>
          <text fg={theme.text.dim}>no commands match</text>
        </box>
      ) : (
        filtered.map((cmd, i) => {
          const sel = i === clamp;
          return (
            <box key={cmd.name} paddingLeft={1} paddingRight={1} gap={2}>
              <text fg={sel ? theme.role.user : theme.text.link}>
                {sel ? <strong>{cmd.name}</strong> : cmd.name}
              </text>
              <text fg={theme.text.dim}>{cmd.desc}</text>
            </box>
          );
        })
      )}
    </box>
  );
};
