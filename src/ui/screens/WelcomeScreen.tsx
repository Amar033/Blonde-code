import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { execSync } from 'child_process';
import { theme } from '../theme.js';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import os from 'os';

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const CWD      = process.cwd().replace(os.homedir(), '~');

function getGitBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
}

function fmtDate(iso: string): string {
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface WelcomeScreenProps {
  onStart: (task: string) => void;
  onShowSessions: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart, onShowSessions }) => {
  const [task,      setTask]      = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [model,     setModel]     = useState(process.env.LLM_MODEL || 'qwen3.5:latest');
  const [recent,    setRecent]    = useState<Session[]>([]);
  const [gitBranch]               = useState<string | null>(getGitBranch);

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(sessions => setRecent(sessions.slice(0, 5)))
      .catch(() => {});
  }, []);

  const handleSubmit = () => {
    const v = task.trim();
    if (!v) return;
    setTask('');

    if (v === '/sessions' || v === 'sessions') { onShowSessions(); return; }

    if (v === '/model' || v === '/models') {
      import('../../planner/providers/ollama.js').then(async ({ OllamaProvider, findOllamaModelsDirs }: any) => {
        const p = new OllamaProvider(model, process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
        const [models, dirs] = await Promise.all([p.listModels(), findOllamaModelsDirs()]);
        const modelsDir = dirs[0]?.path ?? '~/.ollama/models';
        setStatusMsg([
          `current: ${model}`,
          models.length ? `available: ${models.join(', ')}` : 'no models found',
          `dir: ${modelsDir}`,
          '/model <name> to switch',
        ].join('  ·  '));
      }).catch(() => setStatusMsg(`current: ${model} (${PROVIDER})`));
      return;
    }

    if (v.startsWith('/model ')) {
      const m = v.slice(7).trim();
      if (m) {
        process.env.LLM_MODEL = m;
        setModel(m);
        setStatusMsg(`model set to ${m} — applies to next session`);
      }
      return;
    }

    onStart(v);
  };

  return (
    <Box flexDirection="column" paddingX={1}>

      {/* ── Brand header ───────────────────────────────────── */}
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Box gap={2}>
          <Text bold color={theme.brand}>◆ Blonde</Text>
          <Text color={theme.border.normal}>│</Text>
          <Text color={theme.text.dim}>{PROVIDER}</Text>
          <Text color={theme.text.dim}>·</Text>
          <Text color={theme.text.secondary}>{model}</Text>
        </Box>
        <Box gap={2} marginTop={0}>
          <Text color={theme.text.dim}>{CWD}</Text>
          {gitBranch && (
            <>
              <Text color={theme.text.dim}>on</Text>
              <Text color={theme.status.warning}>{gitBranch}</Text>
            </>
          )}
        </Box>
      </Box>

      <Box><Text color={theme.border.dim}>{'─'.repeat(64)}</Text></Box>

      {/* ── Recent sessions / empty state ──────────────────── */}
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        {recent.length === 0 ? (
          <Box flexDirection="column" paddingY={1}>
            <Text bold color={theme.text.primary}>No sessions yet</Text>
            <Text color={theme.text.dim}>Type a task below to get started.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text color={theme.text.dim}>Recent sessions</Text>
            <Box marginTop={1} flexDirection="column">
              {recent.map((s, i) => (
                <Box key={s.id} gap={2}>
                  <Text color={theme.text.dim}>{i + 1}</Text>
                  <Text color={theme.text.link}>{s.name.slice(0, 50)}</Text>
                  <Text color={theme.text.dim}>{fmtDate(s.updatedAt)}</Text>
                  <Text color={theme.text.dim}>{s.model}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      <Box><Text color={theme.border.dim}>{'─'.repeat(64)}</Text></Box>

      {/* ── Input ──────────────────────────────────────────── */}
      <Box marginTop={1} gap={1}>
        <Text bold color={theme.role.user}>❯</Text>
        <TextInput
          value={task}
          onChange={setTask}
          onSubmit={handleSubmit}
          placeholder="What would you like to build?"
        />
      </Box>

      {/* ── Hints / status ─────────────────────────────────── */}
      {statusMsg ? (
        <Box marginTop={1} gap={1} paddingX={2}>
          <Text color={theme.status.info}>!</Text>
          <Text color={theme.text.secondary}>{statusMsg}</Text>
        </Box>
      ) : (
        <Box marginTop={1} gap={2} paddingX={2}>
          <Text color={theme.text.dim}>/sessions</Text>
          <Text color={theme.text.dim}>·</Text>
          <Text color={theme.text.dim}>/model</Text>
          <Text color={theme.text.dim}>·</Text>
          <Text color={theme.text.dim}>Ctrl+K</Text>
        </Box>
      )}

    </Box>
  );
};
