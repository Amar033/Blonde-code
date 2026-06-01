#!/usr/bin/env node
import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { appendFileSync } from 'fs';

// Redirect all console output to a log file so debug noise never pollutes the Ink UI.
// Tail with: tail -f /tmp/blonde.log
const _LOG = '/tmp/blonde.log';
const _fmt = (...args: any[]) =>
  args.map(a => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
console.log   = (...args) => { try { appendFileSync(_LOG, `[LOG] ${_fmt(...args)}\n`); } catch {} };
console.error = (...args) => { try { appendFileSync(_LOG, `[ERR] ${_fmt(...args)}\n`); } catch {} };
console.warn  = (...args) => { try { appendFileSync(_LOG, `[WRN] ${_fmt(...args)}\n`); } catch {} };

if (!process.stdout.isTTY) {
  process.stderr.write('Warning: Not running in a TTY. Some features may not work correctly.\n');
}

// Disable React StrictMode to prevent duplicate renders in non-TTY
const { unmount, waitUntilExit } = render(<App />, {
  // @ts-ignore - experimental option
  strict: false,
});

function restoreTerminal() {
  // Show cursor + disable raw mode in case Ink left it active
  process.stdout.write('\x1b[?25h'); // show cursor
  process.stdout.write('\x1b[0m');   // reset colors
  process.stdout.write('\n');        // move to clean line
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  unmount();
  restoreTerminal();
  try { await waitUntilExit(); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown());
process.on('SIGTERM', () => shutdown());