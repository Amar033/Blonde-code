import React, { useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { ensureSearXNG } from '../../services/searxng-manager.js';
import { loadUiConfig } from '../../services/ui-config.js';
import { brandArtFor, getUsername, pickGreeting } from '../brand.js';
import { theme } from '../theme.js';

// ─── Try to get an AI greeting (short timeout, silent fallback) ───────────────
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
  const { width: cols }           = useTerminalDimensions();
  const [tick,      setTick]      = useState(0);
  const [logs,      setLogs]      = useState<LogLine[]>([]);
  const [done,      setDone]      = useState(false);
  const [greeting,  setGreeting]  = useState('');
  const [customArt, setCustomArt] = useState<string[] | undefined>();

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

  const divider = '─'.repeat(Math.max(0, cols - 4));

  return (
    <box flexDirection="column" width={cols}>

      {/* ── Vertical padding above brand art ── */}
      <box height={3} />

      {/* ── ASCII brand art (centered) ── */}
      {brandArtFor(cols, customArt).map((line, i) => (
        <box key={i}>
          <text fg={theme.brand}>{centre(line)}</text>
        </box>
      ))}

      {/* ── Greeting (centered) ── */}
      <box marginTop={1}>
        <text fg={theme.text.secondary}>{centre(greeting)}</text>
      </box>

      {/* ── Divider ── */}
      <box marginTop={2}>
        <text fg={theme.border.dim}>{'  '}{divider}</text>
      </box>

      {/* ── Status lines — each is ONE centered <text>, never two ── */}
      <box marginTop={1}>
        {logs.length === 0 ? (
          <text fg={theme.brand}>{centre(`${DOTS[tick % DOTS.length]}  Starting up…`)}</text>
        ) : null}
      </box>

      {logs.map((line, i) => {
        const isActive = i === logs.length - 1 && !done;
        const sp   = DOTS[tick % DOTS.length];
        const icon = isActive           ? sp
                   : line.level === 'ok'    ? '✓'
                   : line.level === 'warn'  ? '⚠'
                   : line.level === 'error' ? '✗' : '·';
        const fg   = isActive           ? theme.brand
                   : line.level === 'ok'    ? theme.status.success
                   : line.level === 'warn'  ? theme.status.warning
                   : line.level === 'error' ? theme.status.error
                   : theme.text.dim;
        return (
          <box key={i}>
            <text fg={fg}>{centre(`${icon}  ${line.text}`)}</text>
          </box>
        );
      })}

      {done && (
        <box marginTop={1}>
          <text fg={theme.status.success}>{centre('◆  Ready')}</text>
        </box>
      )}

    </box>
  );
};
