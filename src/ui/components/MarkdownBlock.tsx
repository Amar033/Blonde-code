import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface Segment {
  text: string;
  bold?: boolean;
  code?: boolean;
  dim?: boolean;
}

function parseInline(line: string): Segment[] {
  const segs: Segment[] = [];
  let i = 0;
  let buf = '';

  const flush = () => { if (buf) { segs.push({ text: buf }); buf = ''; } };

  while (i < line.length) {
    // Bold **...**
    if (line[i] === '*' && line[i + 1] === '*') {
      flush();
      const end = line.indexOf('**', i + 2);
      if (end !== -1) {
        segs.push({ text: line.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }
    // Inline code `...`
    if (line[i] === '`') {
      flush();
      const end = line.indexOf('`', i + 1);
      if (end !== -1) {
        segs.push({ text: line.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    // Italic *...*
    if (line[i] === '*' && line[i + 1] !== '*') {
      flush();
      const end = line.indexOf('*', i + 1);
      if (end !== -1) {
        segs.push({ text: line.slice(i + 1, end), dim: true });
        i = end + 1;
        continue;
      }
    }
    buf += line[i];
    i++;
  }
  flush();
  return segs;
}

export const InlineMd: React.FC<{ text: string }> = ({ text }) => {
  const segs = parseInline(text);
  return (
    <Text>
      {segs.map((s, i) =>
        s.bold ? <Text key={i} bold>{s.text}</Text>
        : s.code ? <Text key={i} color={theme.syntax.string}>{s.text}</Text>
        : s.dim  ? <Text key={i} dimColor>{s.text}</Text>
        : <Text key={i}>{s.text}</Text>
      )}
    </Text>
  );
};

type Block =
  | { type: 'para'; lines: string[] }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      if (codeLines.length) blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }

    // List
    if (line.match(/^\s*[-*+]\s+/) || line.match(/^\s*\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].match(/^\s*[-*+]\s+/) || lines[i].match(/^\s*\d+\.\s+/))) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph (consume until blank line or next block marker)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trimStart().startsWith('```') || l.match(/^#{1,6}\s/) || l.match(/^\s*[-*+]\s+/)) break;
      paraLines.push(l);
      i++;
      if (l.trim() === '') break;
    }
    const nonEmpty = paraLines.filter(l => l.trim());
    if (nonEmpty.length) blocks.push({ type: 'para', lines: paraLines });
  }

  return blocks;
}

export const MarkdownBlock: React.FC<{ text: string }> = ({ text }) => {
  const blocks = parseBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, bi) => {
        if (block.type === 'heading') {
          const c = bi === 0 ? theme.text.primary : theme.role.assistant;
          return (
            <Box key={bi} marginTop={bi > 0 ? 1 : 0}>
              <Text bold color={c}>{block.text}</Text>
            </Box>
          );
        }

        if (block.type === 'code') {
          return (
            <Box key={bi} flexDirection="column" marginTop={1} paddingX={1}
              borderStyle="single" borderColor={theme.border.dim}>
              {block.lang ? <Text color={theme.text.dim}>{block.lang}</Text> : null}
              {block.lines.map((l, li) => (
                <Text key={li} color={theme.syntax.string}>{l}</Text>
              ))}
            </Box>
          );
        }

        if (block.type === 'list') {
          return (
            <Box key={bi} flexDirection="column" marginTop={bi > 0 ? 1 : 0}>
              {block.items.map((item, ii) => (
                <Box key={ii} gap={1}>
                  <Text color={theme.text.secondary}>•</Text>
                  <InlineMd text={item} />
                </Box>
              ))}
            </Box>
          );
        }

        // paragraph
        return (
          <Box key={bi} flexDirection="column" marginTop={bi > 0 ? 1 : 0}>
            {block.lines.filter(l => l.trim()).map((l, li) => (
              <InlineMd key={li} text={l} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
};
