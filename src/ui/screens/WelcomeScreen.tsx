import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { execSync } from 'child_process';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { AppHeader } from '../components/AppHeader.js';
import { BrandMark, LOGO_OPTIONS } from '../components/BrandMark.js';
import { providerRegistry } from '../../planner/provider-registry.js';
import { loadUiConfig, saveUiConfig } from '../../services/ui-config.js';

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
  columns:        number;
  rows:           number;
  onStart:        (task: string) => void;
  onShowSessions: () => void;
  onShowSettings: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  columns,
  rows,
  onStart,
  onShowSessions,
  onShowSettings,
}) => {
  const [task,           setTask]           = useState('');
  const [statusMsg,      setStatusMsg]      = useState('');
  const [model,          setModel]          = useState(process.env.LLM_MODEL || 'qwen3.5:latest');
  const [provider,       setProvider]       = useState(process.env.LLM_PROVIDER || 'ollama');
  const [recent,         setRecent]         = useState<Session[]>([]);
  const [gitBranch]                         = useState<string | null>(getGitBranch);
  const [logoIndex,      setLogoIndex]      = useState<number | undefined>(undefined);
  const [bannerOverride, setBannerOverride] = useState<string | undefined>(undefined);

  const bannerWidth = 32;

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(sessions => setRecent(sessions.slice(0, 5)))
      .catch(() => {});

    // Load persisted banner
    loadUiConfig().then(cfg => {
      if (cfg.banner) setBannerOverride(cfg.banner);
    }).catch(() => {});

    // Reflect active registry provider on mount
    providerRegistry.getActive().then(active => {
      if (active) {
        setProvider(`${active.type}:${active.name}`);
        setModel(active.model);
      }
    }).catch(() => {});
  }, []);

  const handleSubmit = () => {
    const v = task.trim();
    if (!v) return;
    setTask('');

    if (v === '/sessions' || v === 'sessions') { onShowSessions(); return; }
    if (v === '/settings' || v === 'settings') { onShowSettings(); return; }

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
      }).catch(() => setStatusMsg(`current: ${model} (${provider})`));
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

    if (v === '/logo' || v === '/logos') {
      const list = LOGO_OPTIONS.map(o => `/logo ${o.index} — ${o.label}`).join('  ·  ');
      setStatusMsg(`logos: ${list}`);
      return;
    }

    if (v.startsWith('/logo ')) {
      const n = parseInt(v.slice(6).trim(), 10);
      const opt = LOGO_OPTIONS.find(o => o.index === n);
      if (opt) {
        setLogoIndex(n);
        setBannerOverride(undefined);
        setStatusMsg(`logo set to ${n} (${opt.label})`);
      } else {
        setStatusMsg(`unknown logo — try /logo 1, /logo 2, or /logo 3`);
      }
      return;
    }

    if (v === '/banner') {
      setStatusMsg('usage: /banner <path>  (supports .png .jpg .gif — ~/... paths ok)  ·  /banner clear to reset');
      return;
    }

    if (v === '/banner clear' || v === '/banner reset') {
      setBannerOverride(undefined);
      setLogoIndex(undefined);
      saveUiConfig({ banner: undefined }).catch(() => {});
      setStatusMsg('banner reset to default');
      return;
    }

    if (v.startsWith('/banner ')) {
      const p = v.slice(8).trim();
      if (p) {
        import('fs').then(({ default: fs }) => {
          const resolved = p.replace(/^~/, process.env.HOME ?? '');
          if (fs.existsSync(resolved)) {
            setBannerOverride(resolved);
            setLogoIndex(undefined);
            saveUiConfig({ banner: resolved }).catch(() => {});
            setStatusMsg(`banner set to ${p} (saved)`);
          } else {
            setStatusMsg(`file not found: ${p}`);
          }
        });
      }
      return;
    }

    if (v === '/provider' || v === '/providers') {
      providerRegistry.list().then(providers => {
        if (providers.length === 0) {
          setStatusMsg('no providers registered — add one with: /provider add <name> <type> <apiKey|-> [model]');
        } else {
          const parts = providers.map(p =>
            `${p.isActive ? '✓ ' : ''}${p.name} (${p.type}) ${p.model}`
          );
          setStatusMsg(parts.join('  ·  ') + '  ·  /provider <name> to switch');
        }
      }).catch(() => setStatusMsg('could not load providers'));
      return;
    }

    if (v.startsWith('/provider ')) {
      const name = v.slice(10).trim();
      if (name) {
        providerRegistry.setActive(name).then(ok => {
          if (!ok) {
            setStatusMsg(`provider "${name}" not found — use /provider to list registered providers`);
          } else {
            providerRegistry.get(name).then(entry => {
              if (entry) {
                setProvider(`${entry.type}:${entry.name}`);
                setModel(entry.model);
                process.env.LLM_PROVIDER = entry.type;
                process.env.LLM_MODEL    = entry.model;
                setStatusMsg(`switched to provider "${name}" (${entry.type}) — applies to next session`);
              }
            }).catch(() => {});
          }
        }).catch(() => setStatusMsg('failed to switch provider'));
      }
      return;
    }

    onStart(v);
  };

  return (
    <Box flexDirection="column" width={columns} height={rows}>

      {/* ── Header ───────────────────────────────────────────── */}
      <AppHeader model={model} provider={provider} branch={gitBranch} />

      {/* ── Body: fills all remaining vertical space ─────────── */}
      <Box
        flexDirection="row"
        flexGrow={1}
        borderStyle="single"
        borderColor="#2a2a2a"
        overflow="hidden"
      >
        {/* Left: banner */}
        <BrandMark width={bannerWidth} logoIndex={logoIndex} bannerOverride={bannerOverride} />

        {/* Right: content */}
        <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1} gap={2}>

          <Box flexDirection="column">
            <Text bold color="#e8e8e8">Welcome back</Text>
            <Text color="#aaaaaa">Ask me to read, search, or edit your codebase.</Text>
            <Text color="#555555">Be specific — like you would with a teammate.</Text>
          </Box>

          <Box flexDirection="column">
            <Text bold color="#aaaaaa">Recent sessions</Text>
            {recent.length === 0
              ? <Text color="#555555">no sessions yet</Text>
              : recent.map((s) => (
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
        <Box paddingX={1} gap={1}>
          <Text color="#4a9eff">!</Text>
          <Text color="#aaaaaa">{statusMsg}</Text>
        </Box>
      )}

      {/* ── Hints ────────────────────────────────────────────── */}
      <Box paddingX={1} gap={2}>
        <Text color="#555555">/sessions</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/settings</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/model</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/provider</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/logo [1-3]</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">/banner &lt;path&gt;</Text>
        <Text color="#555555">·</Text>
        <Text color="#555555">Ctrl+K</Text>
      </Box>

      {/* ── Input ────────────────────────────────────────────── */}
      <Box borderStyle="round" borderColor="#4a9eff" paddingX={2}>
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
