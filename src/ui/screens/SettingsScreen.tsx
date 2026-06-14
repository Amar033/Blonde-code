import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { detectBackends, checkSystemCapabilities } from '../../services/backend-detector.js';
import type { BackendInfo, BackendType, SystemCapabilities } from '../../services/backend-detector.js';
import {
  buildInstallAction, buildStartAction, buildStopStep, supportsDocker, isDesktopApp,
  type InstallMethod, type BackendAction,
} from '../../services/backend-installer.js';
import {
  FLAG_DEFS, loadConfig, saveConfig, buildSwitchShellCmd,
  type BackendConfig,
} from '../../services/backend-config-store.js';
import {
  CATALOG, getDownloadOptions,
  type CatalogModel, type DownloadOption,
} from '../../services/model-catalog.js';
import { ProcessStream } from '../components/ProcessStream.js';
import { providerRegistry } from '../../planner/provider-registry.js';
import type { ProviderEntry, ProviderType } from '../../planner/provider-registry.js';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

// ─────────────────────────────────────────────────────────────────
// Cloud provider definitions
// ─────────────────────────────────────────────────────────────────
type CloudProviderType = 'anthropic' | 'openai' | 'openrouter';

interface CloudProviderDef {
  type:         CloudProviderType;
  providerType: ProviderType;
  label:        string;
  desc:         string;
  keyHint:      string;
  keyEnvVar:    string;
  models:       string[];
}

const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    type: 'anthropic', providerType: 'anthropic',
    label: 'Anthropic',
    desc:  'Claude models — best reasoning & coding. Streaming built-in.',
    keyHint: 'sk-ant-api03-...', keyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    ],
  },
  {
    type: 'openai', providerType: 'openai',
    label: 'OpenAI',
    desc:  'GPT-4o, o1, o3-mini. OpenAI-compatible API.',
    keyHint: 'sk-proj-...', keyEnvVar: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1', 'o1-mini', 'gpt-4-turbo'],
  },
  {
    type: 'openrouter', providerType: 'openrouter',
    label: 'OpenRouter',
    desc:  '100+ models via one API. Free tier. Best for model hopping.',
    keyHint: 'sk-or-v1-...', keyEnvVar: 'OPENROUTER_API_KEY',
    models: [
      'anthropic/claude-opus-4',
      'anthropic/claude-sonnet-4',
      'openai/gpt-4o',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-chat',
      'qwen/qwen3-235b-a22b',
      'arcee-ai/trinity-large-preview:free',
      'mistralai/mistral-large',
    ],
  },
];

const maskKey = (k: string) =>
  k.length <= 10 ? '****' : `${k.slice(0, 7)}****${k.slice(-4)}`;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
type Tab = 'backends' | 'providers' | 'models' | 'cookbooks';

type Mode =
  | { kind: 'browse' }
  | { kind: 'method-select';          backend: BackendInfo; intent: 'install' | 'start' }
  | { kind: 'model-input';            backend: BackendInfo; method: InstallMethod }
  | { kind: 'switch-model';           backend: BackendInfo }
  | { kind: 'lmstudio-model-select';  backend: BackendInfo }
  | { kind: 'configure';              backend: BackendInfo }
  | { kind: 'download-model' }
  | { kind: 'api-key-input';          cloudType: CloudProviderType; editMode: boolean }
  | { kind: 'cloud-model-select';     cloudType: CloudProviderType; apiKey: string }
  | { kind: 'permission';             action: BackendAction; backend: BackendInfo }
  | { kind: 'running';                action: BackendAction; backend: BackendInfo }
  | { kind: 'result';                 success: boolean; message: string };

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const DESCRIPTIONS: Record<BackendType, string> = {
  ollama:   'Easy local model runner. Zero-friction, single-user development.',
  vllm:     'High-throughput GPU serving with PagedAttention. Production-grade.',
  llamacpp: 'Max control: speculative decoding, Flash Attn, CPU+GPU hybrid.',
  sglang:   '3.1× faster than vLLM on DeepSeek. Best TTFT for multi-turn chat.',
  lmstudio: 'Desktop GUI. Runs an OpenAI-compatible server on :1234 when active.',
  airllm:   'Layer-by-layer GPU loading. Run 70B models on 4 GB VRAM. Apache 2.0.',
};

const PORTS: Record<BackendType, number> = {
  ollama: 11434, vllm: 8000, llamacpp: 8080, sglang: 30000, lmstudio: 1234, airllm: 8002,
};

const MODEL_PLACEHOLDER: Record<BackendType, string> = {
  ollama:   '',
  vllm:     'e.g. meta-llama/Llama-3.1-8B-Instruct',
  llamacpp: 'e.g. /home/user/.blonde/models/qwen3-8b-q4_k_m.gguf',
  sglang:   'e.g. meta-llama/Llama-3.1-8B-Instruct',
  lmstudio: '',
  airllm:   'e.g. meta-llama/Llama-3.1-8B-Instruct or local path',
};

const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e', installed: '#f59e0b', 'not-installed': '#555555',
};
const STATUS_LABEL: Record<string, string> = {
  running: '● running', installed: '○ installed', 'not-installed': '○ not installed',
};

// ─────────────────────────────────────────────────────────────────
// Main SettingsScreen
// ─────────────────────────────────────────────────────────────────
interface Props { onBack: () => void; }

export const SettingsScreen: React.FC<Props> = ({ onBack }) => {
  const [tab,            setTab]            = useState<Tab>('backends');
  const [backends,       setBackends]       = useState<BackendInfo[]>([]);
  const [caps,           setCaps]           = useState<SystemCapabilities>({ hasCuda: false, hasDocker: false, hasNvidiaContainerToolkit: false });
  const [loading,        setLoading]        = useState(true);
  const [selected,       setSelected]       = useState(0);
  const [providerSelected, setProviderSelected] = useState(0);
  const [providerEntries,  setProviderEntries]  = useState<Array<ProviderEntry & { isActive: boolean }>>([]);
  const [mode,           setMode]           = useState<Mode>({ kind: 'browse' });

  const refreshBackends   = () => detectBackends().then(setBackends).catch(() => {});
  const refreshProviders  = () => providerRegistry.list().then(setProviderEntries).catch(() => {});

  useEffect(() => {
    Promise.all([detectBackends(), checkSystemCapabilities()])
      .then(([b, c]) => { setBackends(b); setCaps(c); setLoading(false); })
      .catch(() => setLoading(false));
    refreshProviders();
  }, []);

  // ── Backend action dispatcher ────────────────────────────────────
  const dispatchBackend = (b: BackendInfo) => {
    if (b.status === 'not-installed') {
      if (isDesktopApp(b.type)) return;
      if (supportsDocker(b.type)) setMode({ kind: 'method-select', backend: b, intent: 'install' });
      else setMode({ kind: 'permission', action: buildInstallAction(b.type, 'native', caps), backend: b });
    } else if (b.status === 'installed') {
      if (b.type === 'ollama') {
        setMode({ kind: 'permission', action: buildStartAction(b.type, 'native', caps, ''), backend: b });
      } else if (supportsDocker(b.type)) {
        setMode({ kind: 'method-select', backend: b, intent: 'start' });
      } else {
        setMode({ kind: 'model-input', backend: b, method: 'native' });
      }
    } else {
      if (b.type === 'lmstudio') {
        setMode({ kind: 'lmstudio-model-select', backend: b });
        return;
      }
      const step = buildStopStep(b.type, b.runningInDocker);
      const action: BackendAction = { title: `Stop ${b.label}`, method: 'native', requirements: [], steps: [step], modelRequired: false };
      setMode({ kind: 'permission', action, backend: b });
    }
  };

  // ── Cloud provider dispatcher ─────────────────────────────────────
  const dispatchProvider = (cpd: CloudProviderDef) => {
    const existing = providerEntries.find(e => e.type === cpd.providerType);
    if (!existing) {
      setMode({ kind: 'api-key-input', cloudType: cpd.type, editMode: false });
    } else if (existing.isActive) {
      providerRegistry.clearActive().then(refreshProviders).catch(() => {});
    } else {
      providerRegistry.setActive(existing.name).then(refreshProviders).catch(() => {});
    }
  };

  // ─── Mode rendering ─────────────────────────────────────────────
  if (mode.kind === 'method-select') {
    return (
      <MethodSelectView
        backend={mode.backend} intent={mode.intent}
        onSelect={(method) => {
          const { backend, intent } = mode;
          if (intent === 'install') {
            setMode({ kind: 'permission', action: buildInstallAction(backend.type, method, caps), backend });
          } else if (backend.type === 'ollama') {
            setMode({ kind: 'permission', action: buildStartAction(backend.type, method, caps, ''), backend });
          } else {
            setMode({ kind: 'model-input', backend, method });
          }
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'model-input') {
    return (
      <ModelInputView
        backend={mode.backend} method={mode.method}
        onSubmit={(model) => setMode({ kind: 'permission', action: buildStartAction(mode.backend.type, mode.method, caps, model), backend: mode.backend })}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'switch-model') {
    return (
      <SwitchModelView
        backend={mode.backend} caps={caps}
        onConfirm={(model, method, flags) => {
          const cmd = buildSwitchShellCmd(mode.backend.type, method, model, flags, caps.hasCuda);
          const action: BackendAction = {
            title: `Switch ${mode.backend.label} → ${model}`, method,
            requirements: [],
            steps: [{ label: 'Stop current + start with new model', command: 'sh', args: ['-c', cmd] }],
            modelRequired: true,
          };
          setMode({ kind: 'permission', action, backend: mode.backend });
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'configure') {
    return (
      <ConfigureView
        backend={mode.backend} caps={caps}
        onApply={async (model, method, flags) => {
          await saveConfig(mode.backend.type, { model, method, flags });
          const cmd = buildSwitchShellCmd(mode.backend.type, method, model, flags, caps.hasCuda);
          const action: BackendAction = {
            title: `Reconfigure ${mode.backend.label}`, method, requirements: [],
            steps: [{ label: 'Apply new config (stop + restart)', command: 'sh', args: ['-c', cmd] }],
            modelRequired: false,
          };
          setMode({ kind: 'permission', action, backend: mode.backend });
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'download-model') {
    return (
      <CatalogView
        caps={caps}
        onDownload={(option) => {
          const dummy: BackendInfo = { type: option.backends[0] ?? 'ollama', label: 'Download', port: 0, status: 'not-installed', models: [], runningInDocker: false };
          const action: BackendAction = { title: `Download ${option.label}`, method: 'native', requirements: [], steps: [{ label: option.label, command: option.command, args: option.args }], modelRequired: false };
          setMode({ kind: 'permission', action, backend: dummy });
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'api-key-input') {
    const cpd = CLOUD_PROVIDERS.find(p => p.type === mode.cloudType)!;
    const existing = providerEntries.find(e => e.type === cpd.providerType);
    return (
      <ApiKeyInputView
        providerDef={cpd}
        editMode={mode.editMode}
        onSubmit={(apiKey) => setMode({ kind: 'cloud-model-select', cloudType: mode.cloudType, apiKey })}
        onCancel={() => setMode({ kind: 'browse' })}
        currentKey={existing?.apiKey}
      />
    );
  }

  if (mode.kind === 'cloud-model-select') {
    const cpd = CLOUD_PROVIDERS.find(p => p.type === mode.cloudType)!;
    const existing = providerEntries.find(e => e.type === cpd.providerType);
    return (
      <CloudModelSelectView
        providerDef={cpd}
        apiKey={mode.apiKey}
        currentModel={existing?.model}
        onSelect={async (model) => {
          await providerRegistry.add({ name: cpd.type, type: cpd.providerType, apiKey: mode.apiKey, model });
          await providerRegistry.setActive(cpd.type);
          refreshProviders();
          setMode({ kind: 'result', success: true, message: `${cpd.label} configured — model "${model}" set as active provider.` });
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'permission') {
    return (
      <PermissionView
        action={mode.action}
        onConfirm={() => setMode({ kind: 'running', action: mode.action, backend: mode.backend })}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'running') {
    const step   = mode.action.steps[0];
    const isStop = mode.action.title.startsWith('Stop');
    const isDl   = mode.action.title.startsWith('Download');
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="#a78bfa">{mode.action.title}</Text>
        <Text color="#555555" dimColor>Running — please wait</Text>
        {step && (
          <ProcessStream
            command={step.command} args={step.args}
            onDone={(code) => {
              refreshBackends();
              if (code === 0 && !isStop && !isDl) {
                providerRegistry.add({
                  name: mode.backend.type, type: mode.backend.type === 'ollama' ? 'ollama' : 'openai-compatible',
                  model: mode.backend.type === 'ollama' ? (process.env.LLM_MODEL ?? 'llama3:latest') : 'default',
                  baseURL: mode.backend.type !== 'ollama' ? `http://localhost:${PORTS[mode.backend.type]}/v1` : undefined,
                }).catch(() => {});
              }
              const msg = isDl
                ? code === 0 ? 'Download complete.' : 'Download failed — see output above.'
                : code === 0
                  ? isStop ? `${mode.backend.label} stopped.` : `${mode.backend.label} ready — registered as provider "${mode.backend.type}".`
                  : `Command failed (exit ${code}) — see output above.`;
              setMode({ kind: 'result', success: code === 0, message: msg });
            }}
          />
        )}
      </Box>
    );
  }

  if (mode.kind === 'lmstudio-model-select') {
    return (
      <LmStudioModelSelectView
        backend={mode.backend}
        onSelect={async (model) => {
          await providerRegistry.add({ name: 'lmstudio', type: 'openai-compatible', model, baseURL: 'http://localhost:1234/v1' });
          await providerRegistry.setActive('lmstudio');
          refreshProviders();
          setMode({ kind: 'result', success: true, message: `LM Studio configured — model "${model}" set as active provider.` });
        }}
        onCancel={() => setMode({ kind: 'browse' })}
      />
    );
  }

  if (mode.kind === 'result') {
    return (
      <ResultView
        success={mode.success} message={mode.message}
        onDone={() => { setMode({ kind: 'browse' }); refreshBackends(); refreshProviders(); }}
      />
    );
  }

  // ── Browse ────────────────────────────────────────────────────────
  const TABS: Tab[] = ['backends', 'providers', 'models', 'cookbooks'];

  return (
    <BrowseView
      tab={tab} tabs={TABS} backends={backends} loading={loading}
      selected={selected} providerSelected={providerSelected}
      caps={caps} providerEntries={providerEntries}
      onTabChange={setTab}
      onSelectChange={setSelected}
      onProviderSelectChange={setProviderSelected}
      onBack={onBack}
      onRefresh={refreshBackends}
      onBackendAction={dispatchBackend}
      onProviderAction={dispatchProvider}
      onProviderEditKey={(cpd) => setMode({ kind: 'api-key-input', cloudType: cpd.type, editMode: true })}
      onProviderChangeModel={(cpd) => {
        const existing = providerEntries.find(e => e.type === cpd.providerType);
        if (existing?.apiKey) setMode({ kind: 'cloud-model-select', cloudType: cpd.type, apiKey: existing.apiKey });
        else setMode({ kind: 'api-key-input', cloudType: cpd.type, editMode: false });
      }}
      onProviderRemove={async (cpd) => {
        await providerRegistry.remove(cpd.type).catch(() => {});
        refreshProviders();
      }}
      onSwitchModel={(b) => b.type === 'lmstudio'
        ? setMode({ kind: 'lmstudio-model-select', backend: b })
        : setMode({ kind: 'switch-model', backend: b })
      }
      onConfigure={(b)      => setMode({ kind: 'configure',     backend: b })}
      onBrowseCatalog={() => setMode({ kind: 'download-model' })}
    />
  );
};

// ─────────────────────────────────────────────────────────────────
// BrowseView
// ─────────────────────────────────────────────────────────────────
interface BrowseViewProps {
  tab: Tab; tabs: Tab[]; backends: BackendInfo[];
  loading: boolean; selected: number; providerSelected: number;
  caps: SystemCapabilities; providerEntries: Array<ProviderEntry & { isActive: boolean }>;
  onTabChange:            (t: Tab) => void;
  onSelectChange:         (i: number) => void;
  onProviderSelectChange: (i: number) => void;
  onBack:                 () => void;
  onRefresh:              () => void;
  onBackendAction:        (b: BackendInfo) => void;
  onProviderAction:       (cpd: CloudProviderDef) => void;
  onProviderEditKey:      (cpd: CloudProviderDef) => void;
  onProviderChangeModel:  (cpd: CloudProviderDef) => void;
  onProviderRemove:       (cpd: CloudProviderDef) => Promise<void>;
  onSwitchModel:          (b: BackendInfo) => void;
  onConfigure:            (b: BackendInfo) => void;
  onBrowseCatalog:        () => void;
}

const BrowseView: React.FC<BrowseViewProps> = (p) => {
  const {
    tab, tabs, backends, loading, selected, providerSelected, caps, providerEntries,
    onTabChange, onSelectChange, onProviderSelectChange, onBack, onRefresh,
    onBackendAction, onProviderAction, onProviderEditKey, onProviderChangeModel,
    onProviderRemove, onSwitchModel, onConfigure, onBrowseCatalog,
  } = p;

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.tab)    { onTabChange(tabs[(tabs.indexOf(tab) + 1) % tabs.length]); return; }

    if (tab === 'backends' && !loading) {
      if (key.upArrow)   onSelectChange(Math.max(0, selected - 1));
      if (key.downArrow) onSelectChange(Math.min(backends.length - 1, selected + 1));
      if (key.return)    { const b = backends[selected]; if (b) onBackendAction(b); }
      if (input === 'r' || input === 'R') onRefresh();
      const sel = backends[selected];
      if (sel?.status === 'running') {
        if (input === 's' || input === 'S') onSwitchModel(sel);
        if ((input === 'c' || input === 'C') && sel.type !== 'ollama' && sel.type !== 'lmstudio') onConfigure(sel);
      }
    }

    if (tab === 'providers') {
      if (key.upArrow)   onProviderSelectChange(Math.max(0, providerSelected - 1));
      if (key.downArrow) onProviderSelectChange(Math.min(CLOUD_PROVIDERS.length - 1, providerSelected + 1));
      const cpd = CLOUD_PROVIDERS[providerSelected];
      if (!cpd) return;
      if (key.return)               onProviderAction(cpd);
      if (input === 'k' || input === 'K') onProviderEditKey(cpd);
      if (input === 'm' || input === 'M') onProviderChangeModel(cpd);
      if (input === 'x' || input === 'X') onProviderRemove(cpd).catch(() => {});
    }

    if (tab === 'models') {
      if (key.return || input === 'd' || input === 'D') onBrowseCatalog();
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={3} paddingX={2} paddingY={1} borderStyle="single" borderColor="#2a2a2a">
        <Text color="#a78bfa" bold>settings</Text>
        <Text color="#333333">·</Text>
        {tabs.map(t => (
          <Text key={t} color={tab === t ? '#e8e8e8' : '#555555'} bold={tab === t}>
            {tab === t ? `[${t}]` : t}
          </Text>
        ))}
        <Box flexGrow={1} />
        <Text color="#333333" dimColor>Tab · Esc back</Text>
      </Box>

      {tab === 'backends'  && <BackendsTab  backends={backends} loading={loading} selected={selected} caps={caps} />}
      {tab === 'providers' && <ProvidersTab providerEntries={providerEntries} selected={providerSelected} />}
      {tab === 'models'    && <ModelsTab    backends={backends} loading={loading} />}
      {tab === 'cookbooks' && <CookbooksTab />}

      <Box paddingX={2} marginTop={1}>
        <Text color="#333333" dimColor>
          {tab === 'backends'
            ? '↑↓ select  ↵ install/start/stop  s switch  c configure  r refresh  Tab switch  Esc back'
            : tab === 'providers'
              ? '↑↓ select  ↵ set active/deactivate  k edit key  m model  x remove  Tab switch'
              : tab === 'models'
                ? '↵ browse model catalog  Tab switch  Esc back'
                : 'Tab switch  Esc back'}
        </Text>
      </Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// BackendsTab
// ─────────────────────────────────────────────────────────────────
const BackendsTab: React.FC<{
  backends: BackendInfo[]; loading: boolean; selected: number; caps: SystemCapabilities;
}> = ({ backends, loading, selected, caps }) => {
  if (loading) return <Box paddingX={2} paddingY={1}><Text color="#555555">detecting backends…</Text></Box>;

  const sel = backends[selected];

  const actionHint = (b: BackendInfo) => {
    if (b.status === 'running') {
      if (isDesktopApp(b.type)) return '↵ select model  s select model';
      if (b.type === 'airllm') return '↵ stop  s switch-model';
      return b.type === 'ollama' ? '↵ stop' : '↵ stop  s switch  c configure';
    }
    if (b.status === 'installed') {
      if (isDesktopApp(b.type)) return 'start server in LM Studio app';
      return '↵ start';
    }
    if (isDesktopApp(b.type)) return 'open lmstudio.ai';
    return '↵ install';
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box gap={3}>
        <Text color="#444444" dimColor>system</Text>
        <Text color={caps.hasCuda   ? '#22c55e' : '#555555'}>CUDA {caps.hasCuda   ? '✓' : '✗'}</Text>
        <Text color={caps.hasDocker ? '#22c55e' : '#555555'}>Docker {caps.hasDocker ? '✓' : '✗'}</Text>
        <Text color={caps.hasNvidiaContainerToolkit ? '#22c55e' : '#555555'}>nvidia-ct {caps.hasNvidiaContainerToolkit ? '✓' : '✗'}</Text>
        {caps.pythonVersion && <Text color="#444444">{caps.pythonVersion}</Text>}
      </Box>

      <Box flexDirection="column">
        {backends.map((b, i) => {
          const isSel = i === selected;
          return (
            <Box key={b.type} gap={2} paddingX={1}>
              <Text color={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</Text>
              <Box width={22}><Text color={isSel ? '#e8e8e8' : '#777777'} bold={isSel}>{b.label}</Text></Box>
              <Box width={20}><Text color={STATUS_COLOR[b.status]}>{STATUS_LABEL[b.status]}</Text></Box>
              <Box width={8}><Text color="#444444">:{b.port}</Text></Box>
              <Text color={isSel ? '#666666' : '#333333'}>{actionHint(b)}</Text>
            </Box>
          );
        })}
      </Box>

      {sel && (
        <Box flexDirection="column" marginTop={1} paddingX={2} paddingY={1} borderStyle="single" borderColor="#2a2a2a">
          <Box gap={2}>
            <Text bold color="#e8e8e8">{sel.label}</Text>
            {sel.runningInDocker && <Text color="#444444" dimColor>(container: blonde-{sel.type})</Text>}
          </Box>
          <Text color="#555555">{DESCRIPTIONS[sel.type]}</Text>
          {sel.status === 'running' && sel.models.length > 0 && (
            <Box marginTop={1} gap={2}>
              <Text color="#444444">models:</Text>
              <Text color="#4a9eff">
                {sel.models.slice(0, 5).map(m => m.size ? `${m.id} (${m.size})` : m.id).join(' · ')}
                {sel.models.length > 5 ? ` +${sel.models.length - 5}` : ''}
              </Text>
            </Box>
          )}
          {sel.type === 'lmstudio' && sel.status === 'installed' && (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Text color="#f59e0b">LM Studio detected — local server not started</Text>
              <Text color="#555555">In LM Studio: open the <Text color="#e8e8e8">Developer</Text> tab → click <Text color="#e8e8e8">Start Server</Text></Text>
              <Text color="#555555">Then press <Text color="#e8e8e8">r</Text> to refresh this screen.</Text>
            </Box>
          )}
          {sel.type === 'lmstudio' && sel.status === 'not-installed' && (
            <Box marginTop={1}><Text color="#444444" dimColor>Download from lmstudio.ai — enable its local server, then return here</Text></Box>
          )}
        </Box>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ProvidersTab
// ─────────────────────────────────────────────────────────────────
const ProvidersTab: React.FC<{
  providerEntries: Array<ProviderEntry & { isActive: boolean }>;
  selected: number;
}> = ({ providerEntries, selected }) => {
  const sel = CLOUD_PROVIDERS[selected];
  const selEntry = sel ? providerEntries.find(e => e.type === sel.providerType) : undefined;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Text color="#555555" dimColor>Cloud providers — API keys stored in ~/.blonde/providers.json</Text>

      <Box flexDirection="column" gap={0}>
        {CLOUD_PROVIDERS.map((cpd, i) => {
          const entry  = providerEntries.find(e => e.type === cpd.providerType);
          const isSel  = i === selected;
          const configured = !!entry?.apiKey;
          return (
            <Box key={cpd.type} gap={2} paddingX={1} paddingY={0}>
              <Text color={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</Text>
              <Box width={14}><Text color={isSel ? '#e8e8e8' : '#777777'} bold={isSel}>{cpd.label}</Text></Box>
              <Box width={20}>
                <Text color={configured ? '#22c55e' : '#555555'}>
                  {configured ? '● configured' : '○ not configured'}
                </Text>
              </Box>
              {configured && entry?.model && (
                <Box width={36}><Text color="#4a9eff">{entry.model}</Text></Box>
              )}
              {entry?.isActive && <Text color="#f59e0b" bold>ACTIVE</Text>}
            </Box>
          );
        })}
      </Box>

      {sel && (
        <Box flexDirection="column" marginTop={1} paddingX={2} paddingY={1} borderStyle="single" borderColor="#2a2a2a">
          <Text bold color="#e8e8e8">{sel.label}</Text>
          <Text color="#555555">{sel.desc}</Text>

          {selEntry?.apiKey ? (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Box gap={2}>
                <Text color="#444444">key:</Text>
                <Text color="#4a9eff">{maskKey(selEntry.apiKey)}</Text>
              </Box>
              <Box gap={2}>
                <Text color="#444444">model:</Text>
                <Text color="#e8e8e8">{selEntry.model}</Text>
              </Box>
              <Box gap={2}>
                <Text color="#444444">env var:</Text>
                <Text color="#555555" dimColor>{sel.keyEnvVar}</Text>
              </Box>
              <Box marginTop={1} gap={4}>
                <Text color="#a78bfa">↵ {selEntry.isActive ? 'deactivate' : 'set active'}</Text>
                <Text color="#555555">k edit key</Text>
                <Text color="#555555">m model</Text>
                <Text color="#ef4444">x remove</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Text color="#555555">key format: <Text color="#444444">{sel.keyHint}</Text></Text>
              <Text color="#555555">env var:    <Text color="#444444">{sel.keyEnvVar}</Text></Text>
              <Box marginTop={1}><Text color="#a78bfa">↵ or k — enter API key to configure</Text></Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ApiKeyInputView
// ─────────────────────────────────────────────────────────────────
const ApiKeyInputView: React.FC<{
  providerDef: CloudProviderDef;
  editMode:    boolean;
  currentKey?: string;
  onSubmit:    (apiKey: string) => void;
  onCancel:    () => void;
}> = ({ providerDef, editMode, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  useInput((_, key) => { if (key.escape) onCancel(); });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">{editMode ? 'Update' : 'Add'} {providerDef.label} API Key</Text>
      <Text color="#555555">{providerDef.desc}</Text>
      <Box flexDirection="column" marginTop={1} gap={0}>
        <Text color="#444444">Key format:  <Text color="#555555">{providerDef.keyHint}</Text></Text>
        <Text color="#444444">Env var:     <Text color="#555555">{providerDef.keyEnvVar}</Text></Text>
        <Text color="#444444">Stored at:   <Text color="#555555">~/.blonde/providers.json (not committed to git)</Text></Text>
      </Box>
      <Box borderStyle="round" borderColor="#4a9eff" paddingX={2} marginTop={1}>
        <Text color="#a78bfa">{'→ '}</Text>
        <TextInput
          value={value} onChange={setValue}
          onSubmit={(v) => { if (v.trim()) onSubmit(v.trim()); }}
          placeholder={providerDef.keyHint}
        />
      </Box>
      <Text color="#333333" dimColor>Paste your API key and press ↵  ·  Esc cancel</Text>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// CloudModelSelectView
// ─────────────────────────────────────────────────────────────────
const CloudModelSelectView: React.FC<{
  providerDef:   CloudProviderDef;
  apiKey:        string;
  currentModel?: string;
  onSelect:      (model: string) => void;
  onCancel:      () => void;
}> = ({ providerDef, currentModel, onSelect, onCancel }) => {
  const defaultIdx = Math.max(0, providerDef.models.indexOf(currentModel ?? ''));
  const [selIdx,      setSelIdx]      = useState(defaultIdx);
  const [customMode,  setCustomMode]  = useState(false);
  const [customValue, setCustomValue] = useState('');

  useInput((input, key) => {
    if (customMode) {
      if (key.escape) setCustomMode(false);
      return;
    }
    if (key.escape)    { onCancel(); return; }
    if (key.upArrow)   setSelIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setSelIdx(i => Math.min(providerDef.models.length, i + 1)); // +1 = custom slot
    if (key.return) {
      if (selIdx < providerDef.models.length) onSelect(providerDef.models[selIdx]);
      else setCustomMode(true);
    }
    if (input === 'c' || input === 'C') { setSelIdx(providerDef.models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === providerDef.models.length;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">Select Model — {providerDef.label}</Text>
      <Box flexDirection="column">
        {providerDef.models.map((m, i) => (
          <Box key={m} gap={2}>
            <Text color={i === selIdx ? '#a78bfa' : '#333333'}>{i === selIdx ? '▶' : ' '}</Text>
            <Text color={i === selIdx ? '#e8e8e8' : '#777777'}>{m}</Text>
            {m === currentModel && <Text color="#f59e0b">current</Text>}
          </Box>
        ))}
        <Box gap={2}>
          <Text color={isCustomSlot ? '#a78bfa' : '#333333'}>{isCustomSlot ? '▶' : ' '}</Text>
          {customMode
            ? <Box borderStyle="round" borderColor="#4a9eff" paddingX={1}>
                <TextInput value={customValue} onChange={setCustomValue}
                  onSubmit={(v) => { if (v.trim()) onSelect(v.trim()); }}
                  placeholder="enter custom model ID" />
              </Box>
            : <Text color={isCustomSlot ? '#e8e8e8' : '#555555'}>custom model ID  <Text color="#333333" dimColor>(press c)</Text></Text>
          }
        </Box>
      </Box>
      <Text color="#333333" dimColor>↑↓ select  ↵ confirm  c custom  Esc back</Text>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ModelsTab
// ─────────────────────────────────────────────────────────────────
const ModelsTab: React.FC<{ backends: BackendInfo[]; loading: boolean }> = ({ backends, loading }) => {
  if (loading) return <Box paddingX={2} paddingY={1}><Text color="#555555">loading…</Text></Box>;
  const running = backends.filter(b => b.status === 'running');
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      {running.length === 0
        ? <Text color="#555555">No local backends running. Start one in the Backends tab first.</Text>
        : running.map(b => (
          <Box key={b.type} flexDirection="column">
            <Text bold color="#a78bfa">{b.label}</Text>
            {b.models.length === 0
              ? <Text color="#555555">  no models loaded</Text>
              : b.models.map(m => (
                <Box key={m.id} gap={3} paddingX={2}>
                  <Text color="#e8e8e8">{m.id}</Text>
                  {m.size && <Text color="#444444">{m.size}</Text>}
                </Box>
              ))
            }
          </Box>
        ))
      }
      <Box marginTop={1} paddingX={2} paddingY={1} borderStyle="single" borderColor="#333333">
        <Box flexDirection="column">
          <Text bold color="#e8e8e8">Browse & Download Models</Text>
          <Text color="#555555">Curated catalog — Ollama · HuggingFace · GGUF (bartowski)</Text>
          <Box marginTop={1}><Text color="#a78bfa" dimColor>↵ open catalog</Text></Box>
        </Box>
      </Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// CookbooksTab
// ─────────────────────────────────────────────────────────────────
const COOKBOOKS = [
  { name: 'fast-coding',  model: 'qwen3:0.6B → qwen3:8B', desc: 'Speculative decoding pair. ~1.9× speed boost.',            temp: '0.3', ctx: '4096'   },
  { name: 'balanced',     model: 'qwen3:8B  Q4_K_M',      desc: '~60 tok/s. Best quality-per-VRAM.',                        temp: '0.7', ctx: '8192'   },
  { name: 'reasoning',    model: 'qwen3:14B  Q4_K_M',     desc: '~35 tok/s. Best for architecture & debugging.',            temp: '0.6', ctx: '16384'  },
  { name: 'long-context', model: 'qwen3:8B  ctx 128K',    desc: 'Full codebase in context. Needs extra VRAM.',              temp: '0.5', ctx: '131072' },
  { name: 'airllm-70b',  model: 'llama-3.3-70b / AirLLM', desc: 'Run 70B on 4 GB VRAM via layer-by-layer loading. Slower.', temp: '0.6', ctx: '2048'   },
];

const CookbooksTab: React.FC = () => (
  <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
    <Text color="#555555" dimColor>Built-in presets — tuned for local inference</Text>
    {COOKBOOKS.map(c => (
      <Box key={c.name} flexDirection="column" paddingX={2} paddingY={1} borderStyle="single" borderColor="#2a2a2a">
        <Box gap={3}>
          <Text bold color="#a78bfa">{c.name}</Text>
          <Text color="#4a9eff">{c.model}</Text>
          <Text color="#444444">temp {c.temp}</Text>
          <Text color="#444444">ctx {c.ctx}</Text>
        </Box>
        <Text color="#555555">{c.desc}</Text>
      </Box>
    ))}
    <Text color="#333333" dimColor>Custom cookbooks: ~/.blonde/cookbooks/*.json  (coming soon)</Text>
  </Box>
);

// ─────────────────────────────────────────────────────────────────
// SwitchModelView
// ─────────────────────────────────────────────────────────────────
const SwitchModelView: React.FC<{
  backend:   BackendInfo; caps: SystemCapabilities;
  onConfirm: (model: string, method: InstallMethod, flags: Record<string, string>) => void;
  onCancel:  () => void;
}> = ({ backend, caps, onConfirm, onCancel }) => {
  const [value,  setValue]  = useState('');
  const [method, setMethod] = useState<InstallMethod>(backend.runningInDocker ? 'docker' : 'native');
  const [config, setConfig] = useState<BackendConfig | null>(null);
  useEffect(() => { loadConfig(backend.type).then(setConfig).catch(() => {}); }, [backend.type]);
  useInput((_, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.leftArrow || key.rightArrow) {
      if (supportsDocker(backend.type)) setMethod(m => m === 'docker' ? 'native' : 'docker');
    }
  });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">Switch Model — {backend.label}</Text>
      {config?.model && <Text color="#555555">current: {config.model}</Text>}
      {supportsDocker(backend.type) && (
        <Box gap={3} marginTop={1}>
          <Text color="#444444">Method:</Text>
          {(['docker', 'native'] as InstallMethod[]).map(m => (
            <Text key={m} color={method === m ? '#a78bfa' : '#444444'} bold={method === m}>{method === m ? `[${m}]` : m}</Text>
          ))}
          <Text color="#333333" dimColor>← →</Text>
        </Box>
      )}
      <Box marginTop={1}><Text color="#555555">New model:</Text></Box>
      <Text color="#444444" dimColor>{MODEL_PLACEHOLDER[backend.type]}</Text>
      <Box borderStyle="round" borderColor="#4a9eff" paddingX={2}>
        <Text color="#a78bfa">{'→ '}</Text>
        <TextInput value={value} onChange={setValue}
          onSubmit={(v) => { if (v.trim()) onConfirm(v.trim(), method, config?.flags ?? {}); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]} />
      </Box>
      <Text color="#333333" dimColor>↵ confirm  Esc back{supportsDocker(backend.type) ? '  ← → method' : ''}</Text>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ConfigureView
// ─────────────────────────────────────────────────────────────────
interface FieldState { def: { key: string; label: string; default: string; desc: string }; value: string; }

const ConfigureView: React.FC<{
  backend: BackendInfo; caps: SystemCapabilities;
  onApply: (model: string, method: InstallMethod, flags: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}> = ({ backend, caps, onApply, onCancel }) => {
  const defs = FLAG_DEFS[backend.type];
  const [fields,    setFields]    = useState<FieldState[]>(defs.map(d => ({ def: d, value: d.default })));
  const [model,     setModel]     = useState('');
  const [method,    setMethod]    = useState<InstallMethod>(backend.runningInDocker ? 'docker' : 'native');
  const [focusIdx,  setFocusIdx]  = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const APPLY_IDX  = fields.length + 1;
  const CANCEL_IDX = fields.length + 2;

  useEffect(() => {
    loadConfig(backend.type).then(cfg => {
      if (!cfg) return;
      if (cfg.model) setModel(cfg.model);
      if (cfg.method) setMethod(cfg.method);
      setFields(defs.map(d => ({ def: d, value: cfg.flags[d.key] ?? d.default })));
    }).catch(() => {});
  }, [backend.type]);

  useInput((_, key) => {
    if (isEditing) {
      if (key.return) {
        if (focusIdx === 0) setModel(editValue);
        else setFields(f => f.map((fi, i) => i === focusIdx - 1 ? { ...fi, value: editValue } : fi));
        setIsEditing(false);
      }
      if (key.escape) setIsEditing(false);
      return;
    }
    if (key.escape) { onCancel(); return; }
    if (key.upArrow)   setFocusIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setFocusIdx(i => Math.min(CANCEL_IDX, i + 1));
    if (key.leftArrow || key.rightArrow) {
      if (supportsDocker(backend.type)) setMethod(m => m === 'docker' ? 'native' : 'docker');
    }
    if (key.return) {
      if (focusIdx === APPLY_IDX) {
        const flags: Record<string, string> = {};
        fields.forEach(f => { if (f.value) flags[f.def.key] = f.value; });
        onApply(model, method, flags).catch(() => {});
      } else if (focusIdx === CANCEL_IDX) {
        onCancel();
      } else {
        setEditValue(focusIdx === 0 ? model : (fields[focusIdx - 1]?.value ?? ''));
        setIsEditing(true);
      }
    }
  });

  const rc = (i: number) => i === focusIdx ? '#e8e8e8' : '#666666';
  const cu = (i: number) => i === focusIdx ? '▶' : ' ';

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">Configure {backend.label}</Text>
      {supportsDocker(backend.type) && (
        <Box gap={3} marginTop={1} marginBottom={1}>
          <Text color="#444444">Method:</Text>
          {(['docker', 'native'] as InstallMethod[]).map(m => (
            <Text key={m} color={method === m ? '#a78bfa' : '#444444'} bold={method === m}>{method === m ? `[${m}]` : m}</Text>
          ))}
          <Text color="#333333" dimColor>← →</Text>
        </Box>
      )}
      <Box gap={2}>
        <Text color={rc(0)}>{cu(0)}</Text>
        <Box width={14}><Text color={rc(0)} bold={focusIdx === 0}>model</Text></Box>
        <Box borderStyle={focusIdx === 0 && isEditing ? 'round' : undefined} borderColor="#4a9eff" paddingX={focusIdx === 0 && isEditing ? 1 : 0}>
          {focusIdx === 0 && isEditing
            ? <TextInput value={editValue} onChange={setEditValue} onSubmit={() => { setModel(editValue); setIsEditing(false); }} placeholder="model name or path" />
            : <Text color={rc(0)}>{model || '(not set)'}</Text>
          }
        </Box>
        <Text color="#333333" dimColor>model to load</Text>
      </Box>
      {fields.map((f, i) => {
        const ri = i + 1; const isFoc = focusIdx === ri;
        return (
          <Box key={f.def.key} gap={2}>
            <Text color={rc(ri)}>{cu(ri)}</Text>
            <Box width={14}><Text color={rc(ri)} bold={isFoc}>{f.def.label}</Text></Box>
            <Box borderStyle={isFoc && isEditing ? 'round' : undefined} borderColor="#4a9eff" paddingX={isFoc && isEditing ? 1 : 0}>
              {isFoc && isEditing
                ? <TextInput value={editValue} onChange={setEditValue} onSubmit={() => { setFields(fs => fs.map((fi, j) => j === i ? { ...fi, value: editValue } : fi)); setIsEditing(false); }} placeholder={f.def.default} />
                : <Text color={f.value ? rc(ri) : '#444444'}>{f.value || f.def.default}</Text>
              }
            </Box>
            <Text color="#333333" dimColor>{f.def.desc}</Text>
          </Box>
        );
      })}
      <Box gap={4} marginTop={1}>
        <Text color={focusIdx === APPLY_IDX ? '#22c55e' : '#444444'} bold={focusIdx === APPLY_IDX}>{focusIdx === APPLY_IDX ? '▶ ' : '  '}Apply & Restart</Text>
        <Text color={focusIdx === CANCEL_IDX ? '#ef4444' : '#444444'} bold={focusIdx === CANCEL_IDX}>{focusIdx === CANCEL_IDX ? '▶ ' : '  '}Cancel</Text>
      </Box>
      <Text color="#333333" dimColor>↑↓ navigate  ↵ edit/confirm  Esc cancel</Text>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// CatalogView
// ─────────────────────────────────────────────────────────────────
const MAX_VISIBLE = 8;
const TAG_COLOR: Record<string, string> = { coding: '#4a9eff', general: '#a78bfa', fast: '#22c55e', reasoning: '#f59e0b', draft: '#555555', balanced: '#888888' };

const CatalogView: React.FC<{
  caps: SystemCapabilities; onDownload: (opt: DownloadOption) => void; onCancel: () => void;
}> = ({ caps, onDownload, onCancel }) => {
  const [modelIdx, setModelIdx] = useState(0);
  const [optIdx,   setOptIdx]   = useState(0);
  const [phase,    setPhase]    = useState<'list' | 'options'>('list');
  const [hfCliOk,  setHfCliOk]  = useState<boolean | null>(null);
  const [scroll,   setScroll]   = useState(0);

  useEffect(() => {
    exec('which huggingface-cli 2>/dev/null || pip3 show huggingface-hub 2>/dev/null')
      .then(() => setHfCliOk(true)).catch(() => setHfCliOk(false));
  }, []);

  const selected = CATALOG[modelIdx];
  const options  = selected ? getDownloadOptions(selected) : [];

  useInput((_, key) => {
    if (key.escape) { if (phase === 'options') { setPhase('list'); return; } onCancel(); return; }
    if (phase === 'list') {
      if (key.upArrow) {
        const next = Math.max(0, modelIdx - 1);
        setModelIdx(next);
        if (next < scroll) setScroll(next);
      }
      if (key.downArrow) {
        const next = Math.min(CATALOG.length - 1, modelIdx + 1);
        setModelIdx(next);
        if (next >= scroll + MAX_VISIBLE) setScroll(next - MAX_VISIBLE + 1);
      }
      if (key.return && selected) setPhase('options');
    } else {
      if (key.upArrow)   setOptIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setOptIdx(i => Math.min(options.length - 1, i + 1));
      if (key.return && options[optIdx]) onDownload(options[optIdx]);
    }
  });

  const visible = CATALOG.slice(scroll, scroll + MAX_VISIBLE);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box gap={3} borderStyle="single" borderColor="#2a2a2a" paddingX={2} paddingY={1}>
        <Text bold color="#a78bfa">Model Catalog</Text>
        <Text color="#555555">{CATALOG.length} models · Ollama · HuggingFace · GGUF</Text>
        <Box flexGrow={1} /><Text color="#333333" dimColor>Esc back</Text>
      </Box>
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Box flexDirection="column" width={36}>
          {visible.map((m, vi) => {
            const absIdx = scroll + vi; const isSel = absIdx === modelIdx;
            return (
              <Box key={m.id} gap={1}>
                <Text color={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</Text>
                <Box flexDirection="column">
                  <Text color={isSel ? '#e8e8e8' : '#777777'} bold={isSel}>{m.name}</Text>
                  <Box gap={1}>
                    <Text color="#444444">{m.minVram}</Text>
                    {m.tags.slice(0, 2).map(t => <Text key={t} color={TAG_COLOR[t] ?? '#555555'}>{t}</Text>)}
                  </Box>
                </Box>
              </Box>
            );
          })}
          {CATALOG.length > MAX_VISIBLE && <Text color="#333333" dimColor>  {scroll + MAX_VISIBLE < CATALOG.length ? '↓ more' : '─ end'}</Text>}
        </Box>
        {selected && (
          <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1} borderStyle="single" borderColor="#2a2a2a">
            <Text bold color="#e8e8e8">{selected.name}</Text>
            <Text color="#555555">{selected.family}  ·  min {selected.minVram}</Text>
            <Box marginTop={1}><Text color="#888888">{selected.desc}</Text></Box>
            {phase === 'list'
              ? <Box marginTop={1}><Text color="#a78bfa" dimColor>↵ see download options</Text></Box>
              : (
                <Box flexDirection="column" marginTop={1} gap={0}>
                  <Text color="#555555">Download as:</Text>
                  {options.map((opt, i) => (
                    <Box key={i} flexDirection="column">
                      <Box gap={1}>
                        <Text color={i === optIdx ? '#a78bfa' : '#444444'}>{i === optIdx ? '▶' : ' '}</Text>
                        <Text color={i === optIdx ? '#e8e8e8' : '#777777'}>{opt.label}</Text>
                      </Box>
                      {opt.note && i === optIdx && <Text color="#444444" dimColor>  {opt.note}</Text>}
                    </Box>
                  ))}
                  {hfCliOk === false && options.some(o => o.format !== 'ollama') && (
                    <Box marginTop={1} flexDirection="column">
                      <Text color="#f59e0b">⚠ huggingface-cli not found</Text>
                      <Text color="#444444" dimColor>pip3 install huggingface-hub</Text>
                    </Box>
                  )}
                  <Box marginTop={1}><Text color="#333333" dimColor>↑↓ select  ↵ download  Esc back</Text></Box>
                </Box>
              )
            }
          </Box>
        )}
      </Box>
      <Box marginTop={1}><Text color="#333333" dimColor>↑↓ navigate  ↵ select  Esc back</Text></Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// MethodSelectView
// ─────────────────────────────────────────────────────────────────
const MethodSelectView: React.FC<{
  backend: BackendInfo; intent: 'install' | 'start';
  onSelect: (m: InstallMethod) => void; onCancel: () => void;
}> = ({ backend, intent, onSelect, onCancel }) => {
  const [sel, setSel] = useState<InstallMethod>('docker');
  useInput((_, key) => {
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) setSel(m => m === 'docker' ? 'native' : 'docker');
    if (key.return) onSelect(sel);
    if (key.escape) onCancel();
  });
  const opts = [
    { id: 'docker' as const, label: 'Docker  (recommended)', desc: 'Official image. Isolated. Requires Docker + nvidia-container-toolkit.' },
    { id: 'native' as const, label: 'Native  (pip)',         desc: 'pip install. No Docker needed. May conflict with existing PyTorch.'   },
  ];
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">{intent === 'install' ? 'Install' : 'Start'} {backend.label}</Text>
      <Text color="#666666">Choose install method:</Text>
      {opts.map(m => (
        <Box key={m.id} gap={2} marginTop={1}>
          <Text color={sel === m.id ? '#a78bfa' : '#333333'}>{sel === m.id ? '▶' : ' '}</Text>
          <Box flexDirection="column">
            <Text color={sel === m.id ? '#e8e8e8' : '#777777'} bold={sel === m.id}>{m.label}</Text>
            <Text color="#444444">{m.desc}</Text>
          </Box>
        </Box>
      ))}
      <Box marginTop={1}><Text color="#333333" dimColor>↑↓ select  ↵ confirm  Esc back</Text></Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ModelInputView
// ─────────────────────────────────────────────────────────────────
const ModelInputView: React.FC<{
  backend: BackendInfo; method: InstallMethod;
  onSubmit: (model: string) => void; onCancel: () => void;
}> = ({ backend, method, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  useInput((_, key) => { if (key.escape) onCancel(); });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">Start {backend.label} ({method})</Text>
      <Text color="#666666">Enter a model to load:</Text>
      <Text color="#444444" dimColor>{MODEL_PLACEHOLDER[backend.type]}</Text>
      <Box borderStyle="round" borderColor="#4a9eff" paddingX={2} marginTop={1}>
        <Text color="#a78bfa">{'→ '}</Text>
        <TextInput value={value} onChange={setValue}
          onSubmit={(v) => { if (v.trim()) onSubmit(v.trim()); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]} />
      </Box>
      <Box marginTop={1}><Text color="#333333" dimColor>↵ confirm  Esc back</Text></Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// PermissionView
// ─────────────────────────────────────────────────────────────────
const PermissionView: React.FC<{
  action: BackendAction; onConfirm: () => void; onCancel: () => void;
}> = ({ action, onConfirm, onCancel }) => {
  const [focus, setFocus] = useState<'confirm' | 'cancel'>('confirm');
  const allMet = action.requirements.every(r => r.met);
  useInput((_, key) => {
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) setFocus(f => f === 'confirm' ? 'cancel' : 'confirm');
    if (key.return)  focus === 'confirm' ? onConfirm() : onCancel();
    if (key.escape)  onCancel();
  });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">{action.title}</Text>
      {action.requirements.length > 0 && (
        <Box flexDirection="column">
          <Text color="#555555">Requirements:</Text>
          {action.requirements.map((r, i) => (
            <Box key={i} gap={2}>
              <Text color={r.met ? '#22c55e' : '#ef4444'}>{r.met ? '✓' : '✗'}</Text>
              <Text color={r.met ? '#aaaaaa' : '#ef4444'}>{r.name}</Text>
              {!r.met && r.hint && <Text color="#444444" dimColor>— {r.hint}</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        <Text color="#555555">Will run:</Text>
        {action.steps.map((s, i) => (
          <Text key={i} color="#e8e8e8">  {s.command} {s.args.slice(0, 6).join(' ')}{s.args.length > 6 ? ' …' : ''}</Text>
        ))}
      </Box>
      {!allMet && <Text color="#f59e0b">⚠  Some requirements unmet — may fail.</Text>}
      <Box gap={4} marginTop={1}>
        <Text color={focus === 'confirm' ? '#a78bfa' : '#444444'} bold={focus === 'confirm'}>{focus === 'confirm' ? '▶ ' : '  '}Run</Text>
        <Text color={focus === 'cancel'  ? '#ef4444' : '#444444'} bold={focus === 'cancel'} >{focus === 'cancel'  ? '▶ ' : '  '}Cancel</Text>
      </Box>
      <Box marginTop={1}><Text color="#333333" dimColor>↑↓ select  ↵ confirm  Esc cancel</Text></Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// LmStudioModelSelectView
// ─────────────────────────────────────────────────────────────────
const LmStudioModelSelectView: React.FC<{
  backend:  BackendInfo;
  onSelect: (model: string) => void;
  onCancel: () => void;
}> = ({ backend, onSelect, onCancel }) => {
  const models = backend.models;
  const totalSlots = models.length + 1; // +1 for custom entry
  const [selIdx,      setSelIdx]      = useState(0);
  const [customMode,  setCustomMode]  = useState(false);
  const [customValue, setCustomValue] = useState('');

  useInput((input, key) => {
    if (customMode) {
      if (key.escape) setCustomMode(false);
      return;
    }
    if (key.escape)    { onCancel(); return; }
    if (key.upArrow)   setSelIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setSelIdx(i => Math.min(totalSlots - 1, i + 1));
    if (key.return) {
      if (selIdx < models.length) onSelect(models[selIdx].id);
      else setCustomMode(true);
    }
    if (input === 'c' || input === 'C') { setSelIdx(models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === models.length;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <Text bold color="#e8e8e8">LM Studio — Select Model</Text>
      <Text color="#555555">Models available from LM Studio local server (port 1234)</Text>

      {models.length === 0 ? (
        <Box flexDirection="column" marginTop={1} gap={0}>
          <Text color="#f59e0b">⚠  No models detected</Text>
          <Text color="#555555">Load a model in LM Studio → Local Server tab, then come back.</Text>
          <Text color="#555555">Or enter a custom model ID below.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {models.map((m, i) => (
            <Box key={m.id} gap={2}>
              <Text color={i === selIdx ? '#a78bfa' : '#333333'}>{i === selIdx ? '▶' : ' '}</Text>
              <Text color={i === selIdx ? '#e8e8e8' : '#777777'}>{m.id}</Text>
              {m.size && <Text color="#444444">{m.size}</Text>}
            </Box>
          ))}
        </Box>
      )}

      <Box gap={2} marginTop={models.length === 0 ? 1 : 0}>
        <Text color={isCustomSlot ? '#a78bfa' : '#333333'}>{isCustomSlot ? '▶' : ' '}</Text>
        {customMode
          ? <Box borderStyle="round" borderColor="#4a9eff" paddingX={1}>
              <TextInput value={customValue} onChange={setCustomValue}
                onSubmit={(v) => { if (v.trim()) onSelect(v.trim()); }}
                placeholder="enter model ID (e.g. lmstudio-community/Meta-Llama-3-8B)" />
            </Box>
          : <Text color={isCustomSlot ? '#e8e8e8' : '#555555'}>custom model ID  <Text color="#333333" dimColor>(press c)</Text></Text>
        }
      </Box>

      <Text color="#333333" dimColor>↑↓ select  ↵ use model  c custom  Esc back</Text>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ResultView
// ─────────────────────────────────────────────────────────────────
const ResultView: React.FC<{ success: boolean; message: string; onDone: () => void }> = ({ success, message, onDone }) => {
  useInput((_, key) => { if (key.return || key.escape) onDone(); });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1} borderStyle="double" borderColor={success ? '#22c55e' : '#ef4444'}>
      <Text bold color={success ? '#22c55e' : '#ef4444'}>{success ? '✓  Done' : '✗  Failed'}</Text>
      <Text color="#aaaaaa">{message}</Text>
      {success && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="#555555">Active provider is used automatically for all future sessions.</Text>
          <Text color="#555555">Use /provider to view or switch providers in-session.</Text>
        </Box>
      )}
      <Box marginTop={1}><Text color="#333333" dimColor>↵ or Esc to continue</Text></Box>
    </Box>
  );
};
