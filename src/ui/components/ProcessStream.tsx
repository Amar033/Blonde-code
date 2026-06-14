import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export interface ProcessStreamProps {
  command: string;
  args:    string[];
  env?:    Record<string, string>;
  onDone:  (exitCode: number) => void;
}

interface Line { text: string; isErr: boolean; }

const MAX_LINES = 16;

export const ProcessStream: React.FC<ProcessStreamProps> = ({ command, args, env, onDone }) => {
  const [lines,    setLines]    = useState<Line[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const proc: ChildProcess = spawn(command, args, {
      env:   { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const push = (text: string, isErr = false) => {
      const parts = text.split('\n').filter(l => l.trim().length > 0);
      if (parts.length === 0) return;
      setLines(prev => {
        const next = [...prev, ...parts.map(t => ({ text: t, isErr }))];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    };

    proc.stdout?.on('data', (buf: Buffer) => push(buf.toString()));
    proc.stderr?.on('data', (buf: Buffer) => push(buf.toString(), true));
    proc.on('close', (code) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const c = code ?? 1;
      setExitCode(c);
      onDone(c);
    });
    proc.on('error', (err) => {
      push(`spawn error: ${err.message}`, true);
      if (!doneRef.current) {
        doneRef.current = true;
        setExitCode(1);
        onDone(1);
      }
    });

    return () => {
      if (!doneRef.current) proc.kill('SIGTERM');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#2a2a2a" paddingX={1} marginTop={1}>
      <Text color="#444444" dimColor>output</Text>
      {lines.length === 0 && exitCode === null && (
        <Text color="#555555">starting…</Text>
      )}
      {lines.map((l, i) => (
        <Text key={i} color={l.isErr ? '#f87171' : '#888888'}>{l.text}</Text>
      ))}
      {exitCode !== null && (
        <Box marginTop={1} gap={2}>
          <Text color={exitCode === 0 ? '#22c55e' : '#ef4444'} bold>
            {exitCode === 0 ? '✓' : '✗'}
          </Text>
          <Text color={exitCode === 0 ? '#22c55e' : '#ef4444'}>
            {exitCode === 0 ? 'completed successfully' : `failed (exit ${exitCode})`}
          </Text>
        </Box>
      )}
    </Box>
  );
};
