// main entry point

import {AgentRuntime} from './runtime/core.js'
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Blonde Code - Starting...\n');
  const runtime = new AgentRuntime({
    maxTurns: 10,
    debug: true,
  });

  // initialize llm client
  await runtime.initialize();
  
  runtime.onEvent((event)=>{
    console.log(`[${event.type}]`, event);
  });

  // test input 
  const testInput = "Create a function that calculates fibonacci numbers";
  
  console.log(`\n[User]: ${testInput}\n`);
  for await (const event of runtime.run(testInput)){
  // events are logged on event listener 
  }
  console.log('\nAgent completed');
  console.log('Current State:',  runtime.getState());
}

main().catch(console.error);
