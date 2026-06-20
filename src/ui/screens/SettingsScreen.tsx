import React, { useState, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
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
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <text fg="#a78bfa"><strong>{mode.action.title}</strong></text>
        <text fg="#555555">Running — please wait</text>
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
      </box>
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

  useKeyboard((key) => {
    if (key.name === 'escape') { onBack(); return; }
    if (key.name === 'tab')    { onTabChange(tabs[(tabs.indexOf(tab) + 1) % tabs.length]); return; }

    if (tab === 'backends' && !loading) {
      if (key.name === 'up')   onSelectChange(Math.max(0, selected - 1));
      if (key.name === 'down') onSelectChange(Math.min(backends.length - 1, selected + 1));
      if (key.name === 'return')    { const b = backends[selected]; if (b) onBackendAction(b); }
      if (key.sequence === 'r' || key.sequence === 'R') onRefresh();
      const sel = backends[selected];
      if (sel?.status === 'running') {
        if (key.sequence === 's' || key.sequence === 'S') onSwitchModel(sel);
        if ((key.sequence === 'c' || key.sequence === 'C') && sel.type !== 'ollama' && sel.type !== 'lmstudio') onConfigure(sel);
      }
    }

    if (tab === 'providers') {
      if (key.name === 'up')   onProviderSelectChange(Math.max(0, providerSelected - 1));
      if (key.name === 'down') onProviderSelectChange(Math.min(CLOUD_PROVIDERS.length - 1, providerSelected + 1));
      const cpd = CLOUD_PROVIDERS[providerSelected];
      if (!cpd) return;
      if (key.name === 'return')               onProviderAction(cpd);
      if (key.sequence === 'k' || key.sequence === 'K') onProviderEditKey(cpd);
      if (key.sequence === 'm' || key.sequence === 'M') onProviderChangeModel(cpd);
      if (key.sequence === 'x' || key.sequence === 'X') onProviderRemove(cpd).catch(() => {});
    }

    if (tab === 'models') {
      if (key.name === 'return' || key.sequence === 'd' || key.sequence === 'D') onBrowseCatalog();
    }
  });

  return (
    <box flexDirection="column">
      <box gap={3} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#2a2a2a">
        <text fg="#a78bfa"><strong>settings</strong></text>
        <text fg="#333333">·</text>
        {tabs.map(t => (
          tab === t
            ? <text key={t} fg="#e8e8e8"><strong>{`[${t}]`}</strong></text>
            : <text key={t} fg="#555555">{t}</text>
        ))}
        <box flexGrow={1} />
        <text fg="#333333">Tab · Esc back</text>
      </box>

      {tab === 'backends'  && <BackendsTab  backends={backends} loading={loading} selected={selected} caps={caps} />}
      {tab === 'providers' && <ProvidersTab providerEntries={providerEntries} selected={providerSelected} />}
      {tab === 'models'    && <ModelsTab    backends={backends} loading={loading} />}
      {tab === 'cookbooks' && <CookbooksTab />}

      <box paddingLeft={2} paddingRight={2} marginTop={1}>
        <text fg="#333333">
          {tab === 'backends'
            ? '↑↓ select  ↵ install/start/stop  s switch  c configure  r refresh  Tab switch  Esc back'
            : tab === 'providers'
              ? '↑↓ select  ↵ set active/deactivate  k edit key  m model  x remove  Tab switch'
              : tab === 'models'
                ? '↵ browse model catalog  Tab switch  Esc back'
                : 'Tab switch  Esc back'}
        </text>
      </box>
    </box>
  );
};

// ─────────────────────────────────────────────────────────────────
// BackendsTab
// ─────────────────────────────────────────────────────────────────
const BackendsTab: React.FC<{
  backends: BackendInfo[]; loading: boolean; selected: number; caps: SystemCapabilities;
}> = ({ backends, loading, selected, caps }) => {
  if (loading) return <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}><text fg="#555555">detecting backends…</text></box>;

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
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <box gap={3}>
        <text fg="#444444">system</text>
        <text fg={caps.hasCuda   ? '#22c55e' : '#555555'}>CUDA {caps.hasCuda   ? '✓' : '✗'}</text>
        <text fg={caps.hasDocker ? '#22c55e' : '#555555'}>Docker {caps.hasDocker ? '✓' : '✗'}</text>
        <text fg={caps.hasNvidiaContainerToolkit ? '#22c55e' : '#555555'}>nvidia-ct {caps.hasNvidiaContainerToolkit ? '✓' : '✗'}</text>
        {caps.pythonVersion && <text fg="#444444">{caps.pythonVersion}</text>}
      </box>

      <box flexDirection="column">
        {backends.map((b, i) => {
          const isSel = i === selected;
          return (
            <box key={b.type} gap={2} paddingLeft={1} paddingRight={1}>
              <text fg={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</text>
              <box width={22}>
                {isSel
                  ? <text fg="#e8e8e8"><strong>{b.label}</strong></text>
                  : <text fg="#777777">{b.label}</text>
                }
              </box>
              <box width={20}><text fg={STATUS_COLOR[b.status]}>{STATUS_LABEL[b.status]}</text></box>
              <box width={8}><text fg="#444444">:{b.port}</text></box>
              <text fg={isSel ? '#666666' : '#333333'}>{actionHint(b)}</text>
            </box>
          );
        })}
      </box>

      {sel && (
        <box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#2a2a2a">
          <box gap={2}>
            <text fg="#e8e8e8"><strong>{sel.label}</strong></text>
            {sel.runningInDocker && <text fg="#444444">(container: blonde-{sel.type})</text>}
          </box>
          <text fg="#555555">{DESCRIPTIONS[sel.type]}</text>
          {sel.status === 'running' && sel.models.length > 0 && (
            <box marginTop={1} gap={2}>
              <text fg="#444444">models:</text>
              <text fg="#4a9eff">
                {sel.models.slice(0, 5).map(m => m.size ? `${m.id} (${m.size})` : m.id).join(' · ')}
                {sel.models.length > 5 ? ` +${sel.models.length - 5}` : ''}
              </text>
            </box>
          )}
          {sel.type === 'lmstudio' && sel.status === 'installed' && (
            <box flexDirection="column" marginTop={1} gap={0}>
              <text fg="#f59e0b">LM Studio detected — local server not started</text>
              <text fg="#555555">In LM Studio: open the <text fg="#e8e8e8">Developer</text> tab → click <text fg="#e8e8e8">Start Server</text></text>
              <text fg="#555555">Then press <text fg="#e8e8e8">r</text> to refresh this screen.</text>
            </box>
          )}
          {sel.type === 'lmstudio' && sel.status === 'not-installed' && (
            <box marginTop={1}><text fg="#444444">Download from lmstudio.ai — enable its local server, then return here</text></box>
          )}
        </box>
      )}
    </box>
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
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <text fg="#555555">Cloud providers — API keys stored in ~/.blonde/providers.json</text>

      <box flexDirection="column" gap={0}>
        {CLOUD_PROVIDERS.map((cpd, i) => {
          const entry  = providerEntries.find(e => e.type === cpd.providerType);
          const isSel  = i === selected;
          const configured = !!entry?.apiKey;
          return (
            <box key={cpd.type} gap={2} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
              <text fg={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</text>
              <box width={14}>
                {isSel
                  ? <text fg="#e8e8e8"><strong>{cpd.label}</strong></text>
                  : <text fg="#777777">{cpd.label}</text>
                }
              </box>
              <box width={20}>
                <text fg={configured ? '#22c55e' : '#555555'}>
                  {configured ? '● configured' : '○ not configured'}
                </text>
              </box>
              {configured && entry?.model && (
                <box width={36}><text fg="#4a9eff">{entry.model}</text></box>
              )}
              {entry?.isActive && <text fg="#f59e0b"><strong>ACTIVE</strong></text>}
            </box>
          );
        })}
      </box>

      {sel && (
        <box flexDirection="column" marginTop={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#2a2a2a">
          <text fg="#e8e8e8"><strong>{sel.label}</strong></text>
          <text fg="#555555">{sel.desc}</text>

          {selEntry?.apiKey ? (
            <box flexDirection="column" marginTop={1} gap={0}>
              <box gap={2}>
                <text fg="#444444">key:</text>
                <text fg="#4a9eff">{maskKey(selEntry.apiKey)}</text>
              </box>
              <box gap={2}>
                <text fg="#444444">model:</text>
                <text fg="#e8e8e8">{selEntry.model}</text>
              </box>
              <box gap={2}>
                <text fg="#444444">env var:</text>
                <text fg="#555555">{sel.keyEnvVar}</text>
              </box>
              <box marginTop={1} gap={4}>
                <text fg="#a78bfa">↵ {selEntry.isActive ? 'deactivate' : 'set active'}</text>
                <text fg="#555555">k edit key</text>
                <text fg="#555555">m model</text>
                <text fg="#ef4444">x remove</text>
              </box>
            </box>
          ) : (
            <box flexDirection="column" marginTop={1} gap={0}>
              <text fg="#555555">key format: <text fg="#444444">{sel.keyHint}</text></text>
              <text fg="#555555">env var:    <text fg="#444444">{sel.keyEnvVar}</text></text>
              <box marginTop={1}><text fg="#a78bfa">↵ or k — enter API key to configure</text></box>
            </box>
          )}
        </box>
      )}
    </box>
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
  useKeyboard((key) => { if (key.name === 'escape') onCancel(); });
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>{editMode ? 'Update' : 'Add'} {providerDef.label} API Key</strong></text>
      <text fg="#555555">{providerDef.desc}</text>
      <box flexDirection="column" marginTop={1} gap={0}>
        <text fg="#444444">Key format:  <text fg="#555555">{providerDef.keyHint}</text></text>
        <text fg="#444444">Env var:     <text fg="#555555">{providerDef.keyEnvVar}</text></text>
        <text fg="#444444">Stored at:   <text fg="#555555">~/.blonde/providers.json (not committed to git)</text></text>
      </box>
      <box borderStyle="rounded" borderColor="#4a9eff" paddingLeft={2} paddingRight={2} marginTop={1}>
        <text fg="#a78bfa">{'→ '}</text>
        <input
          value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSubmit(v.trim()); }}
          placeholder={providerDef.keyHint}
          width={40}
        />
      </box>
      <text fg="#333333">Paste your API key and press ↵  ·  Esc cancel</text>
    </box>
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

  useKeyboard((key) => {
    if (customMode) {
      if (key.name === 'escape') setCustomMode(false);
      return;
    }
    if (key.name === 'escape')    { onCancel(); return; }
    if (key.name === 'up')   setSelIdx(i => Math.max(0, i - 1));
    if (key.name === 'down') setSelIdx(i => Math.min(providerDef.models.length, i + 1)); // +1 = custom slot
    if (key.name === 'return') {
      if (selIdx < providerDef.models.length) onSelect(providerDef.models[selIdx]);
      else setCustomMode(true);
    }
    if (key.sequence === 'c' || key.sequence === 'C') { setSelIdx(providerDef.models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === providerDef.models.length;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>Select Model — {providerDef.label}</strong></text>
      <box flexDirection="column">
        {providerDef.models.map((m, i) => (
          <box key={m} gap={2}>
            <text fg={i === selIdx ? '#a78bfa' : '#333333'}>{i === selIdx ? '▶' : ' '}</text>
            <text fg={i === selIdx ? '#e8e8e8' : '#777777'}>{m}</text>
            {m === currentModel && <text fg="#f59e0b">current</text>}
          </box>
        ))}
        <box gap={2}>
          <text fg={isCustomSlot ? '#a78bfa' : '#333333'}>{isCustomSlot ? '▶' : ' '}</text>
          {customMode
            ? <box borderStyle="rounded" borderColor="#4a9eff" paddingLeft={1} paddingRight={1}>
                <input value={customValue} onInput={(v: string) => setCustomValue(v)}
                  onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSelect(v.trim()); }}
                  placeholder="enter custom model ID"
                  width={40} />
              </box>
            : <text fg={isCustomSlot ? '#e8e8e8' : '#555555'}>custom model ID  <text fg="#333333">(press c)</text></text>
          }
        </box>
      </box>
      <text fg="#333333">↑↓ select  ↵ confirm  c custom  Esc back</text>
    </box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ModelsTab
// ─────────────────────────────────────────────────────────────────
const ModelsTab: React.FC<{ backends: BackendInfo[]; loading: boolean }> = ({ backends, loading }) => {
  if (loading) return <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}><text fg="#555555">loading…</text></box>;
  const running = backends.filter(b => b.status === 'running');
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      {running.length === 0
        ? <text fg="#555555">No local backends running. Start one in the Backends tab first.</text>
        : running.map(b => (
          <box key={b.type} flexDirection="column">
            <text fg="#a78bfa"><strong>{b.label}</strong></text>
            {b.models.length === 0
              ? <text fg="#555555">  no models loaded</text>
              : b.models.map(m => (
                <box key={m.id} gap={3} paddingLeft={2} paddingRight={2}>
                  <text fg="#e8e8e8">{m.id}</text>
                  {m.size && <text fg="#444444">{m.size}</text>}
                </box>
              ))
            }
          </box>
        ))
      }
      <box marginTop={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#333333">
        <box flexDirection="column">
          <text fg="#e8e8e8"><strong>Browse & Download Models</strong></text>
          <text fg="#555555">Curated catalog — Ollama · HuggingFace · GGUF (bartowski)</text>
          <box marginTop={1}><text fg="#a78bfa">↵ open catalog</text></box>
        </box>
      </box>
    </box>
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
  <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
    <text fg="#555555">Built-in presets — tuned for local inference</text>
    {COOKBOOKS.map(c => (
      <box key={c.name} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#2a2a2a">
        <box gap={3}>
          <text fg="#a78bfa"><strong>{c.name}</strong></text>
          <text fg="#4a9eff">{c.model}</text>
          <text fg="#444444">temp {c.temp}</text>
          <text fg="#444444">ctx {c.ctx}</text>
        </box>
        <text fg="#555555">{c.desc}</text>
      </box>
    ))}
    <text fg="#333333">Custom cookbooks: ~/.blonde/cookbooks/*.json  (coming soon)</text>
  </box>
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
  useKeyboard((key) => {
    if (key.name === 'escape') { onCancel(); return; }
    if (key.name === 'left' || key.name === 'right') {
      if (supportsDocker(backend.type)) setMethod(m => m === 'docker' ? 'native' : 'docker');
    }
  });
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>Switch Model — {backend.label}</strong></text>
      {config?.model && <text fg="#555555">current: {config.model}</text>}
      {supportsDocker(backend.type) && (
        <box gap={3} marginTop={1}>
          <text fg="#444444">Method:</text>
          {(['docker', 'native'] as InstallMethod[]).map(m => (
            method === m
              ? <text key={m} fg="#a78bfa"><strong>{`[${m}]`}</strong></text>
              : <text key={m} fg="#444444">{m}</text>
          ))}
          <text fg="#333333">← →</text>
        </box>
      )}
      <box marginTop={1}><text fg="#555555">New model:</text></box>
      <text fg="#444444">{MODEL_PLACEHOLDER[backend.type]}</text>
      <box borderStyle="rounded" borderColor="#4a9eff" paddingLeft={2} paddingRight={2}>
        <text fg="#a78bfa">{'→ '}</text>
        <input value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onConfirm(v.trim(), method, config?.flags ?? {}); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]}
          width={40} />
      </box>
      <text fg="#333333">↵ confirm  Esc back{supportsDocker(backend.type) ? '  ← → method' : ''}</text>
    </box>
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

  useKeyboard((key) => {
    if (isEditing) {
      if (key.name === 'return') {
        if (focusIdx === 0) setModel(editValue);
        else setFields(f => f.map((fi, i) => i === focusIdx - 1 ? { ...fi, value: editValue } : fi));
        setIsEditing(false);
      }
      if (key.name === 'escape') setIsEditing(false);
      return;
    }
    if (key.name === 'escape') { onCancel(); return; }
    if (key.name === 'up')   setFocusIdx(i => Math.max(0, i - 1));
    if (key.name === 'down') setFocusIdx(i => Math.min(CANCEL_IDX, i + 1));
    if (key.name === 'left' || key.name === 'right') {
      if (supportsDocker(backend.type)) setMethod(m => m === 'docker' ? 'native' : 'docker');
    }
    if (key.name === 'return') {
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
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>Configure {backend.label}</strong></text>
      {supportsDocker(backend.type) && (
        <box gap={3} marginTop={1} marginBottom={1}>
          <text fg="#444444">Method:</text>
          {(['docker', 'native'] as InstallMethod[]).map(m => (
            method === m
              ? <text key={m} fg="#a78bfa"><strong>{`[${m}]`}</strong></text>
              : <text key={m} fg="#444444">{m}</text>
          ))}
          <text fg="#333333">← →</text>
        </box>
      )}
      <box gap={2}>
        <text fg={rc(0)}>{cu(0)}</text>
        <box width={14}>
          {focusIdx === 0
            ? <text fg={rc(0)}><strong>model</strong></text>
            : <text fg={rc(0)}>model</text>
          }
        </box>
        <box borderStyle={focusIdx === 0 && isEditing ? 'rounded' : undefined} borderColor="#4a9eff" paddingLeft={focusIdx === 0 && isEditing ? 1 : 0} paddingRight={focusIdx === 0 && isEditing ? 1 : 0}>
          {focusIdx === 0 && isEditing
            ? <input value={editValue} onInput={(v: string) => setEditValue(v)} onSubmit={() => { setModel(editValue); setIsEditing(false); }} placeholder="model name or path" width={40} />
            : <text fg={rc(0)}>{model || '(not set)'}</text>
          }
        </box>
        <text fg="#333333">model to load</text>
      </box>
      {fields.map((f, i) => {
        const ri = i + 1; const isFoc = focusIdx === ri;
        return (
          <box key={f.def.key} gap={2}>
            <text fg={rc(ri)}>{cu(ri)}</text>
            <box width={14}>
              {isFoc
                ? <text fg={rc(ri)}><strong>{f.def.label}</strong></text>
                : <text fg={rc(ri)}>{f.def.label}</text>
              }
            </box>
            <box borderStyle={isFoc && isEditing ? 'rounded' : undefined} borderColor="#4a9eff" paddingLeft={isFoc && isEditing ? 1 : 0} paddingRight={isFoc && isEditing ? 1 : 0}>
              {isFoc && isEditing
                ? <input value={editValue} onInput={(v: string) => setEditValue(v)} onSubmit={() => { setFields(fs => fs.map((fi, j) => j === i ? { ...fi, value: editValue } : fi)); setIsEditing(false); }} placeholder={f.def.default} width={40} />
                : <text fg={f.value ? rc(ri) : '#444444'}>{f.value || f.def.default}</text>
              }
            </box>
            <text fg="#333333">{f.def.desc}</text>
          </box>
        );
      })}
      <box gap={4} marginTop={1}>
        {focusIdx === APPLY_IDX
          ? <text fg="#22c55e"><strong>▶ Apply & Restart</strong></text>
          : <text fg="#444444">  Apply & Restart</text>
        }
        {focusIdx === CANCEL_IDX
          ? <text fg="#ef4444"><strong>▶ Cancel</strong></text>
          : <text fg="#444444">  Cancel</text>
        }
      </box>
      <text fg="#333333">↑↓ navigate  ↵ edit/confirm  Esc cancel</text>
    </box>
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

  useKeyboard((key) => {
    if (key.name === 'escape') { if (phase === 'options') { setPhase('list'); return; } onCancel(); return; }
    if (phase === 'list') {
      if (key.name === 'up') {
        const next = Math.max(0, modelIdx - 1);
        setModelIdx(next);
        if (next < scroll) setScroll(next);
      }
      if (key.name === 'down') {
        const next = Math.min(CATALOG.length - 1, modelIdx + 1);
        setModelIdx(next);
        if (next >= scroll + MAX_VISIBLE) setScroll(next - MAX_VISIBLE + 1);
      }
      if (key.name === 'return' && selected) setPhase('options');
    } else {
      if (key.name === 'up')   setOptIdx(i => Math.max(0, i - 1));
      if (key.name === 'down') setOptIdx(i => Math.min(options.length - 1, i + 1));
      if (key.name === 'return' && options[optIdx]) onDownload(options[optIdx]);
    }
  });

  const visible = CATALOG.slice(scroll, scroll + MAX_VISIBLE);

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <box gap={3} borderStyle="single" borderColor="#2a2a2a" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <text fg="#a78bfa"><strong>Model Catalog</strong></text>
        <text fg="#555555">{CATALOG.length} models · Ollama · HuggingFace · GGUF</text>
        <box flexGrow={1} /><text fg="#333333">Esc back</text>
      </box>
      <box flexDirection="row" gap={2} marginTop={1}>
        <box flexDirection="column" width={36}>
          {visible.map((m, vi) => {
            const absIdx = scroll + vi; const isSel = absIdx === modelIdx;
            return (
              <box key={m.id} gap={1}>
                <text fg={isSel ? '#a78bfa' : '#333333'}>{isSel ? '▶' : ' '}</text>
                <box flexDirection="column">
                  {isSel
                    ? <text fg="#e8e8e8"><strong>{m.name}</strong></text>
                    : <text fg="#777777">{m.name}</text>
                  }
                  <box gap={1}>
                    <text fg="#444444">{m.minVram}</text>
                    {m.tags.slice(0, 2).map(t => <text key={t} fg={TAG_COLOR[t] ?? '#555555'}>{t}</text>)}
                  </box>
                </box>
              </box>
            );
          })}
          {CATALOG.length > MAX_VISIBLE && <text fg="#333333">  {scroll + MAX_VISIBLE < CATALOG.length ? '↓ more' : '─ end'}</text>}
        </box>
        {selected && (
          <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} borderStyle="single" borderColor="#2a2a2a">
            <text fg="#e8e8e8"><strong>{selected.name}</strong></text>
            <text fg="#555555">{selected.family}  ·  min {selected.minVram}</text>
            <box marginTop={1}><text fg="#888888">{selected.desc}</text></box>
            {phase === 'list'
              ? <box marginTop={1}><text fg="#a78bfa">↵ see download options</text></box>
              : (
                <box flexDirection="column" marginTop={1} gap={0}>
                  <text fg="#555555">Download as:</text>
                  {options.map((opt, i) => (
                    <box key={i} flexDirection="column">
                      <box gap={1}>
                        <text fg={i === optIdx ? '#a78bfa' : '#444444'}>{i === optIdx ? '▶' : ' '}</text>
                        <text fg={i === optIdx ? '#e8e8e8' : '#777777'}>{opt.label}</text>
                      </box>
                      {opt.note && i === optIdx && <text fg="#444444">  {opt.note}</text>}
                    </box>
                  ))}
                  {hfCliOk === false && options.some(o => o.format !== 'ollama') && (
                    <box marginTop={1} flexDirection="column">
                      <text fg="#f59e0b">⚠ huggingface-cli not found</text>
                      <text fg="#444444">pip3 install huggingface-hub</text>
                    </box>
                  )}
                  <box marginTop={1}><text fg="#333333">↑↓ select  ↵ download  Esc back</text></box>
                </box>
              )
            }
          </box>
        )}
      </box>
      <box marginTop={1}><text fg="#333333">↑↓ navigate  ↵ select  Esc back</text></box>
    </box>
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
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') setSel(m => m === 'docker' ? 'native' : 'docker');
    if (key.name === 'return') onSelect(sel);
    if (key.name === 'escape') onCancel();
  });
  const opts = [
    { id: 'docker' as const, label: 'Docker  (recommended)', desc: 'Official image. Isolated. Requires Docker + nvidia-container-toolkit.' },
    { id: 'native' as const, label: 'Native  (pip)',         desc: 'pip install. No Docker needed. May conflict with existing PyTorch.'   },
  ];
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>{intent === 'install' ? 'Install' : 'Start'} {backend.label}</strong></text>
      <text fg="#666666">Choose install method:</text>
      {opts.map(m => (
        <box key={m.id} gap={2} marginTop={1}>
          <text fg={sel === m.id ? '#a78bfa' : '#333333'}>{sel === m.id ? '▶' : ' '}</text>
          <box flexDirection="column">
            {sel === m.id
              ? <text fg="#e8e8e8"><strong>{m.label}</strong></text>
              : <text fg="#777777">{m.label}</text>
            }
            <text fg="#444444">{m.desc}</text>
          </box>
        </box>
      ))}
      <box marginTop={1}><text fg="#333333">↑↓ select  ↵ confirm  Esc back</text></box>
    </box>
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
  useKeyboard((key) => { if (key.name === 'escape') onCancel(); });
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>Start {backend.label} ({method})</strong></text>
      <text fg="#666666">Enter a model to load:</text>
      <text fg="#444444">{MODEL_PLACEHOLDER[backend.type]}</text>
      <box borderStyle="rounded" borderColor="#4a9eff" paddingLeft={2} paddingRight={2} marginTop={1}>
        <text fg="#a78bfa">{'→ '}</text>
        <input value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSubmit(v.trim()); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]}
          width={40} />
      </box>
      <box marginTop={1}><text fg="#333333">↵ confirm  Esc back</text></box>
    </box>
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
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') setFocus(f => f === 'confirm' ? 'cancel' : 'confirm');
    if (key.name === 'return')  focus === 'confirm' ? onConfirm() : onCancel();
    if (key.name === 'escape')  onCancel();
  });
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>{action.title}</strong></text>
      {action.requirements.length > 0 && (
        <box flexDirection="column">
          <text fg="#555555">Requirements:</text>
          {action.requirements.map((r, i) => (
            <box key={i} gap={2}>
              <text fg={r.met ? '#22c55e' : '#ef4444'}>{r.met ? '✓' : '✗'}</text>
              <text fg={r.met ? '#aaaaaa' : '#ef4444'}>{r.name}</text>
              {!r.met && r.hint && <text fg="#444444">— {r.hint}</text>}
            </box>
          ))}
        </box>
      )}
      <box flexDirection="column">
        <text fg="#555555">Will run:</text>
        {action.steps.map((s, i) => (
          <text key={i} fg="#e8e8e8">  {s.command} {s.args.slice(0, 6).join(' ')}{s.args.length > 6 ? ' …' : ''}</text>
        ))}
      </box>
      {!allMet && <text fg="#f59e0b">⚠  Some requirements unmet — may fail.</text>}
      <box gap={4} marginTop={1}>
        {focus === 'confirm'
          ? <text fg="#a78bfa"><strong>▶ Run</strong></text>
          : <text fg="#444444">  Run</text>
        }
        {focus === 'cancel'
          ? <text fg="#ef4444"><strong>▶ Cancel</strong></text>
          : <text fg="#444444">  Cancel</text>
        }
      </box>
      <box marginTop={1}><text fg="#333333">↑↓ select  ↵ confirm  Esc cancel</text></box>
    </box>
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

  useKeyboard((key) => {
    if (customMode) {
      if (key.name === 'escape') setCustomMode(false);
      return;
    }
    if (key.name === 'escape')    { onCancel(); return; }
    if (key.name === 'up')   setSelIdx(i => Math.max(0, i - 1));
    if (key.name === 'down') setSelIdx(i => Math.min(totalSlots - 1, i + 1));
    if (key.name === 'return') {
      if (selIdx < models.length) onSelect(models[selIdx].id);
      else setCustomMode(true);
    }
    if (key.sequence === 'c' || key.sequence === 'C') { setSelIdx(models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === models.length;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor="#a78bfa">
      <text fg="#e8e8e8"><strong>LM Studio — Select Model</strong></text>
      <text fg="#555555">Models available from LM Studio local server (port 1234)</text>

      {models.length === 0 ? (
        <box flexDirection="column" marginTop={1} gap={0}>
          <text fg="#f59e0b">⚠  No models detected</text>
          <text fg="#555555">Load a model in LM Studio → Local Server tab, then come back.</text>
          <text fg="#555555">Or enter a custom model ID below.</text>
        </box>
      ) : (
        <box flexDirection="column" marginTop={1}>
          {models.map((m, i) => (
            <box key={m.id} gap={2}>
              <text fg={i === selIdx ? '#a78bfa' : '#333333'}>{i === selIdx ? '▶' : ' '}</text>
              <text fg={i === selIdx ? '#e8e8e8' : '#777777'}>{m.id}</text>
              {m.size && <text fg="#444444">{m.size}</text>}
            </box>
          ))}
        </box>
      )}

      <box gap={2} marginTop={models.length === 0 ? 1 : 0}>
        <text fg={isCustomSlot ? '#a78bfa' : '#333333'}>{isCustomSlot ? '▶' : ' '}</text>
        {customMode
          ? <box borderStyle="rounded" borderColor="#4a9eff" paddingLeft={1} paddingRight={1}>
              <input value={customValue} onInput={(v: string) => setCustomValue(v)}
                onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSelect(v.trim()); }}
                placeholder="enter model ID (e.g. lmstudio-community/Meta-Llama-3-8B)"
                width={40} />
            </box>
          : <text fg={isCustomSlot ? '#e8e8e8' : '#555555'}>custom model ID  <text fg="#333333">(press c)</text></text>
        }
      </box>

      <text fg="#333333">↑↓ select  ↵ use model  c custom  Esc back</text>
    </box>
  );
};

// ─────────────────────────────────────────────────────────────────
// ResultView
// ─────────────────────────────────────────────────────────────────
const ResultView: React.FC<{ success: boolean; message: string; onDone: () => void }> = ({ success, message, onDone }) => {
  useKeyboard((key) => { if (key.name === 'return' || key.name === 'escape') onDone(); });
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} borderStyle="double" borderColor={success ? '#22c55e' : '#ef4444'}>
      <text fg={success ? '#22c55e' : '#ef4444'}><strong>{success ? '✓  Done' : '✗  Failed'}</strong></text>
      <text fg="#aaaaaa">{message}</text>
      {success && (
        <box flexDirection="column" marginTop={1}>
          <text fg="#555555">Active provider is used automatically for all future sessions.</text>
          <text fg="#555555">Use /provider to view or switch providers in-session.</text>
        </box>
      )}
      <box marginTop={1}><text fg="#333333">↵ or Esc to continue</text></box>
    </box>
  );
};
