import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';
import type { ToolConfig } from './base.js';

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '__pycache__', '.cache', 'coverage']);

export class FileTreeTool extends BaseTool {
  name = 'file_tree';
  description = 'Show the full directory tree recursively — much better than list_files for understanding project structure.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Root directory to start from. Defaults to "."',
        default: '.',
      },
      depth: {
        type: 'number',
        description: 'Max depth to recurse. Default 4.',
        default: 4,
      },
    },
    required: [] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  constructor(config: ToolConfig) { super(config); }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { path = '.' } = (args ?? {}) as { path?: string };
    return { wouldSucceed: true, description: `Would tree: ${path}` };
  }

  private async walk(
    dir: string,
    depth: number,
    maxDepth: number,
    prefix: string
  ): Promise<{ lines: string[]; fileCount: number; dirCount: number }> {
    if (depth > maxDepth) return { lines: [], fileCount: 0, dirCount: 0 };

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return { lines: [], fileCount: 0, dirCount: 0 };
    }

    const visible = entries
      .filter(e => {
        if (SKIP.has(e.name)) return false;
        // Keep important dot-files but skip hidden dirs
        if (e.name.startsWith('.')) {
          return !e.isDirectory() && (e.name === '.env' || e.name === '.gitignore' || e.name === '.claude');
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    let fileCount = 0;
    let dirCount  = 0;
    const lines: string[] = [];

    for (let i = 0; i < visible.length; i++) {
      const e     = visible[i];
      const isLast = i === visible.length - 1;
      const arm    = isLast ? '└── ' : '├── ';
      const childPfx = prefix + (isLast ? '    ' : '│   ');

      if (e.isDirectory()) {
        dirCount++;
        lines.push(`${prefix}${arm}${e.name}/`);
        const child = await this.walk(join(dir, e.name), depth + 1, maxDepth, childPfx);
        lines.push(...child.lines);
        fileCount += child.fileCount;
        dirCount  += child.dirCount;
      } else {
        fileCount++;
        lines.push(`${prefix}${arm}${e.name}`);
      }
    }

    return { lines, fileCount, dirCount };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { path = '.', depth = 4 } = (args ?? {}) as { path?: string; depth?: number };
    const resolved = resolve(this.config.workspacePath, path);

    try {
      const { lines, fileCount, dirCount } = await this.walk(resolved, 0, depth, '');
      const tree = [path + '/', ...lines].join('\n');

      return {
        success: true,
        output: { tree, path },
        metadata: { fileCount, dirCount, lineCount: lines.length },
      };
    } catch (error) {
      return { success: false, output: null, error: `file_tree failed: ${error}` };
    }
  }
}
