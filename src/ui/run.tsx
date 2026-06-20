#!/usr/bin/env bun
import 'dotenv/config';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { appendFileSync } from 'fs';
import React from 'react';
import { App } from './App.js';

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
root.render(React.createElement(App, { mockMode }));
