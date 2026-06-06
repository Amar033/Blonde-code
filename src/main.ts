// main entry point

import {AgentRuntime} from './runtime/core.js'
import {ToolRegistry} from './tools/registry.js'
import {ReadFileTool} from './tools/file-read.js'
import {ListFilesTool} from './tools/list-files.js'
import {initializeAgentRegistry} from './agent/agent.js'
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Blonde Code - Starting...\n');
  
  // Initialize agent registry
  initializeAgentRegistry();
  
  // ToolRegistry constructor already registers all built-in tools
  const toolRegistry = new ToolRegistry();
  
  const runtime = new AgentRuntime(toolRegistry, {
    maxTurns: 10,
    debug: true,
    // We can specify an agent here, e.g., agent: 'explore'
  });

  // initialize llm client (now done in runtime.initialize)
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
