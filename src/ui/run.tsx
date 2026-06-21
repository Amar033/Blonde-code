#!/usr/bin/env bun
// Capture the directory we were launched from before anything can change it.
// This is the project root all tools will operate on.
const workspacePath = process.cwd();

import 'dotenv/config';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { appendFileSync } from 'fs';
import React from 'react';
import { App } from './App.js';
import { VERSION } from '../version.js';
import { checkForUpdate, downloadAndInstall } from '../services/updater.js';

// ── Headless CLI flags (handled before TUI starts) ────────────────────────────

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(`blonde ${VERSION}\n`);
  process.exit(0);
}

if (process.argv.includes('--update')) {
  process.stdout.write('Checking for updates…\n');
  const info = await checkForUpdate();
  if (!info) {
    process.stdout.write('blonde is already up to date.\n');
    process.exit(0);
  }
  process.stdout.write(`Downloading blonde ${info.version}…\n`);
  try {
    await downloadAndInstall(info, pct => {
      process.stdout.write(`\r  ${pct}%`);
    });
    process.stdout.write(`\n✓  Updated to ${info.version}. Restart blonde to apply.\n`);
  } catch (e: any) {
    process.stdout.write(`\n✗  Update failed: ${e.message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ── TUI mode ──────────────────────────────────────────────────────────────────

const _LOG = '/tmp/blonde.log';
const _fmt = (...args: any[]) =>
  args.map(a => a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
console.log   = (...args) => { try { appendFileSync(_LOG, `[LOG] ${_fmt(...args)}\n`); } catch {} };
console.error = (...args) => { try { appendFileSync(_LOG, `[ERR] ${_fmt(...args)}\n`); } catch {} };
console.warn  = (...args) => { try { appendFileSync(_LOG, `[WRN] ${_fmt(...args)}\n`); } catch {} };

const mockMode = process.argv.includes('--mock');

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT', 'SIGHUP'],
});

renderer.setTerminalTitle('Blonde');
renderer.setBackgroundColor('#0d0d0d');

const root = createRoot(renderer);
root.render(React.createElement(App, { mockMode, workspacePath }));
