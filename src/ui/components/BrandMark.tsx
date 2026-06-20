import React, { useState, useEffect, useRef } from 'react';
import { theme } from '../theme.js';

export const LOGO_OPTIONS = [
  { index: 1, label: 'grid',    desc: 'animated block grid' },
  { index: 2, label: 'diamond', desc: 'diamond pattern' },
  { index: 3, label: 'minimal', desc: 'minimal text art' },
];

// ─── Logo art definitions ────────────────────────────────────────────────────

// Block grid rows (phase shifts the shade pattern for animation)
function gridRow(width: number, row: number, phase: number): string {
  const shades = ['░', '▒', '▓'];
  let s = '';
  for (let c = 0; c < Math.floor(width / 2); c++) {
    s += shades[Math.abs(c * 3 + row * 2 + phase) % 3];
    if (c < Math.floor(width / 2) - 1) s += ' ';
  }
  return s.slice(0, width);
}

// Diamond pattern (static)
function diamondArt(width: number, height: number): string[] {
  const rows: string[] = [];
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const maxR = Math.min(cx, cy) - 1;
  for (let r = 0; r < height; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const dx = Math.abs(c - cx);
      const dy = Math.abs(r - cy);
      const dist = dx + dy;
      if (dist === 0)       line += '◆';
      else if (dist === 1)  line += '◇';
      else if (dist <= 3)   line += '·';
      else if (dist % maxR === 0) line += '◦';
      else                  line += ' ';
    }
    rows.push(line);
  }
  return rows;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface BrandMarkProps {
  width?:          number;
  logoIndex?:      number;
  bannerOverride?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ width = 32, logoIndex }) => {
  const [phase, setPhase] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const height = Math.max(8, Math.round(width / 2));
  const style  = logoIndex ?? 1;

  // Animate grid logo
  useEffect(() => {
    if (style !== 1) return;
    timerRef.current = setInterval(() => setPhase(p => (p + 1) % 9), 160);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [style]);

  const SHADES_COLORS = [theme.text.dim, theme.text.secondary, theme.brand];

  // ── Logo 1: animated block grid ─────────────────────────────────────────
  if (style === 1) {
    const midRow = Math.floor(height / 2);
    return (
      <box flexDirection="column" width={width} height={height}>
        {Array.from({ length: height }, (_, r) => {
          const shades = ['░', '▒', '▓'];
          const cells  = Math.floor(width / 2);
          let text = '';
          for (let c = 0; c < cells; c++) {
            text += shades[Math.abs(c * 3 + r * 2 + phase) % 3];
            if (c < cells - 1) text += ' ';
          }
          text = text.slice(0, width);

          const isTitle   = r === midRow - 1;
          const isSub     = r === midRow;
          const isVersion = r === midRow + 1;
          const phaseOff  = (r + phase) % 3;
          const color     = SHADES_COLORS[phaseOff];

          if (isTitle)   return <text key={r} fg={theme.brand}><strong>◆ Blonde</strong></text>;
          if (isSub)     return <text key={r} fg={theme.text.secondary}>  AI Coding Agent</text>;
          if (isVersion) return <text key={r} fg={theme.text.dim}>  v0.1.0</text>;
          return <text key={r} fg={color}>{text}</text>;
        })}
      </box>
    );
  }

  // ── Logo 2: diamond pattern ──────────────────────────────────────────────
  if (style === 2) {
    const rows = diamondArt(width, height);
    const mid  = Math.floor(height / 2);
    return (
      <box flexDirection="column" width={width} height={height}>
        {rows.map((row, r) => {
          const dist   = Math.abs(r - mid);
          const color  = dist === 0 ? theme.brand : dist === 1 ? theme.text.secondary : theme.text.dim;
          const isMid  = r === mid;
          return (
            <text key={r} fg={color}>
              {isMid ? row.replace('◆', '◆') : row}
            </text>
          );
        })}
      </box>
    );
  }

  // ── Logo 3: minimal / text ───────────────────────────────────────────────
  const lines3 = [
    '',
    '   ┌─────────────────────┐',
    '   │                     │',
    '   │    ◆  B L O N D E  │',
    '   │                     │',
    '   │   AI Coding Agent   │',
    '   │       v 0.1.0       │',
    '   │                     │',
    '   └─────────────────────┘',
    '',
  ];
  return (
    <box flexDirection="column" width={width} height={height}>
      {Array.from({ length: height }, (_, r) => {
        const txt = lines3[r] ?? '';
        const isBrand = txt.includes('BLONDE') || txt.includes('B L O N D E');
        const isSub   = txt.includes('AI') || txt.includes('v 0');
        const color   = isBrand ? theme.brand : isSub ? theme.text.secondary : theme.border.normal;
        return <text key={r} fg={color}>{txt}</text>;
      })}
    </box>
  );
};
