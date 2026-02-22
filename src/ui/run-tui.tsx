#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { AgentRuntime } from '../runtime/core.js';
import { ToolRegistry } from '../tools/registry.js';
import { ReadFileTool } from '../tools/file-read.js';
import { ListFileTool } from '../tools/list-files.js';
import AgentTUI from './components/AgentTUI.js';

async function main() {
  // Setup
  const registry = new ToolRegistry();
  //registry.register(new ReadFileTool());
  //registry.register(new ListFilesTool());
  
    // Check if tools already registered (defensive)
  const existingTools = registry.getAllTools().map(t => t.name);
  
  if (!existingTools.includes('read_file')) {
    registry.register(new ReadFileTool());
  }
  
  if (!existingTools.includes('list_files')) {
    registry.register(new ListFileTool());
  }


  const runtime = new AgentRuntime(registry, {
    maxTurns: 30,
    maxLoopCount: 20,
    debug: false, // Disable console logs for clean TUI
  });

  await runtime.initialize();

  // Get task from args
  const task = process.argv.slice(2).join(' ') || 
    'Read package.json and tell me what dependencies we have';

  // Render
  render(<AgentTUI runtime={runtime} task={task} />);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
