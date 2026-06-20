import React, { useState, useEffect } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
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

// ── Layout helpers ────────────────────────────────────────────────────────────
const p  = (s: string, w: number) => s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
const tr = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s;

// ── Cloud provider definitions ────────────────────────────────────────────────
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
      'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o',
      'google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-chat', 'qwen/qwen3-235b-a22b',
      'arcee-ai/trinity-large-preview:free', 'mistralai/mistral-large',
    ],
  },
];

const maskKey = (k: string) =>
  k.length <= 10 ? '****' : `${k.slice(0, 7)}****${k.slice(-4)}`;

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'backends' | 'providers' | 'models' | 'cookbooks';

type Mode =
  | { kind: 'browse' }
  | { kind: 'method-select';         backend: BackendInfo; intent: 'install' | 'start' }
  | { kind: 'model-input';           backend: BackendInfo; method: InstallMethod }
  | { kind: 'switch-model';          backend: BackendInfo }
  | { kind: 'lmstudio-model-select'; backend: BackendInfo }
  | { kind: 'configure';             backend: BackendInfo }
  | { kind: 'download-model' }
  | { kind: 'api-key-input';         cloudType: CloudProviderType; editMode: boolean }
  | { kind: 'cloud-model-select';    cloudType: CloudProviderType; apiKey: string }
  | { kind: 'permission';            action: BackendAction; backend: BackendInfo }
  | { kind: 'running';               action: BackendAction; backend: BackendInfo }
  | { kind: 'result';                success: boolean; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────
const DESCRIPTIONS: Record<BackendType, string> = {
  ollama:   'Easy local model runner. Zero-friction, single-user development.',
  vllm:     'High-throughput GPU serving with PagedAttention. Production-grade.',
  llamacpp: 'Max control: speculative decoding, Flash Attn, CPU+GPU hybrid.',
  sglang:   '3.1x faster than vLLM on DeepSeek. Best TTFT for multi-turn chat.',
  lmstudio: 'Desktop GUI. Runs an OpenAI-compatible server on :1234 when active.',
  airllm:   'Layer-by-layer GPU loading. Run 70B models on 4 GB VRAM.',
};

const PORTS: Record<BackendType, number> = {
  ollama: 11434, vllm: 8000, llamacpp: 8080, sglang: 30000, lmstudio: 1234, airllm: 8002,
};

const MODEL_PLACEHOLDER: Record<BackendType, string> = {
  ollama:   '',
  vllm:     'meta-llama/Llama-3.1-8B-Instruct',
  llamacpp: '/path/to/model.gguf',
  sglang:   'meta-llama/Llama-3.1-8B-Instruct',
  lmstudio: '',
  airllm:   'meta-llama/Llama-3.1-8B-Instruct',
};

// ── Main SettingsScreen ───────────────────────────────────────────────────────
interface Props { onBack: () => void; }

export const SettingsScreen: React.FC<Props> = ({ onBack }) => {
  const { width: cols, height: rows } = useTerminalDimensions();
  const renderer = useRenderer();
  const [tab,             setTab]             = useState<Tab>('backends');
  const [backends,        setBackends]        = useState<BackendInfo[]>([]);
  const [caps,            setCaps]            = useState<SystemCapabilities>({ hasCuda: false, hasDocker: false, hasNvidiaContainerToolkit: false });
  const [loading,         setLoading]         = useState(true);
  const [selected,        setSelected]        = useState(0);
  const [providerSelected,setProviderSelected]= useState(0);
  const [providerEntries, setProviderEntries] = useState<Array<ProviderEntry & { isActive: boolean }>>([]);
  const [mode,            setMode]            = useState<Mode>({ kind: 'browse' });

  const refreshBackends  = () => detectBackends().then(setBackends).catch(() => {});
  const refreshProviders = () => providerRegistry.list().then(setProviderEntries).catch(() => {});

  useEffect(() => {
    Promise.all([detectBackends(), checkSystemCapabilities()])
      .then(([b, c]) => { setBackends(b); setCaps(c); setLoading(false); })
      .catch(() => setLoading(false));
    refreshProviders();
  }, []);

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
      if (b.type === 'lmstudio') { setMode({ kind: 'lmstudio-model-select', backend: b }); return; }
      const step = buildStopStep(b.type, b.runningInDocker);
      const action: BackendAction = { title: `Stop ${b.label}`, method: 'native', requirements: [], steps: [step], modelRequired: false };
      setMode({ kind: 'permission', action, backend: b });
    }
  };

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

  // Global Ctrl+C
  useKeyboard((key) => { if (key.ctrl && key.name === 'c') renderer.destroy(); });

  const panelW = Math.min(110, Math.max(70, Math.floor(cols * 0.82)));
  const lp     = Math.max(0, Math.floor((cols - panelW) / 2));

  if (mode.kind === 'method-select') return (
    <MethodSelectView backend={mode.backend} intent={mode.intent} cols={cols} rows={rows}
      onSelect={(method) => {
        const { backend, intent } = mode;
        if (intent === 'install') setMode({ kind: 'permission', action: buildInstallAction(backend.type, method, caps), backend });
        else if (backend.type === 'ollama') setMode({ kind: 'permission', action: buildStartAction(backend.type, method, caps, ''), backend });
        else setMode({ kind: 'model-input', backend, method });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'model-input') return (
    <ModelInputView backend={mode.backend} method={mode.method} cols={cols} rows={rows}
      onSubmit={(model) => setMode({ kind: 'permission', action: buildStartAction(mode.backend.type, mode.method, caps, model), backend: mode.backend })}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'switch-model') return (
    <SwitchModelView backend={mode.backend} caps={caps} cols={cols} rows={rows}
      onConfirm={(model, method, flags) => {
        const cmd = buildSwitchShellCmd(mode.backend.type, method, model, flags, caps.hasCuda);
        const action: BackendAction = { title: `Switch ${mode.backend.label} to ${model}`, method, requirements: [], steps: [{ label: 'Stop + start with new model', command: 'sh', args: ['-c', cmd] }], modelRequired: true };
        setMode({ kind: 'permission', action, backend: mode.backend });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'configure') return (
    <ConfigureView backend={mode.backend} caps={caps} cols={cols} rows={rows}
      onApply={async (model, method, flags) => {
        await saveConfig(mode.backend.type, { model, method, flags });
        const cmd = buildSwitchShellCmd(mode.backend.type, method, model, flags, caps.hasCuda);
        const action: BackendAction = { title: `Reconfigure ${mode.backend.label}`, method, requirements: [], steps: [{ label: 'Apply new config (stop + restart)', command: 'sh', args: ['-c', cmd] }], modelRequired: false };
        setMode({ kind: 'permission', action, backend: mode.backend });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'download-model') return (
    <CatalogView caps={caps} cols={cols} rows={rows}
      onDownload={(option) => {
        const dummy: BackendInfo = { type: option.backends[0] ?? 'ollama', label: 'Download', port: 0, status: 'not-installed', models: [], runningInDocker: false };
        const action: BackendAction = { title: `Download ${option.label}`, method: 'native', requirements: [], steps: [{ label: option.label, command: option.command, args: option.args }], modelRequired: false };
        setMode({ kind: 'permission', action, backend: dummy });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'api-key-input') {
    const cpd = CLOUD_PROVIDERS.find(x => x.type === mode.cloudType)!;
    const existing = providerEntries.find(e => e.type === cpd.providerType);
    return <ApiKeyInputView providerDef={cpd} editMode={mode.editMode} currentKey={existing?.apiKey} cols={cols} rows={rows}
      onSubmit={(apiKey) => setMode({ kind: 'cloud-model-select', cloudType: mode.cloudType, apiKey })}
      onCancel={() => setMode({ kind: 'browse' })} />;
  }

  if (mode.kind === 'cloud-model-select') {
    const cpd = CLOUD_PROVIDERS.find(x => x.type === mode.cloudType)!;
    const existing = providerEntries.find(e => e.type === cpd.providerType);
    return <CloudModelSelectView providerDef={cpd} apiKey={mode.apiKey} currentModel={existing?.model} cols={cols} rows={rows}
      onSelect={async (model) => {
        await providerRegistry.add({ name: cpd.type, type: cpd.providerType, apiKey: mode.apiKey, model });
        await providerRegistry.setActive(cpd.type);
        refreshProviders();
        setMode({ kind: 'result', success: true, message: `${cpd.label} configured — model "${model}" set as active provider.` });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />;
  }

  if (mode.kind === 'permission') return (
    <PermissionView action={mode.action} cols={cols} rows={rows}
      onConfirm={() => setMode({ kind: 'running', action: mode.action, backend: mode.backend })}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'running') {
    const step = mode.action.steps[0];
    const isStop = mode.action.title.startsWith('Stop');
    const isDl   = mode.action.title.startsWith('Download');
    return (
      <box flexDirection="column" width={cols} height={rows}>
        <box flexGrow={1} />
        <box flexDirection="row" width={cols}>
          <box width={lp} />
          <box width={panelW} flexDirection="column">
            <box><text fg="#a78bfa">{mode.action.title}</text></box>
            <box><text fg="#555555">Running — please wait…</text></box>
            {step && (
              <ProcessStream command={step.command} args={step.args}
                onDone={(code) => {
                  refreshBackends();
                  if (code === 0 && !isStop && !isDl) {
                    providerRegistry.add({
                      name: mode.backend.type, type: mode.backend.type === 'ollama' ? 'ollama' : 'openai-compatible',
                      model: mode.backend.type === 'ollama' ? (process.env.LLM_MODEL ?? 'llama3:latest') : 'default',
                      baseURL: mode.backend.type !== 'ollama' ? `http://localhost:${PORTS[mode.backend.type]}/v1` : undefined,
                    }).catch(() => {});
                  }
                  const msg = isDl ? (code === 0 ? 'Download complete.' : 'Download failed.')
                    : code === 0 ? (isStop ? `${mode.backend.label} stopped.` : `${mode.backend.label} ready — registered as provider "${mode.backend.type}".`)
                    : `Command failed (exit ${code}).`;
                  setMode({ kind: 'result', success: code === 0, message: msg });
                }} />
            )}
          </box>
        </box>
        <box flexGrow={1} />
      </box>
    );
  }

  if (mode.kind === 'lmstudio-model-select') return (
    <LmStudioModelSelectView backend={mode.backend} cols={cols} rows={rows}
      onSelect={async (model) => {
        await providerRegistry.add({ name: 'lmstudio', type: 'openai-compatible', model, baseURL: 'http://localhost:1234/v1' });
        await providerRegistry.setActive('lmstudio');
        refreshProviders();
        setMode({ kind: 'result', success: true, message: `LM Studio configured — model "${model}" set as active provider.` });
      }}
      onCancel={() => setMode({ kind: 'browse' })} />
  );

  if (mode.kind === 'result') return (
    <ResultView success={mode.success} message={mode.message} cols={cols} rows={rows}
      onDone={() => { setMode({ kind: 'browse' }); refreshBackends(); refreshProviders(); }} />
  );

  // ── Browse ────────────────────────────────────────────────────────────────────
  const TABS: Tab[] = ['backends', 'providers', 'models', 'cookbooks'];
  return (
    <BrowseView
      tab={tab} tabs={TABS} backends={backends} loading={loading}
      selected={selected} providerSelected={providerSelected}
      caps={caps} providerEntries={providerEntries}
      cols={cols} rows={rows}
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
      onProviderRemove={async (cpd) => { await providerRegistry.remove(cpd.type).catch(() => {}); refreshProviders(); }}
      onSwitchModel={(b) => b.type === 'lmstudio' ? setMode({ kind: 'lmstudio-model-select', backend: b }) : setMode({ kind: 'switch-model', backend: b })}
      onConfigure={(b) => setMode({ kind: 'configure', backend: b })}
      onBrowseCatalog={() => setMode({ kind: 'download-model' })}
    />
  );
};

// ── BrowseView ────────────────────────────────────────────────────────────────
interface BrowseViewProps {
  tab: Tab; tabs: Tab[]; backends: BackendInfo[];
  loading: boolean; selected: number; providerSelected: number;
  caps: SystemCapabilities; providerEntries: Array<ProviderEntry & { isActive: boolean }>;
  cols: number; rows: number;
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

const BrowseView: React.FC<BrowseViewProps> = (props) => {
  const {
    tab, tabs, backends, loading, selected, providerSelected, caps, providerEntries,
    cols, rows, onTabChange, onSelectChange, onProviderSelectChange, onBack, onRefresh,
    onBackendAction, onProviderAction, onProviderEditKey, onProviderChangeModel,
    onProviderRemove, onSwitchModel, onConfigure, onBrowseCatalog,
  } = props;

  useKeyboard((key) => {
    if (key.name === 'escape') { onBack(); return; }
    if (key.name === 'tab')    { onTabChange(tabs[(tabs.indexOf(tab) + 1) % tabs.length]); return; }

    if (tab === 'backends' && !loading) {
      if (key.name === 'up')   onSelectChange(Math.max(0, selected - 1));
      if (key.name === 'down') onSelectChange(Math.min(backends.length - 1, selected + 1));
      if (key.name === 'return') { const b = backends[selected]; if (b) onBackendAction(b); }
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
      if (key.name === 'return')                           onProviderAction(cpd);
      if (key.sequence === 'k' || key.sequence === 'K')   onProviderEditKey(cpd);
      if (key.sequence === 'm' || key.sequence === 'M')   onProviderChangeModel(cpd);
      if (key.sequence === 'x' || key.sequence === 'X')   onProviderRemove(cpd).catch(() => {});
    }

    if (tab === 'models') {
      if (key.name === 'return' || key.sequence === 'd' || key.sequence === 'D') onBrowseCatalog();
    }
  });

  // ── Panel dimensions ────────────────────────────────────────────────────────
  const panelW = Math.min(110, Math.max(70, Math.floor(cols * 0.82)));
  const lp     = Math.max(0, Math.floor((cols - panelW) / 2));
  const inner  = panelW - 2;
  const hr     = '─'.repeat(inner);

  // ── Tab header row ──────────────────────────────────────────────────────────
  const tabStr = tabs.map(t => tab === t ? `[${t}]` : t).join('  ');
  const hint   = 'tab  esc back';
  const tabRow = ' ' + tabStr + ' '.repeat(Math.max(1, inner - tabStr.length - hint.length - 2)) + hint + ' ';

  // ── Build content lines ─────────────────────────────────────────────────────
  type L = { text: string; color: string };
  const lines: L[] = [];
  const dim  = (text: string) => lines.push({ text, color: '#333333' });
  const sec  = (text: string, color = '#aaaaaa') => lines.push({ text, color });

  dim('┌' + hr + '┐');
  sec('│' + p(' BLONDE  ·  SETTINGS', inner) + '│', '#a78bfa');
  dim('├' + hr + '┤');
  lines.push({ text: '│' + tabRow + '│', color: tab === 'backends' ? '#e8e8e8' : '#aaaaaa' });
  dim('├' + hr + '┤');

  if (tab === 'backends') {
    // System info
    const sysStr = ` CUDA ${caps.hasCuda ? '✓' : '✗'}   Docker ${caps.hasDocker ? '✓' : '✗'}   nvidia-ct ${caps.hasNvidiaContainerToolkit ? '✓' : '✗'}${caps.pythonVersion ? `   ${caps.pythonVersion}` : ''}`;
    sec('│ system ' + p(sysStr, inner - 8) + '│', '#555555');
    dim('├' + hr + '┤');

    if (loading) {
      sec('│' + p('  detecting backends…', inner) + '│', '#555555');
    } else {
      const labelW = 16; const statW = 14; const portW = 8;
      const actionW = inner - 2 - labelW - statW - portW - 3;
      for (let i = 0; i < backends.length; i++) {
        const b     = backends[i]!;
        const isSel = i === selected;
        const sel   = isSel ? '▶' : ' ';
        const lbl   = p(b.label, labelW);
        const stat  = p(b.status === 'running' ? '● running' : b.status === 'installed' ? '○ installed' : '○ not-install', statW);
        const port  = p(`:${b.port}`, portW);
        const action = actionHint(b).slice(0, actionW);
        const row = `│ ${sel} ${lbl} ${stat} ${port} ${p(action, actionW)} │`;
        lines.push({ text: row, color: isSel ? '#e8e8e8' : '#666666' });
      }
    }

    // Detail panel for selected backend
    const sel = backends[selected];
    if (sel) {
      dim('├' + hr + '┤');
      const statusLabel = sel.status === 'running' ? '● running' : sel.status === 'installed' ? '○ installed' : '○ not-install';
      sec('│ ' + p(`${sel.label}  ${statusLabel}  :${sel.port}`, inner - 2) + ' │', '#aaaaaa');
      sec('│ ' + p(tr(DESCRIPTIONS[sel.type], inner - 2), inner - 2) + ' │', '#555555');
      if (sel.status === 'running' && sel.models.length > 0) {
        const mdlStr = sel.models.slice(0, 4).map(m => m.size ? `${m.id}(${m.size})` : m.id).join(' · ');
        sec('│ ' + p(`models: ${tr(mdlStr, inner - 10)}`, inner - 2) + ' │', '#4a9eff');
      }
      if (sel.type === 'lmstudio' && sel.status === 'installed') {
        sec('│ ' + p('Open LM Studio → Developer tab → Start Server, then press r', inner - 2) + ' │', '#f59e0b');
      }
      if (sel.runningInDocker) {
        sec('│ ' + p(`container: blonde-${sel.type}`, inner - 2) + ' │', '#444444');
      }
    }

  } else if (tab === 'providers') {
    sec('│ ' + p('Cloud providers — API keys at ~/.blonde/providers.json', inner - 2) + ' │', '#555555');
    dim('├' + hr + '┤');

    const labelW = 12; const statW = 16; const mdlW = inner - 2 - labelW - statW - 12;
    for (let i = 0; i < CLOUD_PROVIDERS.length; i++) {
      const cpd   = CLOUD_PROVIDERS[i]!;
      const entry = providerEntries.find(e => e.type === cpd.providerType);
      const isSel = i === providerSelected;
      const sel   = isSel ? '▶' : ' ';
      const lbl   = p(cpd.label, labelW);
      const conf  = entry?.apiKey ? '● configured' : '○ not configured';
      const stat  = p(conf, statW);
      const mdl   = entry?.model ? tr(entry.model, mdlW) : '';
      const active = entry?.isActive ? '  ACTIVE' : '';
      const row = `│ ${sel} ${lbl} ${stat} ${p(mdl + active, mdlW)} │`;
      lines.push({ text: row, color: isSel ? '#e8e8e8' : '#666666' });
    }

    const cpd = CLOUD_PROVIDERS[providerSelected];
    const selEntry = cpd ? providerEntries.find(e => e.type === cpd.providerType) : undefined;
    if (cpd) {
      dim('├' + hr + '┤');
      sec('│ ' + p(`${cpd.label}  —  ${tr(cpd.desc, inner - cpd.label.length - 6)}`, inner - 2) + ' │', '#aaaaaa');
      if (selEntry?.apiKey) {
        sec('│ ' + p(`key: ${maskKey(selEntry.apiKey)}   model: ${selEntry.model}`, inner - 2) + ' │', '#4a9eff');
        sec('│ ' + p(`env: ${cpd.keyEnvVar}`, inner - 2) + ' │', '#555555');
        sec('│ ' + p(`enter set-active/deactivate   k edit-key   m model   x remove`, inner - 2) + ' │', '#a78bfa');
      } else {
        sec('│ ' + p(`key format: ${cpd.keyHint}   env: ${cpd.keyEnvVar}`, inner - 2) + ' │', '#555555');
        sec('│ ' + p('enter or k — enter API key to configure', inner - 2) + ' │', '#a78bfa');
      }
    }

  } else if (tab === 'models') {
    const running = backends.filter(b => b.status === 'running');
    if (running.length === 0) {
      sec('│ ' + p('No local backends running. Start one in the Backends tab first.', inner - 2) + ' │', '#555555');
    } else {
      for (const b of running) {
        sec('│ ' + p(b.label, inner - 2) + ' │', '#a78bfa');
        if (b.models.length === 0) {
          sec('│ ' + p('  no models loaded', inner - 2) + ' │', '#555555');
        } else {
          for (const m of b.models) {
            sec('│ ' + p(`  ${m.id}${m.size ? `  (${m.size})` : ''}`, inner - 2) + ' │', '#e8e8e8');
          }
        }
      }
    }
    dim('├' + hr + '┤');
    sec('│ ' + p('Browse & Download Models — Ollama · HuggingFace · GGUF (bartowski)', inner - 2) + ' │', '#aaaaaa');
    sec('│ ' + p('enter — open model catalog', inner - 2) + ' │', '#a78bfa');

  } else {
    sec('│ ' + p('Built-in presets — tuned for local inference', inner - 2) + ' │', '#555555');
    dim('├' + hr + '┤');
    for (const c of COOKBOOKS) {
      sec('│ ' + p(`${p(c.name, 14)}  ${p(c.model, 24)}  temp ${c.temp}  ctx ${c.ctx}`, inner - 2) + ' │', '#aaaaaa');
      sec('│ ' + p(`  ${c.desc}`, inner - 2) + ' │', '#555555');
    }
    sec('│ ' + p('Custom cookbooks: ~/.blonde/cookbooks/*.json  (coming soon)', inner - 2) + ' │', '#333333');
  }

  dim('└' + hr + '┘');

  // Hints
  const hints: Record<Tab, string> = {
    backends:  '↑↓ select  enter action  s switch  c configure  r refresh  tab switch  esc back',
    providers: '↑↓ select  enter set-active  k edit-key  m model  x remove  tab switch  esc back',
    models:    'enter browse model catalog  tab switch  esc back',
    cookbooks: 'tab switch  esc back',
  };

  return (
    <box flexDirection="column" width={cols} height={rows}>
      <box flexGrow={1} />
      {lines.map((line, i) => (
        <box key={i} paddingLeft={lp}>
          <text fg={line.color}>{line.text}</text>
        </box>
      ))}
      <box paddingLeft={lp + 2}>
        <text fg="#444444">{hints[tab]}</text>
      </box>
      <box flexGrow={1} />
    </box>
  );
};

// ── Action hint helper ────────────────────────────────────────────────────────
function actionHint(b: BackendInfo): string {
  if (b.status === 'running') {
    if (isDesktopApp(b.type)) return 'enter select model';
    if (b.type === 'airllm')  return 'enter stop  s switch';
    return b.type === 'ollama' ? 'enter stop' : 'enter stop  s switch  c configure';
  }
  if (b.status === 'installed') {
    if (isDesktopApp(b.type)) return 'start server in LM Studio app';
    return 'enter start';
  }
  if (isDesktopApp(b.type)) return 'open lmstudio.ai';
  return 'enter install';
}

// ── Cookbooks ─────────────────────────────────────────────────────────────────
const COOKBOOKS = [
  { name: 'fast-coding',  model: 'qwen3:0.6B → qwen3:8B', desc: 'Speculative decoding pair. ~1.9x speed boost.',             temp: '0.3', ctx: '4096'   },
  { name: 'balanced',     model: 'qwen3:8B Q4_K_M',        desc: '~60 tok/s. Best quality-per-VRAM.',                         temp: '0.7', ctx: '8192'   },
  { name: 'reasoning',    model: 'qwen3:14B Q4_K_M',       desc: '~35 tok/s. Best for architecture & debugging.',             temp: '0.6', ctx: '16384'  },
  { name: 'long-context', model: 'qwen3:8B ctx 128K',       desc: 'Full codebase in context. Needs extra VRAM.',               temp: '0.5', ctx: '131072' },
  { name: 'airllm-70b',  model: 'llama-3.3-70b / AirLLM', desc: 'Run 70B on 4 GB VRAM via layer-by-layer loading. Slower.',  temp: '0.6', ctx: '2048'   },
];

// ── Shared sub-view wrapper ────────────────────────────────────────────────────
const Panel: React.FC<{ cols: number; rows: number; color?: string; children: React.ReactNode }> = ({ cols, rows, color = '#a78bfa', children }) => {
  const panelW = Math.min(80, Math.max(50, Math.floor(cols * 0.65)));
  const lp     = Math.max(0, Math.floor((cols - panelW) / 2));
  return (
    <box flexDirection="column" width={cols} height={rows}>
      <box flexGrow={1} />
      <box flexDirection="row" width={cols}>
        <box width={lp} />
        <box width={panelW} flexDirection="column" borderStyle="double" borderColor={color}>
          {children}
        </box>
      </box>
      <box flexGrow={1} />
    </box>
  );
};

// ── MethodSelectView ──────────────────────────────────────────────────────────
const MethodSelectView: React.FC<{
  backend: BackendInfo; intent: 'install' | 'start'; cols: number; rows: number;
  onSelect: (m: InstallMethod) => void; onCancel: () => void;
}> = ({ backend, intent, cols, rows, onSelect, onCancel }) => {
  const [sel, setSel] = useState<InstallMethod>('docker');
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') setSel(m => m === 'docker' ? 'native' : 'docker');
    if (key.name === 'return') onSelect(sel);
    if (key.name === 'escape') onCancel();
  });
  const opts = [
    { id: 'docker' as const, label: 'Docker  (recommended)', desc: 'Official image. Isolated. Requires Docker + nvidia-container-toolkit.' },
    { id: 'native' as const, label: 'Native  (pip)',         desc: 'pip install. No Docker needed. May conflict with existing PyTorch.' },
  ];
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`${intent === 'install' ? 'Install' : 'Start'} ${backend.label}`}</text></box>
      <box><text fg="#666666">Choose install method:</text></box>
      {opts.map(m => (
        <box key={m.id} flexDirection="column">
          <box><text fg={sel === m.id ? '#a78bfa' : '#555555'}>{`${sel === m.id ? '▶' : ' '} ${m.label}`}</text></box>
          <box><text fg="#444444">{`    ${m.desc}`}</text></box>
        </box>
      ))}
      <box><text fg="#333333">↑↓ select  enter confirm  esc back</text></box>
    </Panel>
  );
};

// ── ModelInputView ────────────────────────────────────────────────────────────
const ModelInputView: React.FC<{
  backend: BackendInfo; method: InstallMethod; cols: number; rows: number;
  onSubmit: (model: string) => void; onCancel: () => void;
}> = ({ backend, method, cols, rows, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  useKeyboard((key) => { if (key.name === 'escape') onCancel(); });
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`Start ${backend.label} (${method})`}</text></box>
      <box><text fg="#666666">Enter a model to load:</text></box>
      <box><text fg="#444444">{MODEL_PLACEHOLDER[backend.type]}</text></box>
      <box borderStyle="rounded" borderColor="#4a9eff">
        <input value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSubmit(v.trim()); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]} width={40} />
      </box>
      <box><text fg="#333333">enter confirm  esc back</text></box>
    </Panel>
  );
};

// ── SwitchModelView ───────────────────────────────────────────────────────────
const SwitchModelView: React.FC<{
  backend: BackendInfo; caps: SystemCapabilities; cols: number; rows: number;
  onConfirm: (model: string, method: InstallMethod, flags: Record<string, string>) => void;
  onCancel: () => void;
}> = ({ backend, caps, cols, rows, onConfirm, onCancel }) => {
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
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`Switch Model — ${backend.label}`}</text></box>
      {config?.model && <box><text fg="#555555">{`current: ${config.model}`}</text></box>}
      {supportsDocker(backend.type) && (
        <box><text fg="#444444">{`method: [${method === 'docker' ? 'docker' : ' docker'}] [${method === 'native' ? 'native' : ' native'}]  ← →`}</text></box>
      )}
      <box><text fg="#555555">New model:</text></box>
      <box borderStyle="rounded" borderColor="#4a9eff">
        <input value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onConfirm(v.trim(), method, config?.flags ?? {}); }}
          placeholder={MODEL_PLACEHOLDER[backend.type]} width={40} />
      </box>
      <box><text fg="#333333">{`enter confirm  esc back${supportsDocker(backend.type) ? '  ← → method' : ''}`}</text></box>
    </Panel>
  );
};

// ── ConfigureView ─────────────────────────────────────────────────────────────
interface FieldState { def: { key: string; label: string; default: string; desc: string }; value: string; }

const ConfigureView: React.FC<{
  backend: BackendInfo; caps: SystemCapabilities; cols: number; rows: number;
  onApply: (model: string, method: InstallMethod, flags: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}> = ({ backend, caps, cols, rows, onApply, onCancel }) => {
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

  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`Configure ${backend.label}`}</text></box>
      {supportsDocker(backend.type) && (
        <box><text fg="#444444">{`method: [${method === 'docker' ? 'docker' : ' docker'}] [${method === 'native' ? 'native' : ' native'}]  ← →`}</text></box>
      )}
      <box flexDirection="column">
        <box><text fg={focusIdx === 0 ? '#e8e8e8' : '#666666'}>{`${focusIdx === 0 ? '▶' : ' '} model        ${model || '(not set)'}`}</text></box>
        {focusIdx === 0 && isEditing && (
          <box borderStyle="rounded" borderColor="#4a9eff">
            <input value={editValue} onInput={(v: string) => setEditValue(v)}
              onSubmit={() => { setModel(editValue); setIsEditing(false); }}
              placeholder="model name or path" width={40} />
          </box>
        )}
        {fields.map((f, i) => {
          const ri = i + 1; const isFoc = focusIdx === ri;
          return (
            <box key={f.def.key} flexDirection="column">
              <box><text fg={isFoc ? '#e8e8e8' : '#666666'}>{`${isFoc ? '▶' : ' '} ${p(f.def.label, 12)}  ${f.value || f.def.default}   ${f.def.desc}`}</text></box>
              {isFoc && isEditing && (
                <box borderStyle="rounded" borderColor="#4a9eff">
                  <input value={editValue} onInput={(v: string) => setEditValue(v)}
                    onSubmit={() => { setFields(fs => fs.map((fi, j) => j === i ? { ...fi, value: editValue } : fi)); setIsEditing(false); }}
                    placeholder={f.def.default} width={40} />
                </box>
              )}
            </box>
          );
        })}
      </box>
      <box><text fg={focusIdx === APPLY_IDX ? '#22c55e' : '#444444'}>{`${focusIdx === APPLY_IDX ? '▶' : ' '} Apply & Restart`}</text></box>
      <box><text fg={focusIdx === CANCEL_IDX ? '#ef4444' : '#444444'}>{`${focusIdx === CANCEL_IDX ? '▶' : ' '} Cancel`}</text></box>
      <box><text fg="#333333">↑↓ navigate  enter edit/confirm  esc cancel</text></box>
    </Panel>
  );
};

// ── ApiKeyInputView ───────────────────────────────────────────────────────────
const ApiKeyInputView: React.FC<{
  providerDef: CloudProviderDef; editMode: boolean; currentKey?: string;
  cols: number; rows: number;
  onSubmit: (apiKey: string) => void; onCancel: () => void;
}> = ({ providerDef, editMode, cols, rows, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  useKeyboard((key) => { if (key.name === 'escape') onCancel(); });
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`${editMode ? 'Update' : 'Add'} ${providerDef.label} API Key`}</text></box>
      <box><text fg="#555555">{providerDef.desc}</text></box>
      <box><text fg="#444444">{`Key format:  ${providerDef.keyHint}`}</text></box>
      <box><text fg="#444444">{`Env var:     ${providerDef.keyEnvVar}`}</text></box>
      <box><text fg="#444444">{'Stored at:   ~/.blonde/providers.json'}</text></box>
      <box borderStyle="rounded" borderColor="#4a9eff">
        <input value={value} onInput={(v: string) => setValue(v)}
          onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSubmit(v.trim()); }}
          placeholder={providerDef.keyHint} width={44} />
      </box>
      <box><text fg="#333333">Paste your API key and press enter  ·  esc cancel</text></box>
    </Panel>
  );
};

// ── CloudModelSelectView ──────────────────────────────────────────────────────
const CloudModelSelectView: React.FC<{
  providerDef: CloudProviderDef; apiKey: string; currentModel?: string;
  cols: number; rows: number;
  onSelect: (model: string) => void; onCancel: () => void;
}> = ({ providerDef, currentModel, cols, rows, onSelect, onCancel }) => {
  const defaultIdx = Math.max(0, providerDef.models.indexOf(currentModel ?? ''));
  const [selIdx,      setSelIdx]      = useState(defaultIdx);
  const [customMode,  setCustomMode]  = useState(false);
  const [customValue, setCustomValue] = useState('');

  useKeyboard((key) => {
    if (customMode) { if (key.name === 'escape') setCustomMode(false); return; }
    if (key.name === 'escape')    { onCancel(); return; }
    if (key.name === 'up')   setSelIdx(i => Math.max(0, i - 1));
    if (key.name === 'down') setSelIdx(i => Math.min(providerDef.models.length, i + 1));
    if (key.name === 'return') {
      if (selIdx < providerDef.models.length) onSelect(providerDef.models[selIdx]!);
      else setCustomMode(true);
    }
    if (key.sequence === 'c' || key.sequence === 'C') { setSelIdx(providerDef.models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === providerDef.models.length;
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{`Select Model — ${providerDef.label}`}</text></box>
      {providerDef.models.map((m, i) => (
        <box key={m}>
          <text fg={i === selIdx ? '#a78bfa' : '#666666'}>
            {`${i === selIdx ? '▶' : ' '} ${m}${m === currentModel ? '  (current)' : ''}`}
          </text>
        </box>
      ))}
      <box flexDirection="column">
        <box><text fg={isCustomSlot ? '#a78bfa' : '#555555'}>{`${isCustomSlot ? '▶' : ' '} custom model ID  (press c)`}</text></box>
        {customMode && (
          <box borderStyle="rounded" borderColor="#4a9eff">
            <input value={customValue} onInput={(v: string) => setCustomValue(v)}
              onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSelect(v.trim()); }}
              placeholder="enter custom model ID" width={40} />
          </box>
        )}
      </box>
      <box><text fg="#333333">↑↓ select  enter confirm  c custom  esc back</text></box>
    </Panel>
  );
};

// ── PermissionView ────────────────────────────────────────────────────────────
const PermissionView: React.FC<{
  action: BackendAction; cols: number; rows: number;
  onConfirm: () => void; onCancel: () => void;
}> = ({ action, cols, rows, onConfirm, onCancel }) => {
  const [focus, setFocus] = useState<'confirm' | 'cancel'>('confirm');
  const allMet = action.requirements.every(r => r.met);
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') setFocus(f => f === 'confirm' ? 'cancel' : 'confirm');
    if (key.name === 'return') focus === 'confirm' ? onConfirm() : onCancel();
    if (key.name === 'escape') onCancel();
  });
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">{action.title}</text></box>
      {action.requirements.length > 0 && (
        <box flexDirection="column">
          <box><text fg="#555555">Requirements:</text></box>
          {action.requirements.map((r, i) => (
            <box key={i}><text fg={r.met ? '#22c55e' : '#ef4444'}>{`${r.met ? '✓' : '✗'} ${r.name}${!r.met && r.hint ? `  — ${r.hint}` : ''}`}</text></box>
          ))}
        </box>
      )}
      <box flexDirection="column">
        <box><text fg="#555555">Will run:</text></box>
        {action.steps.map((s, i) => (
          <box key={i}><text fg="#e8e8e8">{`  ${s.command} ${s.args.slice(0, 6).join(' ')}${s.args.length > 6 ? ' …' : ''}`}</text></box>
        ))}
      </box>
      {!allMet && <box><text fg="#f59e0b">Some requirements unmet — may fail.</text></box>}
      <box><text fg={focus === 'confirm' ? '#a78bfa' : '#444444'}>{`${focus === 'confirm' ? '▶' : ' '} Run`}</text></box>
      <box><text fg={focus === 'cancel' ? '#ef4444' : '#444444'}>{`${focus === 'cancel' ? '▶' : ' '} Cancel`}</text></box>
      <box><text fg="#333333">↑↓ select  enter confirm  esc cancel</text></box>
    </Panel>
  );
};

// ── LmStudioModelSelectView ───────────────────────────────────────────────────
const LmStudioModelSelectView: React.FC<{
  backend: BackendInfo; cols: number; rows: number;
  onSelect: (model: string) => void; onCancel: () => void;
}> = ({ backend, cols, rows, onSelect, onCancel }) => {
  const models     = backend.models;
  const totalSlots = models.length + 1;
  const [selIdx,      setSelIdx]      = useState(0);
  const [customMode,  setCustomMode]  = useState(false);
  const [customValue, setCustomValue] = useState('');

  useKeyboard((key) => {
    if (customMode) { if (key.name === 'escape') setCustomMode(false); return; }
    if (key.name === 'escape')    { onCancel(); return; }
    if (key.name === 'up')   setSelIdx(i => Math.max(0, i - 1));
    if (key.name === 'down') setSelIdx(i => Math.min(totalSlots - 1, i + 1));
    if (key.name === 'return') {
      if (selIdx < models.length) onSelect(models[selIdx]!.id);
      else setCustomMode(true);
    }
    if (key.sequence === 'c' || key.sequence === 'C') { setSelIdx(models.length); setCustomMode(true); }
  });

  const isCustomSlot = selIdx === models.length;
  return (
    <Panel cols={cols} rows={rows}>
      <box><text fg="#e8e8e8">LM Studio — Select Model</text></box>
      <box><text fg="#555555">Models from LM Studio local server (port 1234)</text></box>
      {models.length === 0 && (
        <box flexDirection="column">
          <box><text fg="#f59e0b">No models detected</text></box>
          <box><text fg="#555555">Load a model in LM Studio → Local Server tab, then come back.</text></box>
        </box>
      )}
      {models.map((m, i) => (
        <box key={m.id}>
          <text fg={i === selIdx ? '#a78bfa' : '#666666'}>{`${i === selIdx ? '▶' : ' '} ${m.id}${m.size ? `  (${m.size})` : ''}`}</text>
        </box>
      ))}
      <box flexDirection="column">
        <box><text fg={isCustomSlot ? '#a78bfa' : '#555555'}>{`${isCustomSlot ? '▶' : ' '} custom model ID  (press c)`}</text></box>
        {customMode && (
          <box borderStyle="rounded" borderColor="#4a9eff">
            <input value={customValue} onInput={(v: string) => setCustomValue(v)}
              onSubmit={(v: any) => { if (typeof v === 'string' && v.trim()) onSelect(v.trim()); }}
              placeholder="e.g. lmstudio-community/Meta-Llama-3-8B" width={44} />
          </box>
        )}
      </box>
      <box><text fg="#333333">↑↓ select  enter use model  c custom  esc back</text></box>
    </Panel>
  );
};

// ── ResultView ────────────────────────────────────────────────────────────────
const ResultView: React.FC<{ success: boolean; message: string; cols: number; rows: number; onDone: () => void }> = ({ success, message, cols, rows, onDone }) => {
  useKeyboard((key) => { if (key.name === 'return' || key.name === 'escape') onDone(); });
  return (
    <Panel cols={cols} rows={rows} color={success ? '#22c55e' : '#ef4444'}>
      <box><text fg={success ? '#22c55e' : '#ef4444'}>{success ? '✓  Done' : '✗  Failed'}</text></box>
      <box><text fg="#aaaaaa">{message}</text></box>
      {success && (
        <box flexDirection="column">
          <box><text fg="#555555">Active provider is used for all future sessions.</text></box>
          <box><text fg="#555555">Use /provider to view or switch providers in-session.</text></box>
        </box>
      )}
      <box><text fg="#333333">enter or esc to continue</text></box>
    </Panel>
  );
};

// ── CatalogView ───────────────────────────────────────────────────────────────
const MAX_CAT_VISIBLE = 8;
const TAG_COLOR: Record<string, string> = { coding: '#4a9eff', general: '#a78bfa', fast: '#22c55e', reasoning: '#f59e0b', draft: '#555555', balanced: '#888888' };

const CatalogView: React.FC<{
  caps: SystemCapabilities; cols: number; rows: number;
  onDownload: (opt: DownloadOption) => void; onCancel: () => void;
}> = ({ caps, cols, rows, onDownload, onCancel }) => {
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
        if (next >= scroll + MAX_CAT_VISIBLE) setScroll(next - MAX_CAT_VISIBLE + 1);
      }
      if (key.name === 'return' && selected) setPhase('options');
    } else {
      if (key.name === 'up')   setOptIdx(i => Math.max(0, i - 1));
      if (key.name === 'down') setOptIdx(i => Math.min(options.length - 1, i + 1));
      if (key.name === 'return' && options[optIdx]) onDownload(options[optIdx]!);
    }
  });

  const panelW  = Math.min(100, Math.max(70, Math.floor(cols * 0.82)));
  const lp      = Math.max(0, Math.floor((cols - panelW) / 2));
  const listW   = 34;
  const detailW = panelW - listW - 4;
  const visible = CATALOG.slice(scroll, scroll + MAX_CAT_VISIBLE);

  return (
    <box flexDirection="column" width={cols} height={rows}>
      <box flexGrow={1} />
      <box flexDirection="row" width={cols}>
        <box width={lp} />
        <box width={panelW} flexDirection="column">
          <box><text fg="#a78bfa">{`Model Catalog — ${CATALOG.length} models · Ollama · HuggingFace · GGUF`}</text></box>
          <box flexDirection="row">
            {/* List column */}
            <box width={listW} flexDirection="column">
              {visible.map((m, vi) => {
                const absIdx = scroll + vi; const isSel = absIdx === modelIdx;
                return (
                  <box key={m.id} flexDirection="column">
                    <box><text fg={isSel ? '#e8e8e8' : '#777777'}>{`${isSel ? '▶' : ' '} ${tr(m.name, listW - 3)}`}</text></box>
                    <box><text fg="#444444">{`  ${m.minVram}  ${m.tags.slice(0, 2).join(' ')}`}</text></box>
                  </box>
                );
              })}
              {CATALOG.length > MAX_CAT_VISIBLE && (
                <box><text fg="#333333">{`  ${scroll + MAX_CAT_VISIBLE < CATALOG.length ? '↓ more' : '─ end'}`}</text></box>
              )}
            </box>
            {/* Detail column */}
            {selected && (
              <box width={detailW} flexDirection="column" borderStyle="single" borderColor="#2a2a2a">
                <box><text fg="#e8e8e8">{selected.name}</text></box>
                <box><text fg="#555555">{`${selected.family}  ·  min ${selected.minVram}`}</text></box>
                <box><text fg="#888888">{tr(selected.desc, detailW - 4)}</text></box>
                {phase === 'list' ? (
                  <box><text fg="#a78bfa">enter — see download options</text></box>
                ) : (
                  <box flexDirection="column">
                    <box><text fg="#555555">Download as:</text></box>
                    {options.map((opt, i) => (
                      <box key={i} flexDirection="column">
                        <box><text fg={i === optIdx ? '#a78bfa' : '#555555'}>{`${i === optIdx ? '▶' : ' '} ${opt.label}`}</text></box>
                        {opt.note && i === optIdx && <box><text fg="#444444">{`  ${opt.note}`}</text></box>}
                      </box>
                    ))}
                    {hfCliOk === false && options.some(o => o.format !== 'ollama') && (
                      <box flexDirection="column">
                        <box><text fg="#f59e0b">huggingface-cli not found</text></box>
                        <box><text fg="#444444">pip3 install huggingface-hub</text></box>
                      </box>
                    )}
                    <box><text fg="#333333">↑↓ select  enter download  esc back</text></box>
                  </box>
                )}
              </box>
            )}
          </box>
          <box><text fg="#333333">↑↓ navigate  enter select  esc back</text></box>
        </box>
      </box>
      <box flexGrow={1} />
    </box>
  );
};
