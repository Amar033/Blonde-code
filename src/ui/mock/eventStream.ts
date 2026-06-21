import type { AgentEvent } from '../../types/events.js';

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function* streamText(text: string, chunkMs = 40): AsyncGenerator<AgentEvent> {
  const words = text.split(' ');
  let acc = '';
  for (const w of words) {
    acc += (acc ? ' ' : '') + w;
    yield { type: 'llm_streaming', delta: acc, inThinkBlock: false };
    await sleep(chunkMs);
  }
}

export async function* mockEventStream(): AsyncGenerator<AgentEvent> {
  // Planning phase — thinking stream
  const thinking = 'Analyzing the request. I need to create a FastAPI backend with SQLite. I will structure it with separate models and routes for clean architecture.';
  for (const w of thinking.split(' ')) {
    yield { type: 'llm_streaming', delta: w + ' ', thinking: thinking, inThinkBlock: true };
    await sleep(30);
  }

  yield {
    type: 'plan_generated',
    plan: {
      steps: [
        'Create models.py with SQLAlchemy models for User and Item',
        'Create routes.py with FastAPI endpoint handlers',
        'Create main.py as the application entry point',
      ],
      reasoning: 'Separating models from routes keeps the codebase clean and testable.',
      currentStep: 0,
      estimatedToolCalls: 5,
    },
  };
  await sleep(400);

  // Tool: write_file models.py
  yield {
    type: 'llm_response',
    content: '',
    parsed: {
      type: 'tool_call',
      tool: 'write_file',
      args: { path: 'models.py', content: '# SQLAlchemy models' },
      requiresApproval: false,
      reasoning: 'Creating the models file first',
    },
  };
  await sleep(600);
  yield {
    type: 'observation_ready',
    observation: {
      toolName: 'write_file',
      input: { path: 'models.py', content: '' },
      result: { bytesWritten: 1240, linesWritten: 48 },
      summary: 'Wrote 1240 bytes to models.py (48 lines)',
      timestamp: new Date(),
      success: true,
      kind: 'file_write' as const,
    },
  };
  await sleep(300);

  // Tool: write_file routes.py
  yield {
    type: 'llm_response',
    content: '',
    parsed: {
      type: 'tool_call',
      tool: 'write_file',
      args: { path: 'routes.py', content: '# FastAPI routes' },
      requiresApproval: false,
    },
  };
  await sleep(700);
  yield {
    type: 'observation_ready',
    observation: {
      toolName: 'write_file',
      input: { path: 'routes.py', content: '' },
      result: { bytesWritten: 980, linesWritten: 38 },
      summary: 'Wrote 980 bytes to routes.py (38 lines)',
      timestamp: new Date(),
      success: true,
      kind: 'file_write' as const,
    },
  };
  await sleep(300);

  // Tool: write_file main.py
  yield {
    type: 'llm_response',
    content: '',
    parsed: {
      type: 'tool_call',
      tool: 'write_file',
      args: { path: 'main.py', content: '# Entry point' },
      requiresApproval: false,
    },
  };
  await sleep(500);
  yield {
    type: 'observation_ready',
    observation: {
      toolName: 'write_file',
      input: { path: 'main.py', content: '' },
      result: { bytesWritten: 320, linesWritten: 14 },
      summary: 'Wrote 320 bytes to main.py (14 lines)',
      timestamp: new Date(),
      success: true,
      kind: 'file_write' as const,
    },
  };
  await sleep(300);

  // Final response — stream tokens
  const finalText = "I've created the FastAPI backend with SQLite:\n\n- **models.py** — SQLAlchemy `User` and `Item` models with relationships\n- **routes.py** — CRUD endpoints for `/users` and `/items`\n- **main.py** — Application entry point with database init\n\nRun with: `uvicorn main:app --reload`";
  yield* streamText(finalText, 35);

  yield { type: 'complete', finalResponse: finalText };
}
