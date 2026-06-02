import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, Static, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { AgentRuntime, type ApprovalCallback } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';
import { SessionManager, type Session } from '../../sessions/session-manager.js';
import { colors } from '../design-system.js';
import type { Plan, Observation } from '../../types/agent.js';
import os from 'os';

interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NewItem =
  | { kind: 'user';      text: string }
  | { kind: 'assistant'; lines: string[] }
  | { kind: 'tool';      toolName: string; argsSummary: string; result: string; success: boolean; ms: number }
  | { kind: 'plan';      stepCount: number; first: string }
  | { kind: 'system';    text: string };

type CompletedItem = NewItem & { id: string };

interface ActiveTool {
  toolName: string;
  argsSummary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Convert markdown to clean terminal lines
function toLines(md: string): string[] {
  const lines = md.split('\n').map(line =>
    line
      .replace(/^#{1,6}\s+(.*)/, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/^\s{0,3}[-*+]\s+/, '  • ')
      .replace(/^\s{0,3}\d+\.\s+/, '  ')
  );
  return lines.filter((line, i, arr) =>
    !(line.trim() === '' && (arr[i - 1]?.trim() ?? 'x') === '')
  );
}

function argSummary(name: string, args: Record<string, unknown>): string {
  const v = args.path ?? args.command ?? args.pattern ?? args.query ?? args.url ?? args.find;
  if (v !== undefined) return String(v).slice(0, 55);
  const k = Object.keys(args)[0];
  return k ? `${k}: ${String(args[k]).slice(0, 40)}` : '';
}

// ─── Diff parser & renderer ───────────────────────────────────────────────────

interface DiffRow {
  oldNum: number | null;
  newNum: number | null;
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  content: string;
}

function buildDiffRows(summary: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNum = 1;
  let newNum = 1;

  for (const raw of summary.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNum = parseInt(m[1], 10); newNum = parseInt(m[2], 10); }
      rows.push({ oldNum: null, newNum: null, type: 'hunk', content: raw });
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      rows.push({ oldNum: null, newNum: null, type: 'meta', content: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ oldNum: null, newNum: newNum++, type: 'add', content: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ oldNum: oldNum++, newNum: null, type: 'del', content: raw.slice(1) });
      continue;
    }
    if (raw.startsWith(' ')) {
      rows.push({ oldNum: oldNum++, newNum: newNum++, type: 'ctx', content: raw.slice(1) });
      continue;
    }
    rows.push({ oldNum: null, newNum: null, type: 'meta', content: raw });
  }

  return rows;
}

// Colour a single line of unified diff output
function diffLineColor(line: string, fallback: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return colors.success;
  if (line.startsWith('-') && !line.startsWith('---')) return colors.error;
  if (line.startsWith('@@'))  return colors.keyword;
  if (line.startsWith('+++') || line.startsWith('---')) return colors.textMuted;
  // edit_file summary uses indented "  + " / "  - " markers
  if (line.startsWith('  + ')) return colors.success;
  if (line.startsWith('  - ')) return colors.error;
  return fallback;
}

// ─── Item renderer (inside Static) ───────────────────────────────────────────

const ItemView: React.FC<{ item: CompletedItem }> = ({ item }) => {
  // User message — compact single line with ▸ prefix
  if (item.kind === 'user') {
    return (
      <Box marginTop={1} gap={1}>
        <Text color={colors.brand} bold>{'▸'}</Text>
        <Text color={colors.text}>{item.text}</Text>
      </Box>
    );
  }

  // Plan indicator — keep on one line to avoid Ink flex-wrap artifacts
  if (item.kind === 'plan') {
    const desc = item.first.length > 58 ? item.first.slice(0, 58) + '…' : item.first;
    return (
      <Box marginLeft={2} marginTop={1} gap={1}>
        <Text dimColor>◦</Text>
        <Text color={colors.textMuted}>Planning {item.stepCount} steps</Text>
        <Text dimColor>— {desc}</Text>
      </Box>
    );
  }

  // git_diff — line-numbered diff renderer
  if (item.kind === 'tool' && item.toolName === 'git_diff' && item.success) {
    const rows = buildDiffRows(item.result);
    const metaLine = rows.find(r => r.type === 'meta')?.content ?? '';
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={0}>
        <Box gap={1}>
          <Text color={colors.success}>◆</Text>
          <Text bold color={colors.keyword}>git_diff</Text>
          {item.argsSummary && <Text dimColor>({item.argsSummary})</Text>}
          <Text dimColor>· {item.ms}ms</Text>
        </Box>
        <Box marginLeft={4} flexDirection="column">
          {metaLine ? <Text dimColor>{metaLine}</Text> : null}
          {rows.filter(r => r.type !== 'meta').map((row, i) => {
            if (row.type === 'hunk') {
              return <Box key={i}><Text color={colors.keyword}>{row.content.slice(0, 72)}</Text></Box>;
            }
            const pad = (n: number | null) => n !== null ? String(n).padStart(3) : '   ';
            const marker = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
            const bg  = row.type === 'add' ? 'green' : row.type === 'del' ? 'red' : undefined;
            const fg  = row.type === 'ctx' ? colors.textMuted : 'white';
            return (
              <Box key={i}>
                <Text dimColor>{pad(row.oldNum)} {pad(row.newNum)} </Text>
                <Text backgroundColor={bg} color={fg} bold={row.type !== 'ctx'}>{marker} {row.content.slice(0, 68)}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  // Tool call result
  if (item.kind === 'tool') {
    const icon       = item.success ? '◆' : '✗';
    const iconColor  = item.success ? colors.success : colors.error;
    const resultColor = item.success ? colors.textMuted : colors.error;

    const fullText   = item.result.slice(0, 360);
    const truncated  = item.result.length > 360;
    const lines      = fullText.split('\n');

    return (
      <Box flexDirection="column" marginLeft={2} marginTop={0}>
        <Box gap={1}>
          <Text color={iconColor}>{icon}</Text>
          <Text bold color={colors.keyword}>{item.toolName}</Text>
          {item.argsSummary && <Text dimColor>({item.argsSummary})</Text>}
          <Text dimColor>· {item.ms}ms</Text>
        </Box>
        {lines.map((line, i) => (
          <Box key={i} marginLeft={2}>
            <Text dimColor>{i === 0 ? '└ ' : '  '}</Text>
            <Text color={diffLineColor(line, resultColor)}>
              {line}{i === lines.length - 1 && truncated ? '…' : ''}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  // Assistant response
  if (item.kind === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {item.lines.map((line, i) => {
          const isEmpty = line.trim() === '';
          if (i === 0) {
            return (
              <Box key={i} gap={0}>
                <Text color={colors.success}>{'● '}</Text>
                <Text color={colors.text}>{line}</Text>
              </Box>
            );
          }
          return (
            <Box key={i}>
              <Text color={isEmpty ? undefined : colors.text}>{'  '}{line}</Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  // System notice
  if (item.kind === 'system') {
    return (
      <Box marginTop={1} gap={1}>
        <Text color={colors.warning}>{'!'}</Text>
        <Text color={colors.textMuted}>{item.text}</Text>
      </Box>
    );
  }

  return null;
};

// ─── Main component ───────────────────────────────────────────────────────────

interface UnifiedSessionProps {
  initialTask?: string;
  resumeSession?: Session;
  onComplete?: () => void;
  onShowSessions?: () => void;
}

export const UnifiedSession: React.FC<UnifiedSessionProps> = ({
  initialTask, resumeSession, onComplete, onShowSessions
}) => {
  const [completed,       setCompleted]       = useState<CompletedItem[]>([]);
  const [clearKey,        setClearKey]        = useState(0);
  const [activeTool,      setActiveTool]      = useState<ActiveTool | null>(null);
  const [isThinking,      setIsThinking]      = useState(false);
  const [agentStatus,     setAgentStatus]     = useState('idle');
  const [isRunning,       setIsRunning]       = useState(false);
  const [input,           setInput]           = useState('');
  const [turns,           setTurns]           = useState(0);
  const [showHelp,        setShowHelp]        = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [currentModel,    setCurrentModel]    = useState(process.env.LLM_MODEL || 'qwen3.5:latest');
  const [tokenUsage,      setTokenUsage]      = useState(0);
  const [contextWindow,   setContextWindow]   = useState(8192);
  const [contextWarned,   setContextWarned]   = useState(false);
  const [streamThinking,  setStreamThinking]  = useState('');   // <think> content live
  const [streamResponse,  setStreamResponse]  = useState('');   // clean response tokens live

  const idRef              = useRef(0);
  const toolStartMs        = useRef(Date.now());
  const runtimeRef         = useRef<AgentRuntime | null>(null);
  // Single shared promise so concurrent initRuntime() calls don't double-initialize
  const initPromiseRef     = useRef<Promise<AgentRuntime> | null>(null);
  const sessionMgrRef      = useRef<SessionManager | null>(null);
  const approvalResolveRef  = useRef<((approved: boolean) => void) | null>(null);
  const firstMessageRef     = useRef<string | null>(null);
  // Holds session turns to restore into the runtime on first task after a session resume
  const historyToRestoreRef = useRef<Array<{role: 'user' | 'assistant'; content: string}> | null>(null);

  const CWD       = process.cwd().replace(os.homedir(), '~');
  const toolCount = runtimeRef.current?.getToolCount() ?? '…';

  // Context usage as a percentage
  const ctxPct     = contextWindow > 0 ? Math.round((tokenUsage / contextWindow) * 100) : 0;
  const ctxColor   = ctxPct >= 90 ? colors.error : ctxPct >= 75 ? colors.warning : colors.textMuted;
  const ctxWarning = ctxPct >= 80 && !contextWarned;

  // ── Helpers ──────────────────────────────────────────────

  const push = useCallback((item: NewItem) => {
    const id = String(idRef.current++);
    setCompleted(prev => [...prev, { ...item, id }]);
  }, []);

  const clearAll = useCallback(() => {
    setCompleted([]);
    idRef.current = 0;
    setClearKey(k => k + 1);
  }, []);

  const clearStream = useCallback(() => {
    setStreamThinking('');
    setStreamResponse('');
  }, []);

  // ── Approval callback ────────────────────────────────────

  const makeApprovalCallback = useCallback((): ApprovalCallback => {
    return (toolName, args, reasoning) =>
      new Promise<boolean>(resolve => {
        setApprovalRequest({ toolName, args, reasoning });
        approvalResolveRef.current = (approved: boolean) => {
          setApprovalRequest(null);
          approvalResolveRef.current = null;
          resolve(approved);
        };
      });
  }, []);

  // ── Session manager init + initial task ─────────────────
  // Combined into ONE effect so session replay always finishes before runTask starts.
  // Splitting them into two effects caused a race: the new task could complete and push
  // its response before mgr.init() resolved, making old messages appear after new ones
  // (producing apparent duplicate responses and a late "Resumed session" message).

  useEffect(() => {
    const mgr = new SessionManager();
    sessionMgrRef.current = mgr;

    mgr.init().then(() => {
      if (resumeSession) {
        // Stage conversation history for the runtime to load on first task
        historyToRestoreRef.current = resumeSession.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        // Replay past messages into the UI
        for (const msg of resumeSession.messages) {
          if (msg.role === 'user') {
            push({ kind: 'user', text: msg.content });
          } else if (msg.role === 'assistant') {
            push({ kind: 'assistant', lines: toLines(msg.content) });
          }
        }
        push({ kind: 'system', text: `Resumed session: ${resumeSession.name}` });
        mgr.create(
          resumeSession.model  || (process.env.LLM_MODEL     ?? 'qwen3.5:latest'),
          resumeSession.provider || (process.env.LLM_PROVIDER ?? 'ollama')
        );
        mgr.setName(resumeSession.name);
      } else {
        mgr.create(
          process.env.LLM_MODEL     ?? 'qwen3.5:latest',
          process.env.LLM_PROVIDER  ?? 'ollama'
        );
      }

      // Start initial task only after session is fully set up
      if (initialTask) runTask(initialTask);
    }).catch(() => {
      // Init failed — still attempt the task
      if (initialTask) runTask(initialTask);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Runtime init ─────────────────────────────────────────

  const initRuntime = useCallback(async (model?: string) => {
    // Model switch — discard current runtime and shared promise
    if (model && model !== currentModel) {
      runtimeRef.current = null;
      initPromiseRef.current = null;
      process.env.LLM_MODEL = model;
      setCurrentModel(model);
    }

    // Already initialized — return directly
    if (runtimeRef.current) return runtimeRef.current;

    // If initialization is already in flight, wait for the same promise.
    // This prevents double-initialization when initRuntime() is called concurrently.
    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const reg = new ToolRegistry();
        const rt  = new AgentRuntime(reg, { maxTurns: 30, maxLoopCount: 20, debug: false });
        rt.setApprovalCallback(makeApprovalCallback());
        await rt.initialize();
        // Only store in ref AFTER initialize() fully resolves
        runtimeRef.current = rt;
        const ctxWin = await rt.getContextWindow();
        setContextWindow(ctxWin);
        return rt;
      })();
    }

    return initPromiseRef.current;
  }, [makeApprovalCallback, currentModel]);

  // ── Agent runner ─────────────────────────────────────────

  const runTask = useCallback(async (task: string) => {
    push({ kind: 'user', text: task });
    setIsRunning(true);
    setIsThinking(true);
    setAgentStatus('planning');

    const mgr = sessionMgrRef.current;
    mgr?.addMessage('user', task);

    try {
      // Initialize runtime first — safe to await before doing anything else
      const runtime = await initRuntime();

      // Restore conversation history on first task after a resumed session
      if (historyToRestoreRef.current) {
        runtime.loadConversationHistory(historyToRestoreRef.current);
        historyToRestoreRef.current = null;
      }

      const isFirstMessage = mgr && !firstMessageRef.current;
      if (isFirstMessage) firstMessageRef.current = task;

      for await (const event of runtime.run(task)) {
        setAgentStatus(runtime.getState().status);

        // Update token usage after every LLM response
        const usage = runtime.getTokenUsage();
        if (usage > 0) {
          setTokenUsage(usage);
          mgr?.updateTokenUsage(usage);
        }

        // Live token stream — update thinking / response text in real time
        if (event.type === 'llm_streaming') {
          if (event.inThinkBlock) {
            // Still inside <think>...</think> — show only the thinking text
            setStreamThinking(event.thinking ?? '');
            setStreamResponse('');
          } else if (event.thinking) {
            // Think block finished, clean response may be arriving
            setStreamThinking(event.thinking);
            // Show the clean part after </think>
            const thinkEnd = event.delta.indexOf('</think>');
            const cleaned = thinkEnd !== -1
              ? event.delta.slice(thinkEnd + '</think>'.length).trim()
              : event.delta.replace(/<think>[\s\S]*<\/think>/g, '').trim();
            setStreamResponse(cleaned);
          } else {
            // No think block — raw model output streaming (e.g. non-thinking model)
            setStreamResponse(event.delta.slice(0, 300));
          }
        }

        if (event.type === 'plan_generated') {
          clearStream();
          push({
            kind: 'plan',
            stepCount: event.plan.steps.length,
            first: event.plan.steps[0] ?? '',
          });
          setIsThinking(false);
        }

        if (event.type === 'llm_response' && event.parsed.type === 'tool_call') {
          clearStream();
          toolStartMs.current = Date.now();
          setActiveTool({
            toolName:    event.parsed.tool,
            argsSummary: argSummary(event.parsed.tool, event.parsed.args),
          });
        }

        if (event.type === 'observation_ready') {
          clearStream();
          const obs = event.observation;
          const ms  = Date.now() - toolStartMs.current;
          setActiveTool(null);
          push({
            kind:        'tool',
            toolName:    obs.toolName,
            argsSummary: argSummary(obs.toolName, obs.input),
            result:      obs.summary,
            success:     obs.success,
            ms,
          });
        }

        if (event.type === 'complete') {
          clearStream();
          setIsThinking(false);
          push({ kind: 'assistant', lines: toLines(event.finalResponse) });
          setTurns(t => t + 1);
          mgr?.addMessage('assistant', event.finalResponse);
          const finalUsage = runtime.getTokenUsage();
          if (finalUsage > 0) {
            setTokenUsage(finalUsage);
            const pct = Math.round((finalUsage / contextWindow) * 100);
            if (pct >= 80 && !contextWarned) {
              setContextWarned(true);
              push({ kind: 'system', text: `Context ${pct}% full (${finalUsage}/${contextWindow} tokens). Consider starting a new session soon.` });
            }
          }
        }

        if (event.type === 'abort') {
          clearStream();
          setIsThinking(false);
          push({ kind: 'system', text: `Stopped: ${event.reason}` });
        }
      }

      // Name the session after planning finishes so it never competes with the main LLM call
      if (isFirstMessage) {
        const llm = runtime.getRuntimeLLM();
        if (llm) {
          llm.generateSessionName(task).then(name => {
            mgr!.setName(name);
            mgr!.save().catch(() => {});
          }).catch(() => {});
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
  }, [push, initRuntime, contextWindow, contextWarned]);

  // ── Input handler ────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const val = input.trim();
    if (!val) return;
    setInput('');

    // Approval flow takes highest priority
    if (approvalRequest && approvalResolveRef.current) {
      const lv = val.toLowerCase();
      if (lv === 'y' || lv === 'yes') { approvalResolveRef.current(true);  return; }
      if (lv === 'n' || lv === 'no')  { approvalResolveRef.current(false); return; }
      push({ kind: 'system', text: `Type 'y' to approve or 'n' to deny.` });
      return;
    }

    // Built-in slash commands / keywords handled in the UI layer
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

    // /model — list or switch
    if (val === '/model' || val === '/models') {
      const provider = process.env.LLM_PROVIDER || 'ollama';
      if (provider === 'ollama') {
        import('../../planner/providers/ollama.js').then(async ({ OllamaProvider, findOllamaModelsDirs }) => {
          const p = new OllamaProvider(currentModel, process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
          const [models, dirs] = await Promise.all([p.listModels(), findOllamaModelsDirs()]);
          const modelsDir = dirs[0]?.path ?? process.env.OLLAMA_MODELS ?? '~/.ollama/models';
          const lines = [
            `Current: ${currentModel}`,
            models.length > 0 ? `Available: ${models.join(', ')}` : 'No models found',
            `Models dir: ${modelsDir}`,
            `Switch with /model <name>`,
          ];
          push({ kind: 'system', text: lines.join('\n') });
        }).catch(() => {
          push({ kind: 'system', text: `Current model: ${currentModel} (via ${provider})` });
        });
      } else {
        push({ kind: 'system', text: `Current model: ${currentModel} (via ${provider})` });
      }
      return;
    }

    if (val.startsWith('/model ')) {
      const newModel = val.slice('/model '.length).trim();
      if (!newModel) return;
      push({ kind: 'system', text: `Switching to ${newModel}…` });
      initRuntime(newModel).then(() => {
        process.env.LLM_MODEL = newModel;
        sessionMgrRef.current?.create(newModel, process.env.LLM_PROVIDER ?? 'ollama');
        push({ kind: 'system', text: `Model switched to ${newModel}` });
      }).catch(err => {
        push({ kind: 'system', text: `Failed to switch model: ${err}` });
      });
      return;
    }

    if (isRunning) return;

    runTask(val);
  }, [input, isRunning, approvalRequest, clearAll, runTask, push]);

  useInput((char, key) => {
    if (key.ctrl && char === 'c' && isRunning) {
      runtimeRef.current?.abort();
      setIsRunning(false);
      setAgentStatus('idle');
    }
    if (key.ctrl && char === 'l') clearAll();
  });

  // ── Derived values ───────────────────────────────────────

  const inputHint   = approvalRequest
    ? "type 'y' to approve or 'n' to deny, then Enter"
    : isRunning
    ? "agent running — type 'stop' to cancel"
    : 'type a task or question...';
  const inputBorder = approvalRequest ? colors.warning : isRunning ? colors.thinking : colors.borderActive;

  // ── Render ───────────────────────────────────────────────

  return (
    <Box flexDirection="column">

      {/* ── Completed messages ───────────────────────────────── */}
      <Static key={clearKey} items={completed}>
        {(item) => <ItemView key={item.id} item={item} />}
      </Static>

      {/* ── Live: active tool running ────────────────────────── */}
      {activeTool && (
        <Box marginLeft={2} marginTop={1} gap={1}>
          <Text color={colors.thinking}><Spinner /></Text>
          <Text bold color={colors.keyword}>{activeTool.toolName}</Text>
          {activeTool.argsSummary && (
            <Text dimColor>({activeTool.argsSummary})</Text>
          )}
        </Box>
      )}

      {/* ── Live: streaming tokens ───────────────────────────── */}
      {isRunning && streamThinking && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Box gap={1}>
            <Text color={colors.thinking}><Spinner /></Text>
            <Text dimColor>
              {streamThinking.length > 200 ? '…' + streamThinking.slice(-200) : streamThinking}
            </Text>
          </Box>
        </Box>
      )}
      {isRunning && !streamThinking && streamResponse && (
        <Box marginLeft={2} marginTop={1} gap={1}>
          <Text color={colors.success}>{'●'}</Text>
          <Text color={colors.text}>{streamResponse.slice(0, 200)}</Text>
        </Box>
      )}

      {/* ── Live: fallback spinner (before first token arrives) ── */}
      {isThinking && !activeTool && !streamThinking && !streamResponse && (
        <Box marginLeft={2} marginTop={1} gap={1}>
          <Text color={colors.thinking}><Spinner /></Text>
          <Text dimColor>{agentStatus === 'planning' ? 'Planning…' : 'Thinking…'}</Text>
        </Box>
      )}

      {/* ── Approval panel ───────────────────────────────────── */}
      {approvalRequest && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={colors.warning}
          paddingX={2}
          paddingY={1}
        >
          <Box gap={1}>
            <Text color={colors.warning}>⚠</Text>
            <Text bold color={colors.text}>Approval needed —</Text>
            <Text bold color={colors.keyword}>{approvalRequest.toolName}</Text>
            {approvalRequest.args['path'] != null && (
              <Text dimColor>→ {String(approvalRequest.args['path'])}</Text>
            )}
          </Box>

          {/* edit_file: show the diff before the user decides */}
          {approvalRequest.toolName === 'edit_file' && (
            <Box flexDirection="column" marginTop={1}>
              {String(approvalRequest.args['find'] ?? '').split('\n').map((l, i) => (
                <Box key={`f${i}`} gap={1}>
                  <Text color={colors.error}>{'─'}</Text>
                  <Text color={colors.error}>{l.slice(0, 100)}</Text>
                </Box>
              ))}
              {String(approvalRequest.args['replace'] ?? '').split('\n').map((l, i) => (
                <Box key={`r${i}`} gap={1}>
                  <Text color={colors.success}>{'+'}</Text>
                  <Text color={colors.success}>{l.slice(0, 100)}</Text>
                </Box>
              ))}
            </Box>
          )}

          {/* bash: show the command */}
          {approvalRequest.toolName === 'bash' && approvalRequest.args['command'] != null && (
            <Box marginTop={1}>
              <Text color={colors.keyword}>$ </Text>
              <Text dimColor>{String(approvalRequest.args['command']).slice(0, 120)}</Text>
            </Box>
          )}

          {approvalRequest.reasoning && (
            <Text dimColor>{approvalRequest.reasoning.slice(0, 120)}</Text>
          )}
          <Box marginTop={1} gap={3}>
            <Text color={colors.success}>[y] Approve</Text>
            <Text color={colors.error}>[n] Deny</Text>
          </Box>
        </Box>
      )}

      {/* ── Input ────────────────────────────────────────────── */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={inputBorder}
        paddingX={2}
      >
        <Text color={isRunning ? colors.warning : colors.brand}>{'→ '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={inputHint}
        />
      </Box>

      {/* ── Context warning ──────────────────────────────────── */}
      {ctxPct >= 80 && (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={ctxPct >= 90 ? colors.error : colors.warning}
          paddingX={2}
          paddingY={0}
        >
          <Text color={ctxPct >= 90 ? colors.error : colors.warning}>
            {ctxPct >= 90
              ? `Context ${ctxPct}% full — start a new session now (/new)`
              : `Context ${ctxPct}% full — approaching limit, consider /new`}
          </Text>
        </Box>
      )}

      {/* ── Status bar ───────────────────────────────────────── */}
      <Box marginTop={0} paddingX={1} gap={2}>
        <Text bold color={colors.brand}>BLONDE</Text>
        <Text dimColor>─</Text>
        <Text dimColor>{currentModel}</Text>
        <Text dimColor>─</Text>
        <Text dimColor>{CWD}</Text>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{toolCount} tools</Text>
        {tokenUsage > 0 && (
          <>
            <Text dimColor>·</Text>
            <Text color={ctxColor}>{ctxPct}% ctx</Text>
          </>
        )}
        {turns > 0 && <><Text dimColor>·</Text><Text dimColor>turn {turns}</Text></>}
        <Text dimColor>·</Text>
        <Text dimColor>{isRunning ? 'stop · ctrl+c' : '? · help'}</Text>
        <Text dimColor>ctrl+l · clear</Text>
      </Box>

      {/* ── Help panel ───────────────────────────────────────── */}
      {showHelp && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor={colors.border}
          paddingX={2}
          paddingY={1}
          flexDirection="column"
        >
          <Text bold color={colors.brand}>Commands</Text>
          <Text dimColor>stop           · cancel the running agent</Text>
          <Text dimColor>clear          · clear conversation history</Text>
          <Text dimColor>/new           · start a fresh session</Text>
          <Text dimColor>/sessions      · browse previous sessions</Text>
          <Text dimColor>/model         · list available models</Text>
          <Text dimColor>/model [name]  · switch to a different model</Text>
          <Text dimColor>?              · toggle this help panel</Text>
          <Text dimColor>ctrl+c         · interrupt agent</Text>
          <Text dimColor>ctrl+l         · clear screen</Text>
        </Box>
      )}

    </Box>
  );
};
