import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../design-system.js';
import os from 'os';

const MODEL    = process.env.LLM_MODEL    || 'qwen3.5:latest';
const PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const CWD      = process.cwd().replace(os.homedir(), '~');

const EXAMPLES = [
  'list all TypeScript files in src',
  'find every TODO comment',
  'read package.json and summarize',
];

interface WelcomeScreenProps {
  onStart: (task: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
  const [task, setTask] = useState('');

  return (
    <Box flexDirection="column">

      {/* ── Info panel ─────────────────────────────────────────── */}
      <Box
        borderStyle="single"
        borderColor={colors.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        {/* Title bar */}
        <Box marginBottom={1} gap={1}>
          <Text bold color={colors.brand}>Blonde</Text>
          <Text dimColor>v0.1.0</Text>
          <Text dimColor>─</Text>
          <Text dimColor>{PROVIDER} / {MODEL}</Text>
          <Text dimColor>─</Text>
          <Text dimColor>{CWD}</Text>
        </Box>

        {/* Divider */}
        <Box marginBottom={1}>
          <Text dimColor>{'─'.repeat(58)}</Text>
        </Box>

        {/* Two-column body */}
        <Box flexDirection="row" gap={4}>

          {/* Left: identity */}
          <Box flexDirection="column" width={22}>
            <Text bold color={colors.text}>Welcome back!</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={colors.brand}>{'  ╔══╗  '}</Text>
              <Text color={colors.brand}>{'  ║◈◈║  '}</Text>
              <Text color={colors.brand}>{'  ╚══╝  '}</Text>
              <Text color={colors.brand}>{'  /||\\  '}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>AI Coding Agent</Text>
            </Box>
          </Box>

          {/* Right: tips + activity */}
          <Box flexDirection="column" flexGrow={1} gap={2}>

            <Box flexDirection="column" gap={0}>
              <Text bold color={colors.warning}>Getting started</Text>
              <Text dimColor>Ask me to read, search, or edit your codebase.</Text>
              <Text dimColor>Be specific — like you would with a teammate.</Text>
            </Box>

            <Box flexDirection="column" gap={0}>
              <Text bold color={colors.textMuted}>Recent activity</Text>
              <Text dimColor>No recent activity</Text>
            </Box>

          </Box>
        </Box>
      </Box>

      {/* ── Hint ───────────────────────────────────────────────── */}
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>? · help   /model · switch model</Text>
      </Box>

      {/* ── Input ──────────────────────────────────────────────── */}
      <Box
        marginTop={0}
        borderStyle="round"
        borderColor={colors.borderActive}
        paddingX={2}
      >
        <Text color={colors.brand}>{'→ '}</Text>
        <TextInput
          value={task}
          onChange={setTask}
          onSubmit={() => { if (task.trim()) onStart(task.trim()); }}
          placeholder="What can I help you build today?"
        />
      </Box>

      {/* ── Example prompts ────────────────────────────────────── */}
      <Box marginTop={1} paddingX={1} gap={2}>
        <Text dimColor>Try:</Text>
        {EXAMPLES.map((ex, i) => (
          <Text key={i} color={colors.textDim}>{ex}</Text>
        ))}
      </Box>

    </Box>
  );
};
