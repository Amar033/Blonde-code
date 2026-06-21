import React, { useState, useEffect } from 'react';
import { FLOWER_COLS, FLOWER_ROWS, FLOWER_FPS, FLOWER_PALETTE, FLOWER_FRAMES } from '../assets/flower-frames.js';

// Decode all base64 palette-index arrays once at module load
const DECODED: Array<{ chars: string[]; cidx: Uint8Array }> = FLOWER_FRAMES.map(f => ({
  chars: f.c,
  cidx:  new Uint8Array(Buffer.from(f.i, 'base64')),
}));

interface Props {
  cols: number;
  rows: number;
}

export const FlowerBackground: React.FC<Props> = ({ cols, rows }) => {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const ms = Math.round(1000 / FLOWER_FPS);
    const id = setInterval(() => setIdx(i => (i + 1) % DECODED.length), ms);
    return () => clearInterval(id);
  }, []);

  const frame = DECODED[idx];
  if (!frame) return null;

  const renderRows = Math.min(rows, FLOWER_ROWS);
  const renderCols = Math.min(cols, FLOWER_COLS);

  return (
    <box position="absolute" top={0} left={0} width={cols} height={rows} zIndex={0}>
      {frame.chars.slice(0, renderRows).map((rowStr, rowIdx) => {
        const base = rowIdx * FLOWER_COLS;
        // Group consecutive same-palette-index chars into single text spans
        const spans: Array<{ text: string; color: string }> = [];
        let start = 0;
        let cur   = frame.cidx[base] ?? 0;
        for (let x = 1; x <= renderCols; x++) {
          const next = x < renderCols ? (frame.cidx[base + x] ?? 0) : -1;
          if (next !== cur) {
            spans.push({ text: rowStr.slice(start, x), color: FLOWER_PALETTE[cur] ?? '#000000' });
            start = x;
            cur   = next;
          }
        }
        return (
          <box key={rowIdx} flexDirection="row" shouldFill={false}>
            {spans.map((s, si) => (
              <text key={si} fg={s.color}>{s.text}</text>
            ))}
          </box>
        );
      })}
    </box>
  );
};
