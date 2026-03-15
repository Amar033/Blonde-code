import { promises as fs } from 'fs';
import { basename, dirname } from 'path';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class WriteFileTool extends BaseTool {
  name = 'write_file';
  description = 'Write content to a file. Creates new file or overwrites existing one.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write (relative or absolute)',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
    },
    required: ['path', 'content'],
  };

  isDangerous = false;
  requiresApproval = false;

  private blockedPaths = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.sst',
    '.cache',
  ];

  private isBlockedPath(filePath: string): boolean {
    const normalized = filePath.toLowerCase();
    return this.blockedPaths.some(blocked => 
      normalized.includes(blocked.toLowerCase())
    );
  }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { path, content } = args as { path: string; content: string };

    if (this.isBlockedPath(path)) {
      return {
        wouldSucceed: false,
        description: `Cannot write to blocked path: ${path}`,
        warnings: ['Blocked path detected'],
      };
    }

    const lines = content.split('\n').length;
    return {
      wouldSucceed: true,
      description: `Would write ${lines} lines to ${path}`,
    };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { path, content } = args as { path: string; content: string };

    if (this.isBlockedPath(path)) {
      return {
        success: false,
        output: null,
        error: `Blocked path: ${path} is in a protected directory`,
      };
    }

    try {
      const dir = dirname(path);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(path, content, 'utf-8');

      const lines = content.split('\n').length;
      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          path,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          linesWritten: lines,
        },
        metadata: {
          duration,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to write file: ${error}`,
      };
    }
  }
}
