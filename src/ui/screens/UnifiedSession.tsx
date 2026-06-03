import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { AgentRuntime, type ApprovalCallback } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { theme, applyThemeMode, type ThemeMode } from '../theme.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { MarkdownBlock } from '../components/MarkdownBlock.js';
import { FilesPanel, type FileChange } from '../components/FilesPanel.js';
import { ToolsPanel, type ToolEntry } from '../components/ToolsPanel.js';
import { ContextPanel } from '../components/ContextPanel.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { AppHeader } from '../components/AppHeader.js';
import { mockEventStream } from '../mock/eventStream.js';
import type { Plan, Observation } from '../../types/agent.js';
import os from 'os';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

type NewItem =
  | { kind: 'user';      text: string }
  | { kind: 'assistant'; text: string }
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

function diffLineColor(line: string, fallback: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return theme.diff.added;
  if (line.startsWith('-') && !line.startsWith('---')) return theme.diff.deleted;
  if (line.startsWith('@@'))  return theme.syntax.keyword;
  if (line.startsWith('+++') || line.startsWith('---')) return theme.text.dim;
  if (line.startsWith('  + ')) return theme.diff.added;
  if (line.startsWith('  - ')) return theme.diff.deleted;
  return fallback;
}

interface DiffRow {
  oldNum: number | null; newNum: number | null;
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  content: string;
}

function buildDiffRows(summary: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldN = 1, newN = 1;
  for (const raw of summary.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldN = +m[1]; newN = +m[2]; }
      rows.push({ oldNum: null, newNum: null, type: 'hunk', content: raw }); continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      rows.push({ oldNum: null, newNum: null, type: 'meta', content: raw }); continue;
    }
    if (raw.startsWith('+')) { rows.push({ oldNum: null, newNum: newN++, type: 'add', content: raw.slice(1) }); continue; }
    if (raw.startsWith('-')) { rows.push({ oldNum: oldN++, newNum: null, type: 'del', content: raw.slice(1) }); continue; }
    if (raw.startsWith(' ')) { rows.push({ oldNum: oldN++, newNum: newN++, type: 'ctx', content: raw.slice(1) }); continue; }
    rows.push({ oldNum: null, newNum: null, type: 'meta', content: raw });
  }
  return rows;
}

// ─── Item renderer ────────────────────────────────────────────────────────────

const ItemView = memo(({ item }: { item: CompletedItem }) => {
  if (item.kind === 'user') {
    return (
      <Box marginTop={1} gap={1}>
        <Text color={theme.role.user} bold>{'▶'}</Text>
        <Text color={theme.role.user} bold>You</Text>
        <Text color={theme.text.primary}>{item.text}</Text>
      </Box>
    );
  }

  if (item.kind === 'plan') {
    const desc = item.first.length > 56 ? item.first.slice(0, 56) + '…' : item.first;
    return (
      <Box marginLeft={2} marginTop={1} gap={1}>
        <Text color={theme.text.dim}>◦</Text>
        <Text color={theme.text.dim}>Planning {item.stepCount} steps</Text>
        <Text color={theme.text.dim}>— {desc}</Text>
      </Box>
    );
  }

  if (item.kind === 'tool' && item.toolName === 'git_diff' && item.success) {
    const rows = buildDiffRows(item.result);
    const meta = rows.find(r => r.type === 'meta')?.content ?? '';
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box gap={1}>
          <Text color={theme.status.success}>◆</Text>
          <Text bold color={theme.syntax.keyword}>git_diff</Text>
          {item.argsSummary && <Text color={theme.text.dim}>({item.argsSummary})</Text>}
          <Text color={theme.text.dim}>· {item.ms}ms</Text>
        </Box>
        <Box marginLeft={4} flexDirection="column">
          {meta ? <Text color={theme.text.dim}>{meta}</Text> : null}
          {rows.filter(r => r.type !== 'meta').map((row, i) => {
            if (row.type === 'hunk') return <Box key={i}><Text color={theme.syntax.keyword}>{row.content.slice(0, 72)}</Text></Box>;
            const pad = (n: number | null) => n !== null ? String(n).padStart(3) : '   ';
            const marker = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
            const bg = row.type === 'add' ? 'green' : row.type === 'del' ? 'red' : undefined;
            const fg = row.type === 'ctx' ? theme.text.dim : 'white';
            return (
              <Box key={i}>
                <Text color={theme.text.dim}>{pad(row.oldNum)} {pad(row.newNum)} </Text>
                <Text backgroundColor={bg} color={fg} bold={row.type !== 'ctx'}>{marker} {row.content.slice(0, 68)}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  if (item.kind === 'tool') {
    const icon  = item.success ? '◆' : '✗';
    const ic    = item.success ? theme.status.success : theme.status.error;
    const rc    = item.success ? theme.text.secondary : theme.status.error;
    const lines = item.result.slice(0, 360).split('\n');
    const trunc = item.result.length > 360;
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box gap={1}>
          <Text color={ic}>{icon}</Text>
          <Text bold color={theme.syntax.keyword}>{item.toolName}</Text>
          {item.argsSummary && <Text color={theme.text.dim}>({item.argsSummary})</Text>}
          <Text color={theme.text.dim}>· {item.ms}ms</Text>
        </Box>
        {lines.map((line, i) => (
          <Box key={i} marginLeft={2}>
            <Text color={theme.text.dim}>{i === 0 ? '└ ' : '  '}</Text>
            <Text color={diffLineColor(line, rc)}>
              {line}{i === lines.length - 1 && trunc ? '…' : ''}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  if (item.kind === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={theme.role.assistant} bold>{'◆'}</Text>
          <Text color={theme.role.assistant} bold>Assistant</Text>
        </Box>
        <Box marginLeft={2} flexDirection="column">
          <MarkdownBlock text={item.text} />
        </Box>
      </Box>
    );
  }

  if (item.kind === 'system') {
    return (
      <Box marginTop={1} gap={1}>
        <Text color={theme.status.warning}>{'!'}</Text>
        <Text color={theme.text.secondary}>{item.text}</Text>
      </Box>
    );
  }

  return null;
});

// ─── Main component ───────────────────────────────────────────────────────────

interface UnifiedSessionProps {
  initialTask?: string;
  resumeSession?: Session;
  mockMode?: boolean;
  onComplete?: () => void;
  onShowSessions?: () => void;
}

export const UnifiedSession: React.FC<UnifiedSessionProps> = ({
  initialTask, resumeSession, mockMode, onComplete, onShowSessions
}) => {
  const { stdout } = useStdout();
  const [termCols, setTermCols] = useState(stdout.columns || 80);
  const [termRows, setTermRows] = useState(stdout.rows || 24);

  useEffect(() => {
    const onResize = () => { setTermCols(stdout.columns || 80); setTermRows(stdout.rows || 24); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

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
  const [scrollUp,        setScrollUp]        = useState(0);
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

  const CWD = process.cwd().replace(os.homedir(), '~');

  const ctxPct   = contextWindow > 0 ? Math.round((tokenUsage / contextWindow) * 100) : 0;
  const ctxColor = ctxPct >= 90 ? theme.status.error : ctxPct >= 75 ? theme.status.warning : theme.text.dim;

  // ── Helpers ────────────────────────────────────────────────

  const push = useCallback((item: NewItem) => {
    const id = String(idRef.current++);
    setCompleted(prev => [...prev, { ...item, id }]);
  }, []);

  const clearAll = useCallback(() => {
    setCompleted([]);
    setFileChanges([]);
    setToolLog([]);
    setScrollUp(0);
    idRef.current = 0;
  }, []);

  const clearStream = useCallback(() => {
    setStreamThinking('');
    setStreamResponse('');
  }, []);

  // Track file changes from tool results
  const trackFileChange = useCallback((toolName: string, obs: Observation) => {
    const p = obs.input.path as string | undefined;
    if (!p) return;
    if (toolName === 'write_file' && obs.success) {
      setFileChanges(prev => {
        const exists = prev.some(f => f.path === p);
        return exists ? prev : [...prev, { path: p, type: 'A' }];
      });
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
    mgr.init().then(() => {
      if (resumeSession) {
        historyToRestoreRef.current = resumeSession.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user'|'assistant', content: m.content }));
        for (const msg of resumeSession.messages) {
          if (msg.role === 'user')      push({ kind: 'user', text: msg.content });
          else if (msg.role === 'assistant') push({ kind: 'assistant', text: msg.content });
        }
        push({ kind: 'system', text: `Resumed session: ${resumeSession.name}` });
        mgr.create(resumeSession.model || (process.env.LLM_MODEL ?? 'qwen3.5:latest'),
                   resumeSession.provider || (process.env.LLM_PROVIDER ?? 'ollama'));
        mgr.setName(resumeSession.name);
      } else {
        mgr.create(process.env.LLM_MODEL ?? 'qwen3.5:latest', process.env.LLM_PROVIDER ?? 'ollama');
      }
      if (initialTask) runTask(initialTask);
    }).catch(() => { if (initialTask) runTask(initialTask); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mock mode: run immediately with fake event stream
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
    setScrollUp(0);

    const mgr = sessionMgrRef.current;
    mgr?.addMessage('user', task);

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
            // name session after first run
            if (isFirst) {
              const llm = runtime.getRuntimeLLM();
              if (llm) {
                llm.generateSessionName(task).then(name => {
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
          push({ kind: 'plan', stepCount: event.plan.steps.length, first: event.plan.steps[0] ?? '' });
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
          const obs  = event.observation;
          const ms   = Date.now() - toolStartMs.current;
          const tid  = runningToolIdRef.current;
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

        if (event.type === 'complete') {
          clearStream();
          setIsThinking(false);
          push({ kind: 'assistant', text: event.finalResponse });
          setTurns(t => t + 1);
          mgr?.addMessage('assistant', event.finalResponse);
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
  }, [push, initRuntime, contextWindow, contextWarned, trackFileChange, mockMode]);

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
      const provider = process.env.LLM_PROVIDER || 'ollama';
      if (provider === 'ollama') {
        import('../../planner/providers/ollama.js').then(async ({ OllamaProvider, findOllamaModelsDirs }: any) => {
          const p = new OllamaProvider(currentModel, process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
          const [models, dirs] = await Promise.all([p.listModels(), findOllamaModelsDirs()]);
          push({ kind: 'system', text: `current: ${currentModel}  available: ${models.join(', ')}  dir: ${dirs[0]?.path ?? '~/.ollama/models'}  /model <name> to switch` });
        }).catch(() => push({ kind: 'system', text: `current: ${currentModel} (${provider})` }));
      } else {
        push({ kind: 'system', text: `current: ${currentModel} (${provider})` });
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
    if (isRunning) return;
    runTask(val);
  }, [isRunning, clearAll, push, onShowSessions, currentModel, initRuntime, runTask]);

  // ── Input submit ───────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const val = input.trim();
    if (!val) return;
    setInput('');
    setHistoryIdx(-1);
    setInputHistory(prev => [val, ...prev.slice(0, 49)]);

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

  useInput((char, key) => {
    // Ctrl+C — interrupt
    if (key.ctrl && char === 'c' && isRunning) {
      runtimeRef.current?.abort();
      setIsRunning(false);
      setAgentStatus('idle');
      return;
    }
    // Ctrl+L — clear
    if (key.ctrl && char === 'l') { clearAll(); return; }
    // Ctrl+K — command palette toggle (only when not in palette)
    if (key.ctrl && char === 'k' && !showPalette) { setShowPalette(true); return; }

    // Tab — cycle panel focus
    if (key.tab) {
      const idx = FOCUS_CYCLE.indexOf(focus);
      const next = key.shift
        ? FOCUS_CYCLE[(idx - 1 + FOCUS_CYCLE.length) % FOCUS_CYCLE.length]
        : FOCUS_CYCLE[(idx + 1) % FOCUS_CYCLE.length];
      setFocus(next);
      return;
    }

    // Conversation panel navigation
    if (focus === 'conv') {
      if (key.upArrow || char === 'k')   { setScrollUp(s => s + 3); return; }
      if (key.downArrow || char === 'j') { setScrollUp(s => Math.max(0, s - 3)); return; }
      if (char === 'g') { setScrollUp(999); return; }
      if (char === 'G') { setScrollUp(0); return; }
    }

    // Input history navigation (only when input is focused and matches)
    if (focus === 'input') {
      if (key.upArrow && input === '') {
        const newIdx = Math.min(historyIdx + 1, inputHistory.length - 1);
        if (newIdx >= 0 && newIdx < inputHistory.length) {
          setHistoryIdx(newIdx);
          setInput(inputHistory[newIdx] ?? '');
        }
        return;
      }
      if (key.downArrow && historyIdx >= 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(newIdx >= 0 ? (inputHistory[newIdx] ?? '') : '');
        return;
      }
    }

    // Quit with q when input is empty and not running
    if (char === 'q' && input === '' && !isRunning && focus === 'input') {
      process.exit(0);
    }
  }, { isActive: !showPalette });

  // ── Layout heights ────────────────────────────────────────
  // palette lives between content row and input — reduce convH when shown

  const paletteH = showPalette ? 12 : 0;
  const convH    = Math.max(6, termRows - 3 - paletteH - 4);

  // sidebar panel heights — sum must equal convH
  const filesH = Math.max(4, Math.floor(convH * 0.27));
  const toolsH = Math.max(5, Math.floor(convH * 0.44));
  const ctxH   = Math.max(4, convH - filesH - toolsH);

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

  const footerHint = focus === 'conv'
    ? '↑↓/jk · scroll   g · top   G · bottom   Tab · panels'
    : focus !== 'input'
    ? '↑↓ · scroll   Tab · panels'
    : isRunning
    ? 'stop · cancel   Ctrl+C · interrupt   Ctrl+K · cmds'
    : 'Enter · submit   ↑ · history   Tab · panels   Ctrl+K · cmds';

  const convBorder  = focus === 'conv' ? theme.border.active : theme.border.normal;
  const scrollPadH  = scrollUp > 0 ? Math.min(scrollUp, convH - 6) : 0;

  // ─── Render ───────────────────────────────────────────────

  return (
    <Box flexDirection="column" height={termRows}>

      {/* ── Header — shared component, matches welcome screen ── */}
      <AppHeader
        model={currentModel}
        tokenUsage={tokenUsage}
        timeDisplay={`${mm}:${ss}`}
      />

      {/* ── Content row — fixed height, sidebar always visible ── */}
      <Box flexDirection="row" gap={1} height={convH}>

        {/* Left: conversation panel */}
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={convBorder}>
          {/* Panel title */}
          <Box paddingX={1}>
            <Text color={theme.text.secondary} bold>Conversation</Text>
            {scrollUp > 0 && <Text color={theme.text.dim}> ↑ scrolled</Text>}
            {turns > 0 && <Text color={theme.text.dim}> · turn {turns}</Text>}
          </Box>

          {/* column-reverse: newest content at bottom, old content clips at top */}
          <Box flexDirection="column-reverse" flexGrow={1} overflow="hidden">

            {/* Scroll padding — pushes content up when user scrolls */}
            {scrollPadH > 0 && <Box height={scrollPadH} flexShrink={0} />}

            {/* Help panel — bottom of reversed area when shown */}
            {showHelp && (
              <Box flexDirection="column" borderStyle="single" borderColor={theme.border.normal}
                paddingX={2} paddingY={1} marginX={1} marginBottom={1}>
                <Text bold color={theme.brand}>Commands</Text>
                <Text color={theme.text.dim}>stop / Ctrl+C  · interrupt agent</Text>
                <Text color={theme.text.dim}>/clear /Ctrl+L · clear conversation</Text>
                <Text color={theme.text.dim}>/new           · fresh session</Text>
                <Text color={theme.text.dim}>/sessions      · browse sessions</Text>
                <Text color={theme.text.dim}>/model [name]  · list / switch model</Text>
                <Text color={theme.text.dim}>/theme [mode]  · dark / light / dark-ansi</Text>
                <Text color={theme.text.dim}>Ctrl+K         · command palette</Text>
                <Text color={theme.text.dim}>Tab            · cycle panel focus</Text>
                <Text color={theme.text.dim}>?              · toggle this help</Text>
              </Box>
            )}

            {/* Approval panel — bottom of content, input stays focused */}
            {approvalRequest && (
              <Box flexDirection="column" borderStyle="round"
                borderColor={theme.status.warning} paddingX={2} paddingY={1}
                marginX={1} marginBottom={1}>
                <Box gap={1}>
                  <Text color={theme.status.warning}>⚠</Text>
                  <Text bold color={theme.text.primary}>Approval needed —</Text>
                  <Text bold color={theme.syntax.keyword}>{approvalRequest.toolName}</Text>
                  {approvalRequest.args['path'] != null && (
                    <Text color={theme.text.dim}>→ {String(approvalRequest.args['path'])}</Text>
                  )}
                </Box>
                {approvalRequest.toolName === 'edit_file' && (
                  <Box flexDirection="column" marginTop={1}>
                    {String(approvalRequest.args['find'] ?? '').split('\n').map((l, i) => (
                      <Box key={`f${i}`} gap={1}><Text color={theme.diff.deleted}>─</Text><Text color={theme.diff.deleted}>{l.slice(0, 100)}</Text></Box>
                    ))}
                    {String(approvalRequest.args['replace'] ?? '').split('\n').map((l, i) => (
                      <Box key={`r${i}`} gap={1}><Text color={theme.diff.added}>+</Text><Text color={theme.diff.added}>{l.slice(0, 100)}</Text></Box>
                    ))}
                  </Box>
                )}
                {approvalRequest.toolName === 'bash' && approvalRequest.args['command'] != null && (
                  <Box marginTop={1}>
                    <Text color={theme.syntax.keyword}>$ </Text>
                    <Text color={theme.text.dim}>{String(approvalRequest.args['command']).slice(0, 120)}</Text>
                  </Box>
                )}
                {approvalRequest.reasoning && (
                  <Text color={theme.text.dim}>{approvalRequest.reasoning.slice(0, 120)}</Text>
                )}
                <Box marginTop={1} gap={3}>
                  <Text color={theme.status.success}>[y] Approve</Text>
                  <Text color={theme.status.error}>[n] Deny</Text>
                </Box>
              </Box>
            )}

            {/* Context warning */}
            {ctxPct >= 80 && (
              <Box borderStyle="round"
                borderColor={ctxPct >= 90 ? theme.status.error : theme.status.warning}
                paddingX={2} marginX={1} marginBottom={1}>
                <Text color={ctxPct >= 90 ? theme.status.error : theme.status.warning}>
                  {ctxPct >= 90 ? `Context ${ctxPct}% full — /new now` : `Context ${ctxPct}% full — consider /new`}
                </Text>
              </Box>
            )}

            {/* Live: active tool */}
            {activeTool && (
              <Box marginLeft={2} marginTop={1} gap={1}>
                <BrailleSpinner color={theme.status.running} />
                <Text bold color={theme.syntax.keyword}>{activeTool.toolName}</Text>
                {activeTool.argsSummary && <Text color={theme.text.dim}>({activeTool.argsSummary})</Text>}
              </Box>
            )}

            {/* Live: streaming thinking */}
            {isRunning && streamThinking && (
              <Box marginLeft={2} marginTop={1} gap={1}>
                <BrailleSpinner color={theme.status.running} />
                <Text color={theme.text.dim}>
                  {streamThinking.length > 160 ? '…' + streamThinking.slice(-160) : streamThinking}
                </Text>
              </Box>
            )}

            {/* Live: streaming response */}
            {isRunning && !streamThinking && streamResponse && (
              <Box marginLeft={2} marginTop={1} gap={1}>
                <Text color={theme.role.assistant}>◆ </Text>
                <Text color={theme.text.primary}>{streamResponse}</Text>
              </Box>
            )}

            {/* Live: fallback spinner */}
            {isThinking && !activeTool && !streamThinking && !streamResponse && (
              <Box marginLeft={2} marginTop={1} gap={1}>
                <BrailleSpinner color={theme.status.running} />
                <Text color={theme.text.secondary}>
                  {agentStatus === 'planning' ? 'Planning…' : 'Thinking…'}
                </Text>
              </Box>
            )}

            {/* Completed messages — reversed so newest sits at bottom */}
            {[...completed].reverse().map(item => (
              <ItemView key={item.id} item={item} />
            ))}
          </Box>

          <Box height={1} />
        </Box>

        {/* Right: sidebar — always visible because in the fixed-height row */}
        {useSidebar && (
          <Box flexDirection="column" width={sideWidth} height={convH}>
            <FilesPanel files={fileChanges} focused={focus === 'files'} height={filesH} />
            <ToolsPanel tools={toolLog}     focused={focus === 'tools'} height={toolsH} />
            <ContextPanel used={tokenUsage} total={contextWindow} focused={focus === 'ctx'} height={ctxH} />
          </Box>
        )}
      </Box>

      {/* ── Command palette — shrinks convH when visible ──────── */}
      {showPalette && (
        <CommandPalette
          onSelect={cmd => { setInput(''); handleCommand(cmd); }}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* ── Input bar — 3 rows ────────────────────────────────── */}
      <Box height={3} borderStyle="round" borderColor={inputBorder} paddingX={2}>
        <Text color={isRunning ? theme.status.running : theme.role.user}>{'> '}</Text>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={inputPlaceholder}
            focus={focus === 'input' && !showPalette}
          />
        </Box>
        {input.length > 0 && (
          <Text color={theme.text.dim}>{input.length}</Text>
        )}
      </Box>

      {/* ── Footer — 1 row ────────────────────────────────────── */}
      <Box height={1} paddingX={2}>
        <Text color={theme.text.dim}>{footerHint}</Text>
      </Box>

    </Box>
  );
};
