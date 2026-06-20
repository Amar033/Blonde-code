import React, { useState, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
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
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function centre(s: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
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
  const [model,     setModel]     = useState(process.env.LLM_MODEL || 'qwen3.5:latest');
  const [provider,  setProvider]  = useState(process.env.LLM_PROVIDER || 'ollama');
  const [recent,    setRecent]    = useState<Session[]>([]);
  const [gitBranch]               = useState<string | null>(getGitBranch);
  const [customArt, setCustomArt] = useState<string[] | undefined>();
  const [greeting,  setGreeting]  = useState('');
  const inputRef = useRef<any>(null);

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
    }).catch(() => {});

    const name = getUsername();
    setGreeting(pickGreeting(name));
  }, []);

  const divider = '─'.repeat(Math.max(0, columns - 4));

  // ── Centered input box width (65% of terminal, like OpenCode) ──────────────
  const inputWidth   = Math.min(columns - 8, Math.max(40, Math.floor(columns * 0.65)));
  const inputLeftPad = Math.floor((columns - inputWidth) / 2);

  // ── Sessions block width (matches input box) ───────────────────────────────
  const blockWidth = inputWidth;

  // ── Bottom bar: CWD:branch (left)   provider · model (right) ──────────────
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
    if (key.name === 'escape') { setTask(''); if (inputRef.current) inputRef.current.value = ''; }
  });

  // Build session rows as single strings (no two-<text> wrapping risk)
  // Columns: name (left) · date (fixed 11 chars) · model (fixed 16 chars)
  const dateW  = 11;
  const modelW = 16;
  const prefW  = 4; // "  ▸ "
  const nameW  = Math.max(6, blockWidth - prefW - dateW - modelW - 4); // 4 for separators

  const sessionLines = recent.map(s => {
    const date  = fmtDate(s.updatedAt).padEnd(dateW);
    const mdl   = (s.model || '—').slice(0, modelW).padEnd(modelW);
    const name  = s.name.slice(0, nameW).padEnd(nameW);
    return `  ▸ ${name}  ${date}  ${mdl}`;
  });

  // artRows: 7 wide / 5 narrow + 1 subtitle + 1 divider + sessions
  const artRows      = (columns >= 100 ? 7 : 5);
  const contentRows  = 2 /* greeting+gap */ + artRows + 2 /* sub+div */ + (recent.length > 0 ? 1 + recent.length : 0) + 2 /* spacer */ + 3 /* input */ + 1 /* hints */ + 1 /* bar */;
  const topPad       = Math.max(1, Math.min(6, Math.floor((rows - contentRows) / 3)));

  return (
    <box flexDirection="column" width={columns} height={rows}>

      {/* ── Greeting (top-left, subtle) ── */}
      <box paddingLeft={2}>
        <text fg={theme.text.dim}>{greeting}</text>
      </box>

      {/* ── Top spacer ── */}
      <box height={topPad} />

      {/* ── ASCII brand art (centered) ── */}
      {brandArtFor(columns, customArt).map((line, i) => (
        <box key={i}>
          <text fg={theme.brand}>{centre(line, columns)}</text>
        </box>
      ))}

      {/* ── Subtitle (centered, right below art) ── */}
      <box marginTop={1}>
        <text fg={theme.text.dim}>{centre('AI Coding Agent  ·  ask me to read, edit, search, or refactor', columns)}</text>
      </box>

      {/* ── Divider ── */}
      <box marginTop={1}>
        <text fg={theme.border.dim}>{'  '}{divider}</text>
      </box>

      {/* ── Recent sessions (centered block, top 5, name + date + model) ── */}
      {recent.length > 0 && (
        <box flexDirection="column" paddingTop={1}>
          <box>
            <text fg={theme.text.dim}>{centre('Recent', columns)}</text>
          </box>
          {sessionLines.map((line, i) => (
            <box key={i}>
              <text fg={theme.text.secondary}>{centre(line, columns)}</text>
            </box>
          ))}
        </box>
      )}

      {/* ── Small spacer between sessions and input ── */}
      <box height={2} />

      {/* ── Input box — centered, 65% width ── */}
      {statusMsg !== '' && (
        <box paddingLeft={inputLeftPad}>
          <text fg={theme.text.link}>{`! ${statusMsg.slice(0, inputWidth - 4)}`}</text>
        </box>
      )}
      <box paddingLeft={inputLeftPad} borderStyle="rounded" borderColor={theme.border.active} paddingRight={1}>
        <text fg={theme.role.assistant}>{'→ '}</text>
        <input
          ref={inputRef}
          focused={true}
          value={task}
          onInput={(v: string) => setTask(v)}
          onSubmit={() => handleSubmit()}
          placeholder="What can I help you build today?"
          width={Math.max(20, inputWidth - 6)}
          textColor={theme.text.primary}
          cursorColor={theme.text.link}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
        />
      </box>

      {/* ── Hints (centered) ── */}
      <box>
        <text fg={theme.text.dim}>{centre('/sessions  /settings  /model  /provider  /logo [1-3]', columns)}</text>
      </box>

      {/* ── Push bottom bar to bottom ── */}
      <box flexGrow={1} />

      {/* ── Bottom status bar: CWD:branch (left)   provider · model (right) ── */}
      <box>
        <text fg={theme.text.dim}>{bottomBar.slice(0, columns)}</text>
      </box>

    </box>
  );
};
