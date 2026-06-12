import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
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
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = COMMANDS.filter(c =>
    !query || c.name.includes(query) || c.desc.toLowerCase().includes(query.toLowerCase())
  );
  const clamp = Math.max(0, Math.min(cursor, filtered.length - 1));

  useInput((char, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow)   { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor(c => Math.min(filtered.length - 1, c + 1)); return; }
    if (key.return) {
      const cmd = filtered[clamp];
      if (cmd) { onSelect(cmd.name); }
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border.active} marginTop={1}>
      <Box paddingX={1} gap={1}>
        <Text color={theme.text.dim}>{'>'}</Text>
        <TextInput
          value={query}
          onChange={v => { setQuery(v); setCursor(0); }}
          onSubmit={() => {
            const cmd = filtered[clamp];
            if (cmd) onSelect(cmd.name);
            onClose();
          }}
          placeholder="search commands…"
          focus
        />
      </Box>
      <Box paddingX={1}>
        <Text color={theme.border.subtle}>{'─'.repeat(28)}</Text>
      </Box>
      {filtered.length === 0 ? (
        <Box paddingX={1} paddingBottom={1}>
          <Text color={theme.text.dim}>no commands match</Text>
        </Box>
      ) : (
        filtered.map((cmd, i) => {
          const sel = i === clamp;
          return (
            <Box key={cmd.name} paddingX={1} gap={2}>
              <Text color={sel ? theme.role.user : theme.text.link} bold={sel}>{cmd.name}</Text>
              <Text color={theme.text.dim}>{cmd.desc}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
};
