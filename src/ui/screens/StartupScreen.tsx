import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { execSync } from 'child_process';
import { ensureSearXNG } from '../../services/searxng-manager.js';
import { AppHeader } from '../components/AppHeader.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { theme } from '../theme.js';

// ── Grid animation ──────────────────────────────────────────────────────────

const GRID_COLS = 8;
const GRID_ROWS = 6;
const SHADES = ['░', '▒', '▓'];

function gridRow(tick: number, row: number, done: boolean): string {
  if (done) return (SHADES[2] + ' ').repeat(GRID_COLS).trim();
  let s = '';
  for (let col = 0; col < GRID_COLS; col++) {
    const phase = (col * 3 + row * 2 + tick) % 9;
    s += SHADES[Math.floor(phase / 3)];
    s += col < GRID_COLS - 1 ? ' ' : '';
  }
  return s;
}

// Row color cycles top-to-bottom, shifting with tick
const ROW_COLORS = [
  theme.text.dim,
  theme.text.dim,
  theme.text.secondary,
  theme.brand,
  theme.text.secondary,
  theme.text.dim,
];

// ── Log line ────────────────────────────────────────────────────────────────

interface LogLine {
  text: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getGitBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface StartupScreenProps {
  onDone: () => void;
}

export const StartupScreen: React.FC<StartupScreenProps> = ({ onDone }) => {
  const [tick,    setTick]    = useState(0);
  const [logs,    setLogs]    = useState<LogLine[]>([]);
  const [done,    setDone]    = useState(false);
  const [branch]              = useState<string | null>(getGitBranch);
  const model    = process.env.LLM_MODEL    || 'qwen3.5:latest';
  const provider = process.env.LLM_PROVIDER || 'ollama';

  // Animation tick
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 120);
    return () => clearInterval(id);
  }, []);

  // Run init
  useEffect(() => {
    const addLog = (text: string, level: LogLine['level'] = 'info') =>
      setLogs(prev => [...prev, { text, level }]);

    ensureSearXNG(addLog)
      .then(result => {
        if (!result.ok) {
          // Final fallback line only if no error was already logged
          setLogs(prev => {
            const lastIsError = prev.length > 0 && (prev[prev.length - 1].level === 'error' || prev[prev.length - 1].level === 'warn');
            if (lastIsError) return [...prev, { text: 'Falling back to DuckDuckGo', level: 'info' }];
            return prev;
          });
        }
        setDone(true);
        setTimeout(onDone, 900);
      })
      .catch(() => {
        addLog('Search init failed — using DuckDuckGo', 'warn');
        setDone(true);
        setTimeout(onDone, 900);
      });
  }, []);

  const gridRows = Array.from({ length: GRID_ROWS }, (_, r) => gridRow(tick, r, done));
  const rowColors = done
    ? Array(GRID_ROWS).fill(theme.status.success)
    : ROW_COLORS.map((_, i) => ROW_COLORS[(i + GRID_ROWS - (tick % GRID_ROWS)) % GRID_ROWS]);

  return (
    <Box flexDirection="column">
      <AppHeader model={model} provider={provider} branch={branch} />

      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor={theme.border.dim}
        paddingX={2}
        paddingY={1}
        gap={4}
      >
        {/* ── Left: animated grid ─────────────────────────────── */}
        <Box flexDirection="column" width={22} gap={1}>
          <Box flexDirection="column">
            <Text bold color={theme.brand}>◆ Blonde</Text>
            <Text color={theme.text.dim}>AI Coding Agent</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {gridRows.map((row, i) => (
              <Text key={i} color={rowColors[i]}>{row}</Text>
            ))}
          </Box>

          <Box marginTop={1}>
            {done
              ? <Text color={theme.status.success}>✓ Ready</Text>
              : <Box gap={1}><BrailleSpinner color={theme.brand} /><Text color={theme.text.dim}>Starting</Text></Box>
            }
          </Box>
        </Box>

        {/* ── Right: log panel ────────────────────────────────── */}
        <Box flexDirection="column" flexGrow={1}>

          {/* Header */}
          <Box gap={2} marginBottom={1}>
            <Text bold color={theme.text.secondary}>
              {done ? '✓ Initialization complete' : 'Initializing'}
            </Text>
            {!done && <BrailleSpinner color={theme.text.dim} />}
          </Box>

          <Text color={theme.border.dim}>{'─'.repeat(48)}</Text>

          {/* Log lines */}
          <Box flexDirection="column" marginTop={1} gap={0}>
            {logs.length === 0
              ? <Text color={theme.text.dim}>Starting up...</Text>
              : logs.map((line, i) => {
                  const isActive = i === logs.length - 1 && !done;
                  const icon =
                    line.level === 'ok'    ? '✓' :
                    line.level === 'warn'  ? '⚠' :
                    line.level === 'error' ? '✗' : '·';
                  const iconColor =
                    line.level === 'ok'    ? theme.status.success :
                    line.level === 'warn'  ? theme.status.warning :
                    line.level === 'error' ? theme.status.error :
                    theme.text.dim;
                  const textColor = isActive ? theme.text.secondary : theme.text.dim;

                  return (
                    <Box key={i} gap={1}>
                      {isActive
                        ? <BrailleSpinner color={theme.brand} />
                        : <Text color={iconColor}>{icon}</Text>
                      }
                      <Text color={textColor}>{line.text}</Text>
                    </Box>
                  );
                })
            }
          </Box>

          {/* Done footer */}
          {done && (
            <Box marginTop={1} gap={1}>
              <Text color={theme.status.success}>◆</Text>
              <Text color={theme.text.secondary}>Launching Blonde...</Text>
            </Box>
          )}

        </Box>
      </Box>

      {/* Bottom hint */}
      <Box paddingX={1} marginTop={0}>
        <Text color={theme.text.dim}>Setting up your workspace</Text>
      </Box>
    </Box>
  );
};
