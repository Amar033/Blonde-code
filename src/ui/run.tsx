#!/usr/bin/env node
import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { appendFileSync } from 'fs';

const _LOG = '/tmp/blonde.log';
const _fmt = (...args: any[]) =>
  args.map(a => a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
console.log   = (...args) => { try { appendFileSync(_LOG, `[LOG] ${_fmt(...args)}\n`); } catch {} };
console.error = (...args) => { try { appendFileSync(_LOG, `[ERR] ${_fmt(...args)}\n`); } catch {} };
console.warn  = (...args) => { try { appendFileSync(_LOG, `[WRN] ${_fmt(...args)}\n`); } catch {} };

const mockMode = process.argv.includes('--mock');

if (!process.stdout.isTTY) {
  process.stderr.write('Warning: Not running in a TTY. Some features may not work correctly.\n');
}

const { unmount, waitUntilExit } = render(<App mockMode={mockMode} />, { strict: false } as any);

function restoreTerminal() {
  process.stdout.write('\x1b[?25h');
  process.stdout.write('\x1b[0m');
  process.stdout.write('\n');
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  unmount();
  restoreTerminal();
  try { await waitUntilExit(); } catch {}
  process.exit(0);
}

process.on('SIGINT',  () => shutdown());
process.on('SIGTERM', () => shutdown());
