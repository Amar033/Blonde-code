import React, { useState, useEffect, useRef } from 'react';
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
    <box flexDirection="column" borderStyle="single" borderColor="#2a2a2a" paddingLeft={1} paddingRight={1} marginTop={1}>
      <text fg="#444444">output</text>
      {lines.length === 0 && exitCode === null && (
        <text fg="#555555">starting…</text>
      )}
      {lines.map((l, i) => (
        <text key={i} fg={l.isErr ? '#f87171' : '#888888'}>{l.text}</text>
      ))}
      {exitCode !== null && (
        <box marginTop={1} gap={2}>
          <text fg={exitCode === 0 ? '#22c55e' : '#ef4444'}>
            <strong>{exitCode === 0 ? '✓' : '✗'}</strong>
          </text>
          <text fg={exitCode === 0 ? '#22c55e' : '#ef4444'}>
            {exitCode === 0 ? 'completed successfully' : `failed (exit ${exitCode})`}
          </text>
        </box>
      )}
    </box>
  );
};
