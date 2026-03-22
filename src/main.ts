// main entry point

import {AgentRuntime} from './runtime/core.js'
import {ToolRegistry} from './tools/registry.js'
import {ReadFileTool} from './tools/file-read.js'
import {ListFilesTool} from './tools/list-files.js'
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Blonde Code - Starting...\n');
  
  // Create and populate tool registry
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new ListFilesTool());
  
  const runtime = new AgentRuntime(toolRegistry, {
    maxTurns: 10,
    debug: true,
  });

  // initialize llm client
  await runtime.initialize();
  
  runtime.onEvent((event)=>{
    console.log(`[${event.type}]`, event);
  });

  // test input 
  const testInput = "list files in src directory";
  
  console.log(`\n[User]: ${testInput}\n`);
  for await (const event of runtime.run(testInput)){
  // events are logged on event listener 
  }
  console.log('\nAgent completed');
  console.log('Current State:',  runtime.getState());
}

main().catch(console.error);
