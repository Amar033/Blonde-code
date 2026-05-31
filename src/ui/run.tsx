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

async function shutdown() {
  unmount();
  try {
    await waitUntilExit();
  } catch (e) {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  shutdown();
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  shutdown();
});