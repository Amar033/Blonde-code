#!/usr/bin/env node
/**
 * Stand-alone TUI loader — plays frames.json in the terminal at 24fps.
 * Used for testing. In production the frames are played by StartupScreen.
 */
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const frames = JSON.parse(
  await readFile(path.join(__dirname, 'frames.json'), 'utf-8')
);

const FPS      = 24;
const INTERVAL = Math.floor(1000 / FPS);
const TOTAL_MS = 5000;
const ROWS     = 20; // each frame is 20 terminal rows

// Hide cursor, save screen
process.stdout.write('\x1b[?25l\x1b[s');

let i = 0;
const start = Date.now();

const id = setInterval(() => {
  const frame = frames[i % frames.length];
  // Move to home, print frame
  process.stdout.write('\x1b[H' + frame);
  i++;

  if (Date.now() - start >= TOTAL_MS) {
    clearInterval(id);
    // Restore
    process.stdout.write('\x1b[u\x1b[?25h\x1b[0m\n');
    console.log('App ready!');
    process.exit(0);
  }
}, INTERVAL);

// Clean exit on Ctrl+C
process.on('SIGINT', () => {
  clearInterval(id);
  process.stdout.write('\x1b[u\x1b[?25h\x1b[0m\n');
  process.exit(0);
});
