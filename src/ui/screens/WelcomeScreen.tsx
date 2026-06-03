import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { execSync } from 'child_process';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { AppHeader } from '../components/AppHeader.js';
import { BrandMark } from '../components/BrandMark.js';

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';

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
    <Box flexDirection="column">

      {/* ── Shared header — same as session screen ───────────── */}
      <AppHeader model={model} provider={PROVIDER} branch={gitBranch} />

      {/* ── Body: brand left | content right ─────────────────── */}
      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor="#2a2a2a"
        paddingX={2}
        paddingY={1}
        gap={4}
      >

        {/* Left: brand mark (image or wordmark) */}
        <BrandMark width={22} />

        {/* Right: getting started + recent sessions */}
        <Box flexDirection="column" flexGrow={1} gap={2}>

          <Box flexDirection="column">
            <Text bold color="#e8e8e8">Welcome back</Text>
            <Text color="#aaaaaa">Ask me to read, search, or edit your codebase.</Text>
            <Text color="#555555">Be specific — like you would with a teammate.</Text>
          </Box>

          <Box flexDirection="column">
            <Text bold color="#aaaaaa">Recent sessions</Text>
            {recent.length === 0
              ? <Text color="#555555">no sessions yet</Text>
              : recent.map((s, i) => (
                <Box key={s.id} gap={2}>
                  <Text color="#4a9eff">{s.name.slice(0, 44)}</Text>
                  <Text color="#555555">{fmtDate(s.updatedAt)}</Text>
                  <Text color="#555555">{s.model}</Text>
                </Box>
              ))
            }
          </Box>

        </Box>
      </Box>

      {/* ── Status message ───────────────────────────────────── */}
      {statusMsg && (
        <Box marginTop={1} paddingX={1} gap={1}>
          <Text color="#4a9eff">!</Text>
          <Text color="#aaaaaa">{statusMsg}</Text>
        </Box>
      )}

      {/* ── Hints ────────────────────────────────────────────── */}
      <Box marginTop={1} paddingX={1} gap={2}>
        <Text color="#555555">/sessions</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/model</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">Ctrl+K for commands</Text>
      </Box>

      {/* ── Input ────────────────────────────────────────────── */}
      <Box marginTop={0} borderStyle="round" borderColor="#4a9eff" paddingX={2}>
        <Text color="#a78bfa">{'→ '}</Text>
        <TextInput
          value={task}
          onChange={setTask}
          onSubmit={handleSubmit}
          placeholder="What can I help you build today?"
        />
      </Box>

    </Box>
  );
};
