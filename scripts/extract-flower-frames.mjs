#!/usr/bin/env node
/**
 * Extracts flower bloom animation frames from the source webm,
 * crops the watermark, converts to palette-indexed ASCII art,
 * and writes src/ui/assets/flower-frames.ts for the TUI background.
 *
 * Uses max-brightness pooling: for each terminal cell, scan the
 * corresponding source pixel block and use the brightest pixel found.
 * This correctly captures ASCII stroke pixels even when they are
 * sparse against a dark background.
 *
 * Usage: node scripts/extract-flower-frames.mjs
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const VIDEO  = process.argv[2];
if (!VIDEO) {
  console.error('Usage: node scripts/extract-flower-frames.mjs <path/to/video.webm>');
  process.exit(1);
}
const OUT    = join(ROOT, 'src/ui/assets/flower-frames.ts');

// Target terminal size
const COLS = 200;
const ROWS = 55;
const FPS  = 8;

// Source dimensions after watermark crop
const SRC_W      = 1080;
const SRC_H      = 537;   // 607 − 70 (removes bottom watermark strip)
const FRAME_SIZE = SRC_W * SRC_H * 3;

// Full-saturation palette — flowers should be vivid against the dark terminal.
const PALETTE = [
  '#000000',   // 0  black / space background
  '#180d38',   // 1  deep purple (minimum haze)
  '#3d1878',   // 2  dark purple
  '#6a30b8',   // 3  medium purple
  '#9a58e8',   // 4  bright purple
  '#c078ff',   // 5  electric purple (brand adjacent)
  '#1a30b0',   // 6  dark blue
  '#3870e0',   // 7  medium blue
  '#70b0ff',   // 8  electric blue
  '#901a90',   // 9  dark magenta
  '#d048d8',   // 10 bright magenta
  '#ff70ff',   // 11 electric pink
];

const PALETTE_RGB = PALETTE.map(h => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

function nearestPalette(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < PALETTE_RGB.length; i++) {
    const [pr, pg, pb] = PALETTE_RGB[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const CHAR_RAMP = ' ·.,:;+=o0O#@';

function pixelToChar(r, g, b) {
  const bright = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  const idx    = Math.min(CHAR_RAMP.length - 1, Math.floor(bright * CHAR_RAMP.length));
  return CHAR_RAMP[idx];
}

// Pixels below this RGB sum are the video's dark background.
const BG_SUM_THRESHOLD = 55;

// ── Process one raw frame via max-brightness pooling ────────────────────────
function processFrame(raw) {
  const chars = [];
  const cidx  = [];

  for (let oy = 0; oy < ROWS; oy++) {
    const sy0 = Math.floor(oy * SRC_H / ROWS);
    const sy1 = Math.floor((oy + 1) * SRC_H / ROWS);
    let rowChars = '';
    const rowCidx = [];

    for (let ox = 0; ox < COLS; ox++) {
      const sx0 = Math.floor(ox * SRC_W / COLS);
      const sx1 = Math.floor((ox + 1) * SRC_W / COLS);

      // Find the brightest pixel in this source block
      let maxR = 0, maxG = 0, maxB = 0, maxLuma = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p    = (sy * SRC_W + sx) * 3;
          const r    = raw[p], g = raw[p + 1], b = raw[p + 2];
          const luma = r * 0.299 + g * 0.587 + b * 0.114;
          if (luma > maxLuma) { maxLuma = luma; maxR = r; maxG = g; maxB = b; }
        }
      }

      if (maxR + maxG + maxB < BG_SUM_THRESHOLD) {
        rowChars += ' ';
        rowCidx.push(0);
      } else {
        rowChars += pixelToChar(maxR, maxG, maxB);
        rowCidx.push(nearestPalette(maxR, maxG, maxB));
      }
    }
    chars.push(rowChars);
    cidx.push(rowCidx);
  }
  return { chars, cidx };
}

// ── Run ffmpeg — crop only, no downscale (we do that in JS) ─────────────────
const filter = `crop=${SRC_W}:${SRC_H}:0:0`;

console.log(`Extracting ${COLS}x${ROWS} @ ${FPS}fps via max-brightness pooling…`);

const proc = spawn('ffmpeg', [
  '-i', VIDEO,
  '-vf', filter,
  '-f', 'rawvideo',
  '-pix_fmt', 'rgb24',
  '-r', String(FPS),
  '-'
], { stdio: ['ignore', 'pipe', 'inherit'] });

let buf    = Buffer.alloc(0);
const frames = [];

proc.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= FRAME_SIZE) {
    const raw = buf.subarray(0, FRAME_SIZE);
    buf = buf.subarray(FRAME_SIZE);
    const { chars, cidx } = processFrame(raw);
    frames.push({ chars, cidx });
    process.stderr.write(`\r  frame ${frames.length}…`);
  }
});

proc.on('close', code => {
  if (code !== 0 && frames.length === 0) {
    console.error(`\nffmpeg exited with code ${code}`);
    process.exit(1);
  }

  console.log(`\nCaptured ${frames.length} frames`);

  const paletteTs = JSON.stringify(PALETTE);

  const framesTs = frames.map(({ chars, cidx }) => {
    const charsJson = JSON.stringify(chars);
    const flat = cidx.flat();
    const b64  = Buffer.from(new Uint8Array(flat)).toString('base64');
    return `{c:${charsJson},i:"${b64}"}`;
  }).join(',\n');

  const ts = `// Auto-generated by scripts/extract-flower-frames.mjs — do not edit
// ${frames.length} frames @ ${COLS}x${ROWS}, ${FPS}fps
export const FLOWER_COLS    = ${COLS} as const;
export const FLOWER_ROWS    = ${ROWS} as const;
export const FLOWER_FPS     = ${FPS} as const;
export const FLOWER_PALETTE: readonly string[] = ${paletteTs};

// Each frame: c = char rows (${ROWS} strings of ${COLS} chars)
//             i = base64-encoded Uint8Array of palette indices (${COLS * ROWS} bytes)
export const FLOWER_FRAMES: Array<{ c: string[]; i: string }> = [
${framesTs}
];
`;

  mkdirSync(join(ROOT, 'src/ui/assets'), { recursive: true });
  writeFileSync(OUT, ts, 'utf8');
  console.log(`Written → ${OUT}`);
});
