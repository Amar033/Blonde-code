import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import { AgentRuntime, type ApprovalCallback } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { theme, applyThemeMode, type ThemeMode } from '../theme.js';
import { mdSyntaxStyle } from '../syntax-style.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { FilesPanel, type FileChange } from '../components/FilesPanel.js';
import { ToolsPanel, type ToolEntry } from '../components/ToolsPanel.js';
import { ContextPanel } from '../components/ContextPanel.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { mockEventStream } from '../mock/eventStream.js';
import type { Plan, Observation } from '../../types/agent.js';
import { providerRegistry, parseProviderAdd } from '../../planner/provider-registry.js';
import os from 'os';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

type SearchSource = { title: string; url: string };

type NewItem =
  | { kind: 'user';      text: string }
  | { kind: 'assistant'; text: string; sources?: SearchSource[] }
  | { kind: 'tool';      toolName: string; argsSummary: string; result: string; success: boolean; ms: number }
  | { kind: 'plan';      stepCount: number; first: string }
  | { kind: 'system';    text: string };

type CompletedItem = NewItem & { id: string };

interface ActiveTool {
  toolName: string;
  argsSummary: string;
}

type FocusTarget = 'input' | 'conv' | 'files' | 'tools' | 'ctx';
const FOCUS_CYCLE: FocusTarget[] = ['input', 'conv', 'files', 'tools', 'ctx'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function argSummary(name: string, args: Record<string, unknown>): string {
  const v = args.path ?? args.command ?? args.pattern ?? args.query ?? args.url ?? args.find;
  if (v !== undefined) return String(v).slice(0, 50);
  const k = Object.keys(args)[0];
  return k ? `${k}: ${String(args[k]).slice(0, 35)}` : '';
}

// ─── Item renderer ────────────────────────────────────────────────────────────

const ItemView = memo(({ item }: { item: CompletedItem }) => {
  if (item.kind === 'user') {
    // OpenCode style: left blue accent bar, your message highlighted
    return (
      <box flexDirection="column" marginTop={1} border={['left']} borderStyle="single" borderColor={theme.border.active} paddingLeft={1}>
        <box>
          <text fg={theme.role.user}>▶ You</text>
        </box>
        <box paddingLeft={2}>
          <text fg={theme.text.primary}>{item.text}</text>
        </box>
      </box>
    );
  }

  if (item.kind === 'plan') {
    const desc = item.first.length > 60 ? item.first.slice(0, 60) + '…' : item.first;
    return (
      <box marginLeft={2} marginTop={1}>
        <text fg={theme.text.dim}>◦ Planning {item.stepCount} steps — {desc}</text>
      </box>
    );
  }

  if (item.kind === 'tool' && item.toolName === 'git_diff' && item.success) {
    return (
      <box flexDirection="column" marginLeft={2} marginTop={1}>
        <box>
          <text fg={theme.status.success}>◆ </text>
          <text fg={theme.syntax.keyword}>git_diff</text>
          {item.argsSummary ? <text fg={theme.text.dim}> ({item.argsSummary})</text> : null}
          <text fg={theme.text.dim}> · {item.ms}ms</text>
        </box>
        <diff
          diff={item.result}
          view="unified"
          syntaxStyle={mdSyntaxStyle}
          showLineNumbers={true}
          width="100%"
          height={18}
        />
      </box>
    );
  }

  if (item.kind === 'tool') {
    const icon = item.success ? '◆' : '✗';
    const ic   = item.success ? theme.status.success : theme.status.error;
    const rc   = item.success ? theme.text.secondary : theme.status.error;
    const MAX_LINE = 80;
    const MAX_ROWS = 3;
    const rawLines = item.result.split('\n').filter(l => l.trim());
    const lines    = rawLines.slice(0, MAX_ROWS).map(l => l.slice(0, MAX_LINE));
    const trunc    = rawLines.length > MAX_ROWS || item.result.length > MAX_LINE * MAX_ROWS;
    return (
      <box flexDirection="column" marginLeft={2} marginTop={1}>
        <box>
          <text fg={ic}>{icon} </text>
          <text fg={theme.syntax.keyword}>{item.toolName}</text>
          {item.argsSummary ? <text fg={theme.text.dim}> ({item.argsSummary})</text> : null}
          <text fg={theme.text.dim}> · {item.ms}ms</text>
        </box>
        {lines.map((line, i) => (
          <box key={i} paddingLeft={3}>
            <text fg={rc}>{line}{i === lines.length - 1 && trunc ? '…' : ''}</text>
          </box>
        ))}
      </box>
    );
  }

  if (item.kind === 'assistant') {
    const sources = item.sources ?? [];
    return (
      <box flexDirection="column" marginTop={1}>
        <box>
          <text fg={theme.role.assistant}>◆ Blonde</text>
        </box>
        <box paddingLeft={2}>
          <markdown
            content={item.text}
            syntaxStyle={mdSyntaxStyle}
            streaming={false}
            conceal={true}
          />
        </box>
        {sources.length > 0 && (
          <box paddingLeft={2} marginTop={1}>
            <text fg={theme.text.dim}>· {sources.length} source{sources.length !== 1 ? 's' : ''}</text>
          </box>
        )}
      </box>
    );
  }

  if (item.kind === 'system') {
    return (
      <box marginTop={1}>
        <text fg={theme.status.warning}>! </text>
        <text fg={theme.text.secondary}>{item.text}</text>
      </box>
    );
  }

  return null;
});

// ─── Main component ───────────────────────────────────────────────────────────

interface UnifiedSessionProps {
  initialTask?:    string;
  resumeSession?:  Session;
  mockMode?:       boolean;
  onComplete?:     () => void;
  onShowSessions?: () => void;
}

export const UnifiedSession: React.FC<UnifiedSessionProps> = ({
  initialTask, resumeSession, mockMode, onComplete, onShowSessions
}) => {
  const { width: termCols, height: termRows } = useTerminalDimensions();
  const renderer = useRenderer();

  const useSidebar = termCols >= 80;
  const sideWidth  = useSidebar ? Math.max(22, Math.floor(termCols * 0.32)) : 0;

  // Session timer
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(tick / 60)).padStart(2, '0');
  const ss = String(tick % 60).padStart(2, '0');

  // Core state
  const [completed,       setCompleted]       = useState<CompletedItem[]>([]);
  const [activeTool,      setActiveTool]      = useState<ActiveTool | null>(null);
  const [isThinking,      setIsThinking]      = useState(false);
  const [agentStatus,     setAgentStatus]     = useState('idle');
  const [isRunning,       setIsRunning]       = useState(false);
  const [input,           setInput]           = useState('');
  const [turns,           setTurns]           = useState(0);
  const [showHelp,        setShowHelp]        = useState(false);
  const [showPalette,     setShowPalette]     = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [currentModel,    setCurrentModel]    = useState(process.env.LLM_MODEL || 'qwen3.5:latest');
  const [tokenUsage,      setTokenUsage]      = useState(0);
  const [contextWindow,   setContextWindow]   = useState(8192);
  const [contextWarned,   setContextWarned]   = useState(false);
  const [streamThinking,  setStreamThinking]  = useState('');
  const [streamResponse,  setStreamResponse]  = useState('');
  const [fileChanges,     setFileChanges]     = useState<FileChange[]>([]);
  const [toolLog,         setToolLog]         = useState<ToolEntry[]>([]);
  const [focus,           setFocus]           = useState<FocusTarget>('input');
  const [inputHistory,    setInputHistory]    = useState<string[]>([]);
  const [historyIdx,      setHistoryIdx]      = useState(-1);

  const idRef               = useRef(0);
  const toolStartMs         = useRef(Date.now());
  const toolCounterRef      = useRef(0);
  const runtimeRef          = useRef<AgentRuntime | null>(null);
  const initPromiseRef      = useRef<Promise<AgentRuntime> | null>(null);
  const sessionMgrRef       = useRef<SessionManager | null>(null);
  const approvalResolveRef  = useRef<((v: boolean) => void) | null>(null);
  const firstMessageRef     = useRef<string | null>(null);
  const historyToRestoreRef = useRef<Array<{role: 'user'|'assistant'; content: string}> | null>(null);
  const runningToolIdRef    = useRef<string | null>(null);
  const pendingSourcesRef   = useRef<SearchSource[]>([]);
  const inputElRef          = useRef<any>(null);
  const convScrollRef       = useRef<any>(null);

  const CWD = process.cwd().replace(os.homedir(), '~');

  const ctxPct   = contextWindow > 0 ? Math.round((tokenUsage / contextWindow) * 100) : 0;
  const ctxColor = ctxPct >= 90 ? theme.status.error : ctxPct >= 75 ? theme.status.warning : theme.text.dim;

  // Sync active provider model label on mount
  useEffect(() => {
    providerRegistry.getActive().then(active => {
      if (active?.model) setCurrentModel(`${active.model} · ${active.type}:${active.name}`);
    }).catch(() => {});
  }, []);

  // Focus management: direct the active UI element
  useEffect(() => {
    if (focus === 'input') {
      inputElRef.current?.focus?.();
      convScrollRef.current?.blur?.();
    } else if (focus === 'conv') {
      convScrollRef.current?.focus?.();
      inputElRef.current?.blur?.();
    } else {
      inputElRef.current?.blur?.();
    }
  }, [focus]);

  // ── Helpers ────────────────────────────────────────────────

  const push = useCallback((item: NewItem) => {
    const id = String(idRef.current++);
    setCompleted(prev => [...prev, { ...item, id }]);
  }, []);

  const clearAll = useCallback(() => {
    setCompleted([]);
    setFileChanges([]);
    setToolLog([]);
    idRef.current = 0;
  }, []);

  const clearStream = useCallback(() => {
    setStreamThinking('');
    setStreamResponse('');
  }, []);

  const trackFileChange = useCallback((toolName: string, obs: Observation) => {
    const p = obs.input.path as string | undefined;
    if (!p) return;
    if (toolName === 'write_file' && obs.success) {
      setFileChanges(prev => prev.some(f => f.path === p) ? prev : [...prev, { path: p, type: 'A' }]);
    }
    if (toolName === 'edit_file' && obs.success) {
      setFileChanges(prev => {
        const idx = prev.findIndex(f => f.path === p);
        if (idx >= 0) return prev.map((f, i) => i === idx ? { ...f, type: 'M' } : f);
        return [...prev, { path: p, type: 'M' }];
      });
    }
  }, []);

  // ── Approval callback ──────────────────────────────────────

  const makeApprovalCallback = useCallback((): ApprovalCallback => {
    return (toolName, args, reasoning) =>
      new Promise<boolean>(resolve => {
        setApprovalRequest({ toolName, args, reasoning });
        approvalResolveRef.current = (v: boolean) => {
          setApprovalRequest(null);
          approvalResolveRef.current = null;
          resolve(v);
        };
      });
  }, []);

  // ── Session init ───────────────────────────────────────────

  useEffect(() => {
    if (mockMode) return;
    const mgr = new SessionManager();
    sessionMgrRef.current = mgr;
    mgr.init()
      .then(() => providerRegistry.getActive())
      .then(active => {
        const activeModel    = active?.model    ?? process.env.LLM_MODEL    ?? 'qwen3.5:latest';
        const activeProvider = active?.type     ?? process.env.LLM_PROVIDER ?? 'ollama';
        if (active?.model) setCurrentModel(`${active.model} · ${active.type}:${active.name}`);

        if (resumeSession) {
          historyToRestoreRef.current = resumeSession.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role as 'user'|'assistant', content: m.content }));
          for (const msg of resumeSession.messages) {
            if (msg.role === 'user')           push({ kind: 'user',      text: msg.content });
            else if (msg.role === 'assistant') push({ kind: 'assistant', text: msg.content });
          }
          push({ kind: 'system', text: `Resumed session: ${resumeSession.name}` });
          mgr.create(resumeSession.model || activeModel, resumeSession.provider || activeProvider);
          mgr.setName(resumeSession.name);
        } else {
          mgr.create(activeModel, activeProvider);
        }
        if (initialTask) runTask(initialTask);
      })
      .catch(() => { if (initialTask) runTask(initialTask); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mockMode) return;
    runTask('Build a FastAPI backend with SQLite database');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Runtime init ───────────────────────────────────────────

  const initRuntime = useCallback(async (model?: string) => {
    if (model && model !== currentModel) {
      runtimeRef.current = null;
      initPromiseRef.current = null;
      process.env.LLM_MODEL = model;
      setCurrentModel(model);
    }
    if (runtimeRef.current) return runtimeRef.current;
    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const reg = new ToolRegistry();
        const rt  = new AgentRuntime(reg, { maxTurns: 30, maxLoopCount: 20, debug: false });
        rt.setApprovalCallback(makeApprovalCallback());
        await rt.initialize();
        runtimeRef.current = rt;
        const ctxWin = await rt.getContextWindow();
        setContextWindow(ctxWin);
        return rt;
      })();
    }
    return initPromiseRef.current;
  }, [makeApprovalCallback, currentModel]);

  // ── Agent runner ───────────────────────────────────────────

  const runTask = useCallback(async (task: string) => {
    push({ kind: 'user', text: task });
    setIsRunning(true);
    setIsThinking(true);
    setAgentStatus('planning');

    const mgr = sessionMgrRef.current;
    mgr?.addMessage('user', task);
    pendingSourcesRef.current = [];

    try {
      const source = mockMode
        ? mockEventStream()
        : (async function*() {
            const runtime = await initRuntime();
            if (historyToRestoreRef.current) {
              runtime.loadConversationHistory(historyToRestoreRef.current);
              historyToRestoreRef.current = null;
            }
            const isFirst = mgr && !firstMessageRef.current;
            if (isFirst) firstMessageRef.current = task;
            yield* runtime.run(task);
            if (isFirst) {
              const llm = runtime.getRuntimeLLM();
              if (llm) {
                llm.generateSessionName(task).then((name: string) => {
                  mgr!.setName(name);
                  mgr!.save().catch(() => {});
                }).catch(() => {});
              }
            }
          })();

      for await (const event of source) {
        if (!mockMode) {
          const runtime = runtimeRef.current;
          if (runtime) {
            setAgentStatus(runtime.getState().status);
            const usage = runtime.getTokenUsage();
            if (usage > 0) { setTokenUsage(usage); mgr?.updateTokenUsage(usage); }
          }
        }

        if (event.type === 'llm_streaming') {
          if (event.inThinkBlock) {
            setStreamThinking(event.thinking ?? '');
            setStreamResponse('');
          } else if (event.thinking) {
            setStreamThinking(event.thinking);
            const thinkEnd = event.delta.indexOf('</think>');
            const cleaned = thinkEnd !== -1
              ? event.delta.slice(thinkEnd + 8).trim()
              : event.delta.replace(/<think>[\s\S]*<\/think>/g, '').trim();
            setStreamResponse(cleaned);
          } else {
            setStreamResponse(event.delta.slice(0, 400));
          }
        }

        if (event.type === 'plan_generated') {
          clearStream();
          const rawStep = event.plan.steps[0] as unknown;
          const firstStep = typeof rawStep === 'string'
            ? rawStep
            : rawStep && typeof rawStep === 'object'
              ? ((rawStep as any).step_description ?? (rawStep as any).description ?? JSON.stringify(rawStep).slice(0, 80))
              : '';
          push({ kind: 'plan', stepCount: event.plan.steps.length, first: firstStep });
          setIsThinking(false);
        }

        if (event.type === 'llm_response' && event.parsed.type === 'tool_call') {
          clearStream();
          toolStartMs.current = Date.now();
          const toolId = `tool-${toolCounterRef.current++}`;
          runningToolIdRef.current = toolId;
          const tc = event.parsed as Extract<typeof event.parsed, { type: 'tool_call' }>;
          setActiveTool({ toolName: tc.tool, argsSummary: argSummary(tc.tool, tc.args) });
          setToolLog(prev => [...prev, { id: toolId, name: tc.tool, status: 'running' }]);
        }

        if (event.type === 'observation_ready') {
          clearStream();
          const obs = event.observation;
          const ms  = Date.now() - toolStartMs.current;
          const tid = runningToolIdRef.current;
          setActiveTool(null);
          runningToolIdRef.current = null;
          push({ kind: 'tool', toolName: obs.toolName, argsSummary: argSummary(obs.toolName, obs.input), result: obs.summary, success: obs.success, ms });
          trackFileChange(obs.toolName, obs);
          if (tid) {
            setToolLog(prev => prev.map(t => t.id === tid
              ? { ...t, status: obs.success ? 'done' : 'error', ms }
              : t));
          }
        }

        if (event.type === 'sources_ready') {
          pendingSourcesRef.current = [...pendingSourcesRef.current, ...event.sources];
        }

        if (event.type === 'complete') {
          clearStream();
          setIsThinking(false);
          const sources = pendingSourcesRef.current.length > 0 ? [...pendingSourcesRef.current] : undefined;
          pendingSourcesRef.current = [];
          push({ kind: 'assistant', text: event.finalResponse, sources });
          setTurns(t => t + 1);
          mgr?.addMessage('assistant', event.finalResponse);
          // OS notification when task completes
          try { renderer.triggerNotification('Task complete', 'Blonde'); } catch {}
          if (!mockMode) {
            const runtime = runtimeRef.current;
            if (runtime) {
              const finalUsage = runtime.getTokenUsage();
              if (finalUsage > 0) {
                setTokenUsage(finalUsage);
                const pct = Math.round((finalUsage / contextWindow) * 100);
                if (pct >= 80 && !contextWarned) {
                  setContextWarned(true);
                  push({ kind: 'system', text: `Context ${pct}% full (${finalUsage}/${contextWindow} tokens). Consider /new soon.` });
                }
              }
            }
          }
        }

        if (event.type === 'abort') {
          clearStream();
          setIsThinking(false);
          push({ kind: 'system', text: `Stopped: ${event.reason}` });
        }
      }
    } catch (err) {
      push({ kind: 'system', text: `Error: ${err}` });
    } finally {
      clearStream();
      setIsRunning(false);
      setIsThinking(false);
      setActiveTool(null);
      setAgentStatus('idle');
      mgr?.save().catch(() => {});
    }
  }, [push, initRuntime, contextWindow, contextWarned, trackFileChange, mockMode, renderer]);

  // ── Command handler ────────────────────────────────────────

  const handleCommand = useCallback((val: string) => {
    if (val === 'stop' && isRunning) { runtimeRef.current?.abort(); return; }
    if (val === 'clear' || val === '/clear') { clearAll(); return; }
    if (val === '?' || val === 'help' || val === '/help') { setShowHelp(h => !h); return; }
    if (val === '/sessions' || val === 'sessions') { onShowSessions?.(); return; }
    if (val === '/new' || val === 'new session') {
      runtimeRef.current = null;
      initPromiseRef.current = null;
      firstMessageRef.current = null;
      setContextWarned(false);
      setTokenUsage(0);
      setTurns(0);
      sessionMgrRef.current?.create(currentModel, process.env.LLM_PROVIDER ?? 'ollama');
      clearAll();
      push({ kind: 'system', text: 'New session started.' });
      return;
    }
    if (val === '/model' || val === '/models') {
      const providerType = process.env.LLM_PROVIDER || 'ollama';
      if (providerType === 'ollama') {
        import('../../planner/providers/ollama.js').then(async ({ OllamaProvider, findOllamaModelsDirs }: any) => {
          const p = new OllamaProvider(currentModel, process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
          const [models, dirs] = await Promise.all([p.listModels(), findOllamaModelsDirs()]);
          push({ kind: 'system', text: `current: ${currentModel}  available: ${models.join(', ')}  dir: ${dirs[0]?.path ?? '~/.ollama/models'}  /model <name> to switch` });
        }).catch(() => push({ kind: 'system', text: `current: ${currentModel} (${providerType})` }));
      } else {
        push({ kind: 'system', text: `current: ${currentModel} (${providerType})` });
      }
      return;
    }
    if (val.startsWith('/model ')) {
      const m = val.slice(7).trim();
      if (!m) return;
      push({ kind: 'system', text: `Switching to ${m}…` });
      initRuntime(m).then(() => {
        sessionMgrRef.current?.create(m, process.env.LLM_PROVIDER ?? 'ollama');
        push({ kind: 'system', text: `Model switched to ${m}` });
      }).catch(err => push({ kind: 'system', text: `Failed: ${err}` }));
      return;
    }
    if (val.startsWith('/theme ')) {
      const mode = val.slice(7).trim() as ThemeMode;
      applyThemeMode(mode);
      push({ kind: 'system', text: `Theme set to ${mode}` });
      return;
    }
    if (val === '/provider' || val === '/providers') {
      providerRegistry.list().then(list => {
        if (list.length === 0) {
          push({ kind: 'system', text: 'No providers configured. Use /provider add <name> <type> <apiKey> [model] [baseURL]' });
          return;
        }
        const lines = list.map(p => {
          const marker = p.isActive ? '* ' : '  ';
          const key    = p.apiKey ? `key=***${p.apiKey.slice(-4)}` : 'no key';
          return `${marker}${p.name}  [${p.type}]  model=${p.model}  ${key}`;
        }).join('\n');
        push({ kind: 'system', text: `Configured providers (* = active):\n${lines}` });
      }).catch(err => push({ kind: 'system', text: `Error: ${err}` }));
      return;
    }
    if (val.startsWith('/provider add ')) {
      const parts  = val.slice('/provider add '.length).trim().split(/\s+/);
      const result = parseProviderAdd(parts);
      if (typeof result === 'string') { push({ kind: 'system', text: result }); return; }
      providerRegistry.add(result).then(() => {
        push({ kind: 'system', text: `Provider "${result.name}" added (${result.type} · ${result.model}). Use /provider use ${result.name} to activate.` });
      }).catch(err => push({ kind: 'system', text: `Failed to save provider: ${err}` }));
      return;
    }
    if (val.startsWith('/provider use ')) {
      const name = val.slice('/provider use '.length).trim();
      providerRegistry.setActive(name).then(ok => {
        if (!ok) { push({ kind: 'system', text: `Unknown provider "${name}". Run /provider to list.` }); return; }
        runtimeRef.current = null;
        initPromiseRef.current = null;
        push({ kind: 'system', text: `Switched to provider "${name}". Next message will use it.` });
      }).catch(err => push({ kind: 'system', text: `Error: ${err}` }));
      return;
    }
    if (val.startsWith('/provider remove ')) {
      const name = val.slice('/provider remove '.length).trim();
      providerRegistry.remove(name).then(ok => {
        if (!ok) { push({ kind: 'system', text: `Unknown provider "${name}".` }); return; }
        runtimeRef.current = null;
        initPromiseRef.current = null;
        push({ kind: 'system', text: `Provider "${name}" removed.` });
      }).catch(err => push({ kind: 'system', text: `Error: ${err}` }));
      return;
    }
    if (val === '/provider clear' || val === '/provider reset') {
      providerRegistry.clearActive().then(() => {
        runtimeRef.current = null;
        initPromiseRef.current = null;
        push({ kind: 'system', text: 'Active provider cleared — falling back to .env settings.' });
      }).catch(err => push({ kind: 'system', text: `Error: ${err}` }));
      return;
    }
    if (val === '/provider help') {
      push({ kind: 'system', text: [
        '/provider              — list all configured providers',
        '/provider add <name> <type> <key> [model] [baseURL]',
        '  types: openai · anthropic · openrouter · openai-compatible · ollama',
        '  e.g. /provider add gpt openai sk-abc123 gpt-4o-mini',
        '  e.g. /provider add claude anthropic sk-ant-xxx claude-haiku-4-5-20251001',
        '/provider use <name>   — switch active provider',
        '/provider remove <name>— delete a provider',
        '/provider clear        — revert to .env settings',
      ].join('\n') });
      return;
    }
    if (isRunning) return;
    runTask(val);
  }, [isRunning, clearAll, push, onShowSessions, currentModel, initRuntime, runTask]);

  // ── Input submit ───────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const val = input.trim();
    if (!val) return;
    // Clear the input
    setInput('');
    setHistoryIdx(-1);
    setInputHistory(prev => [val, ...prev.slice(0, 49)]);
    if (inputElRef.current) inputElRef.current.value = '';

    // Approval flow
    if (approvalRequest && approvalResolveRef.current) {
      const lv = val.toLowerCase();
      if (lv === 'y' || lv === 'yes') { approvalResolveRef.current(true);  return; }
      if (lv === 'n' || lv === 'no')  { approvalResolveRef.current(false); return; }
      push({ kind: 'system', text: `Type 'y' to approve or 'n' to deny.` });
      return;
    }

    handleCommand(val);
  }, [input, approvalRequest, push, handleCommand]);

  // ── Keyboard handling ──────────────────────────────────────

  useKeyboard((key) => {
    // Ctrl+C — interrupt agent or quit
    if (key.ctrl && key.name === 'c') {
      if (isRunning) {
        runtimeRef.current?.abort();
        setIsRunning(false);
        setAgentStatus('idle');
      } else {
        renderer.destroy();
      }
      return;
    }
    // Ctrl+L — clear
    if (key.ctrl && key.name === 'l') { clearAll(); return; }
    // Ctrl+K — command palette
    if (key.ctrl && key.name === 'k' && !showPalette) { setShowPalette(true); return; }

    // Page up/down — scroll conversation
    if (key.name === 'pageup')   { convScrollRef.current?.scrollBy?.({ y: -10 }); return; }
    if (key.name === 'pagedown') { convScrollRef.current?.scrollBy?.({ y:  10 }); return; }

    // Tab — cycle focus
    if (key.name === 'tab') {
      const idx  = FOCUS_CYCLE.indexOf(focus);
      const next = key.shift
        ? FOCUS_CYCLE[(idx - 1 + FOCUS_CYCLE.length) % FOCUS_CYCLE.length]
        : FOCUS_CYCLE[(idx + 1) % FOCUS_CYCLE.length];
      setFocus(next);
      return;
    }

    // j/k scroll from any panel when input is empty and not running
    if (input === '' && !isRunning) {
      if (key.sequence === 'k') { convScrollRef.current?.scrollBy?.({ y: -3 }); return; }
      if (key.sequence === 'j') { convScrollRef.current?.scrollBy?.({ y:  3 }); return; }
    }

    // Conversation focus: arrow + vim keys
    if (focus === 'conv') {
      if (key.name === 'up')   { convScrollRef.current?.scrollBy?.({ y: -3 }); return; }
      if (key.name === 'down') { convScrollRef.current?.scrollBy?.({ y:  3 }); return; }
      if (key.sequence === 'g') { convScrollRef.current?.scrollTo?.({ y: 0 }); return; }
      if (key.shift && key.sequence === 'G') { convScrollRef.current?.scrollTo?.({ y: 999999 }); return; }
    }

    // Input history (only in input focus, when buffer empty)
    if (focus === 'input') {
      if (key.name === 'up' && input === '') {
        const newIdx = Math.min(historyIdx + 1, inputHistory.length - 1);
        if (newIdx >= 0 && newIdx < inputHistory.length) {
          setHistoryIdx(newIdx);
          const val = inputHistory[newIdx] ?? '';
          setInput(val);
          if (inputElRef.current) inputElRef.current.value = val;
        }
        return;
      }
      if (key.name === 'down' && historyIdx >= 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        const val = newIdx >= 0 ? (inputHistory[newIdx] ?? '') : '';
        setInput(val);
        if (inputElRef.current) inputElRef.current.value = val;
        return;
      }
      // Enter is handled by <input onSubmit> — do not call handleSubmit() here too
    }

    // Quit with q when idle
    if (key.sequence === 'q' && input === '' && !isRunning && focus === 'input') {
      renderer.destroy();
    }
  });

  // ── Layout heights ────────────────────────────────────────

  const paletteH  = showPalette ? 12 : 0;
  const convH     = Math.max(6, termRows - 2 - paletteH - 3); // -2 status bar, -3 input
  const filesH    = Math.max(4, Math.floor(convH * 0.27));
  const toolsH    = Math.max(5, Math.floor(convH * 0.44));
  const ctxH      = Math.max(4, convH - filesH - toolsH);

  // ── Derived ───────────────────────────────────────────────

  const inputBorder = approvalRequest ? theme.status.warning
    : isRunning ? theme.status.running
    : focus === 'input' ? theme.border.active
    : theme.border.normal;

  const inputPlaceholder = approvalRequest
    ? "type 'y' to approve or 'n' to deny, then Enter"
    : isRunning
    ? "agent running — type 'stop' to cancel"
    : 'Ask anything… (Ctrl+K for commands)';

  const convBorder = focus === 'conv' ? theme.border.active : theme.border.dim;

  const footerHint = focus === 'conv'
    ? '↑↓/jk scroll   g top   G btm   Tab panels'
    : focus !== 'input'
    ? 'PgUp/PgDn scroll   Tab panels'
    : isRunning
    ? 'stop · cancel   Ctrl+C · interrupt   Ctrl+K · cmds'
    : '↑ history   Tab panels   Ctrl+K cmds   q quit';

  // ─── Render ───────────────────────────────────────────────

  return (
    <box flexDirection="column" height={termRows}>

      {/* ── Content row ── */}
      <box flexDirection="row" gap={1} height={convH}>

        {/* Conversation panel */}
        <box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={convBorder}
          title={turns > 0 ? ` Conversation · turn ${turns} ` : ' Conversation '}
          titleColor={theme.text.secondary}
        >
          {/* Scrollable conversation — sticky bottom, viewport culling */}
          <scrollbox
            ref={convScrollRef}
            scrollY={true}
            stickyScroll={true}
            stickyStart="bottom"
            viewportCulling={true}
            flexGrow={1}
          >
            {completed.map(item => (
              <ItemView key={item.id} item={item} />
            ))}

            {/* Live: active tool */}
            {activeTool && (
              <box marginLeft={2} marginTop={1}>
                <BrailleSpinner color={theme.status.running} />
                <text fg={theme.syntax.keyword}> {activeTool.toolName}</text>
                {activeTool.argsSummary ? <text fg={theme.text.dim}> ({activeTool.argsSummary})</text> : null}
              </box>
            )}

            {/* Live: streaming thinking */}
            {isRunning && streamThinking && (
              <box marginLeft={2} marginTop={1}>
                <BrailleSpinner color={theme.status.running} />
                <text fg={theme.text.dim}> {streamThinking.length > 160 ? '…' + streamThinking.slice(-160) : streamThinking}</text>
              </box>
            )}

            {/* Live: streaming response via markdown renderer */}
            {isRunning && !streamThinking && streamResponse && (
              <box flexDirection="column" marginTop={1}>
                <box>
                  <text fg={theme.role.assistant}>◆ Blonde</text>
                </box>
                <box paddingLeft={2}>
                  <markdown
                    content={streamResponse}
                    syntaxStyle={mdSyntaxStyle}
                    streaming={true}
                  />
                </box>
              </box>
            )}

            {/* Live: fallback spinner */}
            {isThinking && !activeTool && !streamThinking && !streamResponse && (
              <box marginLeft={2} marginTop={1}>
                <BrailleSpinner color={theme.status.running} />
                <text fg={theme.text.secondary}> {agentStatus === 'planning' ? 'Planning…' : 'Thinking…'}</text>
              </box>
            )}

            {/* Help panel */}
            {showHelp && (
              <box flexDirection="column" borderStyle="single" borderColor={theme.border.normal}
                paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} marginLeft={1} marginTop={1}>
                <box><text fg={theme.brand}>Commands</text></box>
                {[
                  'stop / Ctrl+C  · interrupt agent',
                  '/clear /Ctrl+L · clear conversation',
                  '/new           · fresh session',
                  '/sessions      · browse sessions',
                  '/model [name]  · list / switch model',
                  '/provider      · list / add / switch providers',
                  '/provider help · provider command reference',
                  '/theme [mode]  · dark / light / dark-ansi',
                  'Ctrl+K         · command palette',
                  'Tab            · cycle panel focus',
                  '?              · toggle this help',
                ].map(h => <box key={h}><text fg={theme.text.dim}>{h}</text></box>)}
              </box>
            )}

            {/* Approval panel */}
            {approvalRequest && (
              <box flexDirection="column" borderStyle="rounded"
                borderColor={theme.status.warning} paddingLeft={2} paddingRight={2}
                paddingTop={1} paddingBottom={1} marginLeft={1} marginTop={1}>
                <box gap={1}>
                  <text fg={theme.status.warning}>⚠</text>
                  <text fg={theme.text.primary}><strong>Approval needed —</strong></text>
                  <text fg={theme.syntax.keyword}><strong>{approvalRequest.toolName}</strong></text>
                  {approvalRequest.args['path'] != null && (
                    <text fg={theme.text.dim}>→ {String(approvalRequest.args['path'])}</text>
                  )}
                </box>
                {approvalRequest.toolName === 'edit_file' && (
                  <box flexDirection="column" marginTop={1}>
                    {String(approvalRequest.args['find'] ?? '').split('\n').map((l, i) => (
                      <box key={`f${i}`} gap={1}><text fg={theme.diff.deleted}>─</text><text fg={theme.diff.deleted}>{l.slice(0, 100)}</text></box>
                    ))}
                    {String(approvalRequest.args['replace'] ?? '').split('\n').map((l, i) => (
                      <box key={`r${i}`} gap={1}><text fg={theme.diff.added}>+</text><text fg={theme.diff.added}>{l.slice(0, 100)}</text></box>
                    ))}
                  </box>
                )}
                {approvalRequest.toolName === 'bash' && approvalRequest.args['command'] != null && (
                  <box marginTop={1}>
                    <text fg={theme.syntax.keyword}>$ </text>
                    <text fg={theme.text.dim}>{String(approvalRequest.args['command']).slice(0, 120)}</text>
                  </box>
                )}
                {approvalRequest.reasoning && (
                  <text fg={theme.text.dim}>{approvalRequest.reasoning.slice(0, 120)}</text>
                )}
                <box marginTop={1} gap={3}>
                  <text fg={theme.status.success}>[y] Approve</text>
                  <text fg={theme.status.error}>[n] Deny</text>
                </box>
              </box>
            )}

            {/* Context warning */}
            {ctxPct >= 80 && (
              <box borderStyle="rounded"
                borderColor={ctxPct >= 90 ? theme.status.error : theme.status.warning}
                paddingLeft={2} paddingRight={2} marginLeft={1} marginTop={1}>
                <text fg={ctxPct >= 90 ? theme.status.error : theme.status.warning}>
                  {ctxPct >= 90 ? `Context ${ctxPct}% full — /new now` : `Context ${ctxPct}% full — consider /new`}
                </text>
              </box>
            )}
          </scrollbox>
        </box>

        {/* Right sidebar */}
        {useSidebar && (
          <box flexDirection="column" width={sideWidth} height={convH}>
            <FilesPanel files={fileChanges} focused={focus === 'files'} height={filesH} />
            <ToolsPanel tools={toolLog}     focused={focus === 'tools'} height={toolsH} />
            <ContextPanel used={tokenUsage} total={contextWindow} focused={focus === 'ctx'} height={ctxH} />
          </box>
        )}
      </box>

      {/* ── Command palette ── */}
      {showPalette && (
        <CommandPalette
          onSelect={cmd => { setInput(''); handleCommand(cmd); setShowPalette(false); }}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* ── Input bar ── */}
      <box height={3} borderStyle="rounded" borderColor={inputBorder} paddingLeft={2} paddingRight={2}>
        <text fg={isRunning ? theme.status.running : theme.role.user}>{'> '}</text>
        <input
          ref={inputElRef}
          focused={focus === 'input'}
          placeholder={inputPlaceholder}
          width={termCols - sideWidth - 12}
          textColor={theme.text.primary}
          cursorColor={theme.text.link}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          onInput={(v: string) => setInput(v)}
          onSubmit={() => handleSubmit()}
        />
        {input.length > 0 && (
          <text fg={theme.text.dim}>{input.length}</text>
        )}
      </box>

      {/* ── Bottom status bar (replaces AppHeader entirely) ── */}
      <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
        <text fg={theme.brand}>◆ </text>
        <text fg={theme.text.secondary}>{currentModel}</text>
        {tokenUsage > 0 && <text fg={ctxColor}> · {ctxPct}%</text>}
        <text fg={theme.text.dim}> · {mm}:{ss} · {CWD}</text>
        <box flexGrow={1} />
        <text fg={theme.text.dim}>{footerHint}</text>
      </box>

    </box>
  );
};
