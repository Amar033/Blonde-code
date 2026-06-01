import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text, Static, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { AgentRuntime, type ApprovalCallback } from '../../runtime/core.js';
import { ToolRegistry } from '../../tools/registry.js';
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

  // Tool call result
  if (item.kind === 'tool') {
    const icon       = item.success ? '◆' : '✗';
    const iconColor  = item.success ? colors.success : colors.error;
    const resultColor = item.success ? colors.textMuted : colors.error;

    // Split multi-line results (e.g. edit_file diff lines)
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
            <Text color={
              line.startsWith('  - ') ? colors.error :
              line.startsWith('  + ') ? colors.success :
              resultColor
            }>{line}{i === lines.length - 1 && truncated ? '…' : ''}</Text>
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
  onComplete?: () => void;
}

export const UnifiedSession: React.FC<UnifiedSessionProps> = ({ initialTask, onComplete }) => {
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

  const idRef              = useRef(0);
  const toolStartMs        = useRef(Date.now());
  const runtimeRef         = useRef<AgentRuntime | null>(null);
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);

  const MODEL      = process.env.LLM_MODEL || 'qwen3.5:latest';
  const CWD        = process.cwd().replace(os.homedir(), '~');
  const toolCount  = runtimeRef.current?.getToolCount() ?? '…';

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

  // ── Runtime init ─────────────────────────────────────────

  const initRuntime = useCallback(async () => {
    if (!runtimeRef.current) {
      const reg = new ToolRegistry();
      runtimeRef.current = new AgentRuntime(reg, { maxTurns: 30, maxLoopCount: 20, debug: false });
      runtimeRef.current.setApprovalCallback(makeApprovalCallback());
      await runtimeRef.current.initialize();
    }
    return runtimeRef.current;
  }, [makeApprovalCallback]);

  // ── Agent runner ─────────────────────────────────────────

  const runTask = useCallback(async (task: string) => {
    push({ kind: 'user', text: task });
    setIsRunning(true);
    setIsThinking(true);
    setAgentStatus('planning');

    try {
      const runtime = await initRuntime();

      for await (const event of runtime.run(task)) {
        setAgentStatus(runtime.getState().status);

        if (event.type === 'plan_generated') {
          push({
            kind: 'plan',
            stepCount: event.plan.steps.length,
            first: event.plan.steps[0] ?? '',
          });
          setIsThinking(false);
        }

        if (event.type === 'llm_response' && event.parsed.type === 'tool_call') {
          toolStartMs.current = Date.now();
          setActiveTool({
            toolName:    event.parsed.tool,
            argsSummary: argSummary(event.parsed.tool, event.parsed.args),
          });
        }

        if (event.type === 'observation_ready') {
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
          setIsThinking(false);
          push({ kind: 'assistant', lines: toLines(event.finalResponse) });
          setTurns(t => t + 1);
        }

        if (event.type === 'abort') {
          setIsThinking(false);
          push({ kind: 'system', text: `Stopped: ${event.reason}` });
        }
      }
    } catch (err) {
      push({ kind: 'system', text: `Error: ${err}` });
    } finally {
      setIsRunning(false);
      setIsThinking(false);
      setActiveTool(null);
      setAgentStatus('idle');
    }
  }, [push, initRuntime]);

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
    if (val === '/model') {
      push({ kind: 'system', text: `Model: ${process.env.LLM_MODEL || 'qwen3.5:latest'} via ${process.env.LLM_PROVIDER || 'ollama'}. Change LLM_MODEL in .env to switch.` });
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

  useEffect(() => {
    if (initialTask) runTask(initialTask);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── Live: thinking / planning ────────────────────────── */}
      {isThinking && !activeTool && (
        <Box marginLeft={2} marginTop={1} gap={1}>
          <Text color={colors.thinking}><Spinner /></Text>
          <Text dimColor>
            {agentStatus === 'planning' ? 'Planning…' : 'Thinking…'}
          </Text>
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
            <Text bold color={colors.text}>Approval needed</Text>
          </Box>
          <Box gap={1} marginTop={0}>
            <Text dimColor>{approvalRequest.toolName}</Text>
            {approvalRequest.args['path'] != null && (
              <Text color={colors.keyword}>→ {String(approvalRequest.args['path'])}</Text>
            )}
          </Box>
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

      {/* ── Status bar ───────────────────────────────────────── */}
      <Box marginTop={0} paddingX={1} gap={2}>
        <Text bold color={colors.brand}>BLONDE</Text>
        <Text dimColor>─</Text>
        <Text dimColor>{MODEL}</Text>
        <Text dimColor>─</Text>
        <Text dimColor>{CWD}</Text>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{toolCount} tools</Text>
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
          <Text dimColor>stop     · cancel the running agent</Text>
          <Text dimColor>clear    · clear conversation history</Text>
          <Text dimColor>?        · toggle this help panel</Text>
          <Text dimColor>ctrl+c   · interrupt agent</Text>
          <Text dimColor>ctrl+l   · clear screen</Text>
        </Box>
      )}

    </Box>
  );
};
