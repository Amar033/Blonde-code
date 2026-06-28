import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import { FlowerBackground } from '../components/FlowerBackground.js';
import { execSync } from 'child_process';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { LOGO_OPTIONS } from '../components/BrandMark.js';
import { providerRegistry } from '../../planner/provider-registry.js';
import { loadUiConfig, saveUiConfig } from '../../services/ui-config.js';
import { brandArtFor, getUsername, pickGreeting } from '../brand.js';
import { theme } from '../theme.js';
import os from 'os';
import fs from 'fs';
import path from 'path';

function getGitBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return null; }
}

function fmtDate(iso: string): string {
  const d    = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 7)  return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function centre(s: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}

function truncate(s: string, max: number): string {
  if (max <= 1) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const CWD = process.cwd().replace(os.homedir(), '~');

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
  const [task,      setTask]      = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [model,     setModel]     = useState(process.env.LLM_MODEL || '');
  const [provider,  setProvider]  = useState(process.env.LLM_PROVIDER || '');
  const [recent,    setRecent]    = useState<Session[]>([]);
  const [gitBranch]               = useState<string | null>(getGitBranch);
  const [customArt, setCustomArt] = useState<string[] | undefined>();
  const [greeting,  setGreeting]  = useState('');
  const [flowerBg,  setFlowerBg]  = useState(true);
  const inputRef = useRef<any>(null);
  const renderer = useRenderer();

  useEffect(() => {
    const mgr = new SessionManager();
    mgr.init()
      .then(() => mgr.loadAll())
      .then(sessions => setRecent(sessions.slice(0, 5)))
      .catch(() => {});

    providerRegistry.getActive().then(active => {
      if (active) {
        setProvider(`${active.type}:${active.name}`);
        setModel(active.model);
      }
    }).catch(() => {});

    loadUiConfig().then(cfg => {
      if (cfg.brandArt && cfg.brandArt.length > 0) setCustomArt(cfg.brandArt);
      if (cfg.flowerBg === false) setFlowerBg(false);
    }).catch(() => {});

    const name = getUsername();
    setGreeting(pickGreeting(name));
  }, []);

  // ── Layout: box is 60% of terminal, capped at 90 cols, min 44 ────────────────
  const boxWidth   = Math.min(90, Math.max(44, Math.floor(columns * 0.60)));
  const leftPad    = Math.max(0, Math.floor((columns - boxWidth) / 2));
  const innerWidth = boxWidth - 2; // inside border chars

  // ── Bottom bar ────────────────────────────────────────────────────────────────
  const leftBar  = `  ${CWD}${gitBranch ? `:${gitBranch}` : ''}`;
  const rightBar = `${provider}  ·  ${model}  `;
  const barPad   = Math.max(1, columns - leftBar.length - rightBar.length);
  const bottomBar = leftBar + ' '.repeat(barPad) + rightBar;

  const handleSubmit = () => {
    const v = task.trim();
    if (!v) return;
    setTask('');
    if (inputRef.current) inputRef.current.value = '';

    if (v === '/sessions' || v === 'sessions')  { onShowSessions(); return; }
    if (v === '/settings' || v === 'settings')  { onShowSettings(); return; }

    if (v === '/model' || v === '/models') {
      setStatusMsg(`current: ${model}  ·  ${provider}  ·  /model <name> to switch`);
      return;
    }
    if (v.startsWith('/model ')) {
      const m = v.slice(7).trim();
      if (m) { process.env.LLM_MODEL = m; setModel(m); setStatusMsg(`model → ${m}`); }
      return;
    }

    if (v === '/logo' || v === '/logos') {
      setStatusMsg(`logos: ${LOGO_OPTIONS.map(o => `/logo ${o.index} — ${o.label}`).join('  ·  ')}`);
      return;
    }
    if (v.startsWith('/logo ')) {
      const n = parseInt(v.slice(6).trim(), 10);
      const opt = LOGO_OPTIONS.find(o => o.index === n);
      setStatusMsg(opt ? `logo style ${n} (${opt.label})` : 'unknown logo — try /logo 1, /logo 2, /logo 3');
      return;
    }

    if (v === '/banner') {
      setStatusMsg('usage: /banner <path>  ·  /banner clear to reset');
      return;
    }
    if (v === '/banner clear' || v === '/banner reset') {
      saveUiConfig({ banner: undefined }).catch(() => {});
      setStatusMsg('banner reset');
      return;
    }
    if (v.startsWith('/banner ')) {
      const p = v.slice(8).trim().replace(/^~/, os.homedir());
      if (fs.existsSync(p)) {
        saveUiConfig({ banner: p }).catch(() => {});
        setStatusMsg(`banner → ${path.basename(p)} (Kitty required for display)`);
      } else {
        setStatusMsg(`file not found: ${p}`);
      }
      return;
    }

    if (v === '/background off' || v === '/bg off') {
      setFlowerBg(false);
      saveUiConfig({ flowerBg: false }).catch(() => {});
      setStatusMsg('flower background off  ·  /background on to restore');
      return;
    }
    if (v === '/background on' || v === '/bg on') {
      setFlowerBg(true);
      saveUiConfig({ flowerBg: true }).catch(() => {});
      setStatusMsg('flower background on');
      return;
    }

    if (v === '/provider' || v === '/providers') {
      providerRegistry.list().then(providers => {
        if (providers.length === 0) {
          setStatusMsg('no providers — /provider add <name> <type> <key> [model]');
        } else {
          setStatusMsg(providers.map(p => `${p.isActive ? '✓ ' : ''}${p.name} (${p.type}) ${p.model}`).join('  ·  '));
        }
      }).catch(() => setStatusMsg('could not load providers'));
      return;
    }
    if (v.startsWith('/provider ')) {
      const name = v.slice(10).trim();
      providerRegistry.setActive(name).then(ok => {
        if (!ok) { setStatusMsg(`provider "${name}" not found`); return; }
        providerRegistry.get(name).then((entry: any) => {
          if (entry) {
            setProvider(`${entry.type}:${entry.name}`);
            setModel(entry.model);
            process.env.LLM_PROVIDER = entry.type;
            process.env.LLM_MODEL    = entry.model;
            setStatusMsg(`provider → ${name} (${entry.type})`);
          }
        }).catch(() => {});
      }).catch(() => setStatusMsg('failed to switch provider'));
      return;
    }

    onStart(v);
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') { renderer.destroy(); return; }
    if (key.name === 'tab')           { onShowSessions(); return; }
    if (key.name === 'escape')        { setTask(''); if (inputRef.current) inputRef.current.value = ''; }
  });

  // ── NFO-style sessions: hand-drawn ASCII box, fixed to boxWidth ───────────────
  // Columns inside: name  ·  date(5)  ·  model(18)
  const dateW  = 5;
  const mdlW   = 18;
  // 2 side spaces + name + 2 + date + 2 + model + 2 side spaces = innerWidth
  const nameW  = Math.max(4, innerWidth - 2 - dateW - 2 - mdlW - 2);

  const nfoLines: Array<{ text: string; isBorder: boolean }> = [];
  if (recent.length > 0) {
    const barFull = '─'.repeat(innerWidth);
    const hdrNameS  = 'name'.padEnd(nameW);
    const hdrDateS  = 'when'.padEnd(dateW);
    const hdrMdlS   = 'model'.padEnd(mdlW);
    const headerRow = ' ' + hdrNameS + '  ' + hdrDateS + '  ' + hdrMdlS + ' ';

    nfoLines.push({ text: '┌' + barFull + '┐',       isBorder: true });
    nfoLines.push({ text: '│' + headerRow + '│',      isBorder: true });
    nfoLines.push({ text: '├' + barFull + '┤',        isBorder: true });

    for (const s of recent) {
      const nameCol = truncate(s.name || '(untitled)', nameW).padEnd(nameW);
      const dateCol = fmtDate(s.updatedAt).padEnd(dateW);
      const mdlCol  = truncate(s.model || '—', mdlW).padEnd(mdlW);
      const row = ' ' + nameCol + '  ' + dateCol + '  ' + mdlCol + ' ';
      nfoLines.push({ text: '│' + row + '│', isBorder: false });
    }

    nfoLines.push({ text: '└' + barFull + '┘', isBorder: true });
  }

  // ── Info line below input box ─────────────────────────────────────────────────
  const providerLabel = truncate(provider, Math.floor(boxWidth * 0.45));
  const modelLabel    = truncate(model, Math.floor(boxWidth * 0.45));
  const infoLine      = `${providerLabel}  ·  ${modelLabel}`;

  // ── Vertical centering ────────────────────────────────────────────────────────
  const artRows    = brandArtFor(columns, customArt).length;
  const blockRows  = artRows
    + 1  // greeting
    + 1  // gap
    + (statusMsg ? 1 : 0)
    + 3  // input box: top border + input row + bottom border
    + 1  // provider · model info
    + 1  // hints
    + (nfoLines.length > 0 ? nfoLines.length + 1 : 0)
    + 1; // bottom bar
  const topPad = Math.max(1, Math.floor((rows - blockRows) / 2) - 1);

  // ── Row centering helper: emit a full-width row with the content block at centre
  const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <box flexDirection="row" width={columns} shouldFill={false}>
      <box width={leftPad} shouldFill={false} />
      {children}
    </box>
  );

  return (
    <box flexDirection="column" width={columns} height={rows}>

      {/* ── Flower bloom background (absolute, renders behind content) ── */}
      {flowerBg && <FlowerBackground cols={columns} rows={rows} />}

      {/* ── Top spacer ── */}
      <box height={topPad} shouldFill={false} />

      {/* ── ASCII brand art (centered by string padding) ── */}
      {brandArtFor(columns, customArt).map((line, i) => (
        <box key={i} shouldFill={false}>
          <text fg={theme.brand}>{centre(line, columns)}</text>
        </box>
      ))}

      {/* ── Greeting — directly below banner, centered ── */}
      <box shouldFill={false}>
        <text fg={theme.text.dim}>{centre(greeting, columns)}</text>
      </box>

      {/* ── Gap ── */}
      <box height={1} shouldFill={false} />

      {/* ── Status message ── */}
      {statusMsg !== '' && (
        <Row>
          <text fg={theme.text.link}>{`! ${truncate(statusMsg, innerWidth - 2)}`}</text>
        </Row>
      )}

      {/* ── Input box: clean single-line, no arrow, bordered ── */}
      <Row>
        <box width={boxWidth} borderStyle="rounded" borderColor={theme.border.active}>
          <input
            ref={inputRef}
            focused={true}
            value={task}
            onInput={(v: string) => setTask(v)}
            onSubmit={() => handleSubmit()}
            placeholder="Ask anything..."
            width={Math.max(10, boxWidth - 4)}
            textColor={theme.text.primary}
            cursorColor={theme.text.link}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
          />
        </box>
      </Row>

      {/* ── Provider · model — left-aligned to input box ── */}
      <box paddingLeft={leftPad + 1} shouldFill={false}>
        <text fg={theme.text.dim}>{infoLine}</text>
      </box>

      {/* ── Commands hint — left-aligned to input box ── */}
      <box paddingLeft={leftPad + 1} shouldFill={false}>
        <text fg={theme.text.dim}>{'tab  sessions    /settings    /model    /provider    /background off'}</text>
      </box>

      {/* ── NFO sessions box ── */}
      {nfoLines.length > 0 && (
        <>
          <box height={1} shouldFill={false} />
          {nfoLines.map((line, i) => (
            <Row key={i}>
              <text fg={line.isBorder ? theme.border.normal : theme.text.secondary}>
                {line.text}
              </text>
            </Row>
          ))}
        </>
      )}

      {/* ── Push bottom bar down ── */}
      <box flexGrow={1} shouldFill={false} />

      {/* ── Bottom status bar ── */}
      <box shouldFill={false}>
        <text fg={theme.text.dim}>{bottomBar.slice(0, columns)}</text>
      </box>

    </box>
  );
};
