#!/usr/bin/env node
/**
 * Reads PNG frames from ./frames/, resizes to 20×20 via sharp,
 * converts to ANSI half-block art, writes ./frames.json
 *
 * Half-block strategy per 2-row pair:
 *   top + bottom both opaque  → ▀  fg=top, bg=bottom
 *   top opaque, bottom transp → ▀  fg=top, bg=sky
 *   top transp, bottom opaque → ▄  fg=bottom, bg=sky
 *   both transparent          → space (sky bg)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = path.join(__dirname, 'frames');
const OUT_FILE   = path.join(__dirname, 'frames.json');

// Target pixel dimensions (doubled height for half-block: 20 cols × 20 term rows → 20×40 pixels)
const TARGET_W_PX = 20;
const TARGET_H_PX = 40;  // 2 pixel rows per terminal row

// Sky/background colour for transparent pixels
const SKY = [3, 3, 15];

function ansiRgb(r, g, b)   { return `\x1b[38;2;${r};${g};${b}m`; }
function ansiBg(r, g, b)    { return `\x1b[48;2;${r};${g};${b}m`; }
const RESET = '\x1b[0m';

/**
 * Convert a raw RGBA Uint8Array (TARGET_W_PX × TARGET_H_PX × 4) to a
 * terminal art string using ▀ half-blocks.
 */
function toAnsi(raw) {
  const W = TARGET_W_PX;
  const H = TARGET_H_PX;
  let out = '';

  for (let ty = 0; ty < H / 2; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const topOff = ((ty * 2)     * W + tx) * 4;
      const botOff = ((ty * 2 + 1) * W + tx) * 4;

      const [tr, tg, tb, ta] = [raw[topOff],   raw[topOff+1], raw[topOff+2], raw[topOff+3]];
      const [br, bg, bb, ba] = [raw[botOff],    raw[botOff+1], raw[botOff+2], raw[botOff+3]];

      const topVis = ta > 30;
      const botVis = ba > 30;

      if (topVis && botVis) {
        // Both pixels: ▀ with fg=top, bg=bottom
        out += `${ansiRgb(tr,tg,tb)}${ansiBg(br,bg,bb)}▀`;
      } else if (topVis) {
        // Only top: ▀ with fg=top, bg=sky
        out += `${ansiRgb(tr,tg,tb)}${ansiBg(...SKY)}▀`;
      } else if (botVis) {
        // Only bottom: ▄ with fg=bottom, bg=sky
        out += `${ansiRgb(br,bg,bb)}${ansiBg(...SKY)}▄`;
      } else {
        // Both transparent: sky background space
        out += `${ansiBg(...SKY)} `;
      }
    }
    out += RESET + '\n';
  }

  return out;
}

async function main() {
  const files = fs.readdirSync(FRAMES_DIR)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => {
      // handles "element-00.png", "element-01.png", ...
      const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
      const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
      return numA - numB;
    });

  if (files.length === 0) {
    console.error('No PNG frames found in ./frames/');
    process.exit(1);
  }

  console.log(`Converting ${files.length} frames…`);
  const frames = [];

  for (const file of files) {
    const imgPath = path.join(FRAMES_DIR, file);
    const raw = await sharp(imgPath)
      .resize(TARGET_W_PX, TARGET_H_PX, { fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer();

    frames.push(toAnsi(new Uint8Array(raw)));
    process.stdout.write('.');
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(frames));
  console.log(`\nWrote ${frames.length} frames → ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
