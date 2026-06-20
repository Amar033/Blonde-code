import React, { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { ensureSearXNG } from '../../services/searxng-manager.js';
import { loadUiConfig } from '../../services/ui-config.js';
import { brandArtFor, getUsername, pickGreeting } from '../brand.js';
import { theme } from '../theme.js';
import { FlowerBackground } from '../components/FlowerBackground.js';

async function fetchAiGreeting(name: string): Promise<string> {
  try {
    const baseUrl  = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model    = process.env.LLM_MODEL        || 'qwen3.5:latest';
    const provider = process.env.LLM_PROVIDER    || 'ollama';

    const isOllama = provider === 'ollama';
    const isOpenAI = provider === 'openai' || provider === 'openai-compatible' || provider === 'lmstudio';
    if (!isOllama && !isOpenAI) return '';

    const ac  = new AbortController();
    const tId = setTimeout(() => ac.abort(), 1200);
    const prompt = `Write a very short (under 55 chars), warm, casual one-line greeting for ${name || 'a developer'} opening their AI coding assistant. Sound human, not robotic. Output ONLY the greeting, no quotes, no explanation.`;

    let res: Response;
    if (isOllama) {
      res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: 25, temperature: 0.9 } }),
        signal: ac.signal,
      });
      clearTimeout(tId);
      const data = await res.json() as any;
      return ((data.response as string) || '').trim().replace(/^["']|["']$/g, '').slice(0, 80);
    } else {
      const apiBase = process.env.OPENAI_API_BASE || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
      res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'lm-studio'}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 30, temperature: 0.9 }),
        signal: ac.signal,
      });
      clearTimeout(tId);
      const data = await res.json() as any;
      return ((data.choices?.[0]?.message?.content as string) || '').trim().replace(/^["']|["']$/g, '').slice(0, 80);
    }
  } catch {
    return '';
  }
}

interface LogLine { text: string; level: 'info' | 'ok' | 'warn' | 'error'; }

const DOTS = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

interface StartupScreenProps { onDone: () => void; }

export const StartupScreen: React.FC<StartupScreenProps> = ({ onDone }) => {
  const { width: cols, height: rows } = useTerminalDimensions();
  const [tick,      setTick]      = useState(0);
  const [logs,      setLogs]      = useState<LogLine[]>([]);
  const [done,      setDone]      = useState(false);
  const [greeting,  setGreeting]  = useState('');
  const [customArt, setCustomArt] = useState<string[] | undefined>();
  const [flowerBg,  setFlowerBg]  = useState(true);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const name = getUsername();
    setGreeting(pickGreeting(name));
    fetchAiGreeting(name).then(ai => { if (ai) setGreeting(ai); }).catch(() => {});
    loadUiConfig().then(cfg => {
      if (cfg.brandArt && cfg.brandArt.length > 0) setCustomArt(cfg.brandArt);
      if (cfg.greeting) setGreeting(cfg.greeting);
      if (cfg.flowerBg === false) setFlowerBg(false);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const addLog = (text: string, level: LogLine['level'] = 'info') =>
      setLogs(prev => [...prev, { text, level }]);

    ensureSearXNG(addLog)
      .then(result => {
        if (!result.ok) {
          setLogs(prev => {
            const last = prev[prev.length - 1];
            if (last && (last.level === 'error' || last.level === 'warn')) {
              return [...prev, { text: 'Falling back to DuckDuckGo', level: 'info' }];
            }
            return prev;
          });
        }
        setDone(true);
        setTimeout(onDone, 600);
      })
      .catch(() => {
        addLog('Search init failed — using DuckDuckGo', 'warn');
        setDone(true);
        setTimeout(onDone, 600);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const centre = (s: string) => {
    const p = Math.max(0, Math.floor((cols - s.length) / 2));
    return ' '.repeat(p) + s;
  };

  // ── Vertical centering (same approach as WelcomeScreen) ───────────────────────
  const artRows   = brandArtFor(cols, customArt).length;
  const logCount  = Math.max(1, logs.length) + (done ? 1 : 0);
  const blockRows = artRows + 1 + 1 + logCount; // art + greeting + gap + logs
  const topPad    = Math.max(1, Math.floor((rows - blockRows) / 2) - 1);

  // ── Status block width — matches welcome screen's box width ───────────────────
  const blockW  = Math.min(90, Math.max(44, Math.floor(cols * 0.60)));
  const blockLP = Math.max(0, Math.floor((cols - blockW) / 2));

  return (
    <box flexDirection="column" width={cols} height={rows}>

      {/* ── Flower bloom background (absolute, renders behind content) ── */}
      {flowerBg && <FlowerBackground cols={cols} rows={rows} />}

      {/* ── Top spacer ── */}
      <box height={topPad} shouldFill={false} />

      {/* ── ASCII brand art ── */}
      {brandArtFor(cols, customArt).map((line, i) => (
        <box key={i} shouldFill={false}>
          <text fg={theme.brand}>{centre(line)}</text>
        </box>
      ))}

      {/* ── Greeting — right below banner ── */}
      <box shouldFill={false}>
        <text fg={theme.text.dim}>{centre(greeting)}</text>
      </box>

      {/* ── Gap ── */}
      <box height={1} shouldFill={false} />

      {/* ── Spinner / status lines — left-aligned to the centered block ── */}
      {logs.length === 0 ? (
        <box paddingLeft={blockLP} shouldFill={false}>
          <text fg={theme.brand}>{`${DOTS[tick % DOTS.length]}  Starting up…`}</text>
        </box>
      ) : null}

      {logs.map((line, i) => {
        const isActive = i === logs.length - 1 && !done;
        const sp   = DOTS[tick % DOTS.length];
        const icon = isActive              ? sp
                   : line.level === 'ok'    ? '✓'
                   : line.level === 'warn'  ? '⚠'
                   : line.level === 'error' ? '✗'
                   : '·';
        const fg   = isActive              ? theme.brand
                   : line.level === 'ok'    ? theme.status.success
                   : line.level === 'warn'  ? theme.status.warning
                   : line.level === 'error' ? theme.status.error
                   : theme.text.dim;
        return (
          <box key={i} paddingLeft={blockLP} shouldFill={false}>
            <text fg={fg}>{`${icon}  ${line.text}`}</text>
          </box>
        );
      })}

      {done && (
        <box paddingLeft={blockLP} shouldFill={false}>
          <text fg={theme.status.success}>{'◆  Ready'}</text>
        </box>
      )}

      {/* ── Push to fill remaining space ── */}
      <box flexGrow={1} shouldFill={false} />

    </box>
  );
};
