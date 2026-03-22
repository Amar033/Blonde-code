#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

if (!process.stdout.isTTY) {
  console.warn('Warning: Not running in a TTY. Some features may not work correctly.');
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