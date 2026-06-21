import { unlinkSync, renameSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve, relative } from 'path';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';
import type { ToolConfig } from './base.js';

const PROTECTED = ['.git', 'node_modules', 'dist', 'build', '.env'];

function isProtected(p: string, cwd: string): boolean {
  const rel = relative(cwd, resolve(cwd, p));
  return PROTECTED.some(guard => rel === guard || rel.startsWith(guard + '/'));
}

export class DeleteFileTool extends BaseTool {
  name = 'delete_file';
  description = 'Permanently delete a file. Use when removing obsolete files during a refactor. Cannot delete directories.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path of the file to delete (relative to project root)',
      },
    },
    required: ['path'] as string[],
  };

  isDangerous = true;
  requiresApproval = true;

  constructor(config: ToolConfig) { super(config); }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { path } = args as { path: string };
    const ws = this.config.workspacePath;
    if (!path) return { wouldSucceed: false, description: 'No path given', warnings: ['path required'] };
    if (isProtected(path, ws)) return { wouldSucceed: false, description: `Protected path: ${path}`, warnings: ['cannot delete protected paths'] };
    const full = resolve(ws, path);
    if (!existsSync(full)) return { wouldSucceed: false, description: `File not found: ${path}`, warnings: ['file does not exist'] };
    return { wouldSucceed: true, description: `Would delete: ${path}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { path } = args as { path: string };
    const ws = this.config.workspacePath;
    if (!path?.trim()) return { success: false, output: null, error: 'path is required' };

    if (isProtected(path, ws)) {
      return { success: false, output: null, error: `Cannot delete protected path: ${path}` };
    }

    const full = resolve(ws, path);
    if (!existsSync(full)) {
      return { success: false, output: null, error: `File not found: ${path}` };
    }

    try {
      unlinkSync(full);
      return { success: true, output: { path, message: `Deleted: ${path}` } };
    } catch (error: any) {
      return { success: false, output: null, error: `Delete failed: ${error.message}` };
    }
  }
}

export class RenameFileTool extends BaseTool {
  name = 'rename_file';
  description = 'Rename or move a file to a new path. Creates intermediate directories if needed. Use for refactors that involve moving files.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      from: {
        type: 'string',
        description: 'Current file path (relative to project root)',
      },
      to: {
        type: 'string',
        description: 'New file path (relative to project root)',
      },
    },
    required: ['from', 'to'] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  constructor(config: ToolConfig) { super(config); }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { from, to } = args as { from: string; to: string };
    const ws = this.config.workspacePath;
    if (!from || !to) return { wouldSucceed: false, description: 'from and to required', warnings: ['both paths required'] };
    const srcFull = resolve(ws, from);
    if (!existsSync(srcFull)) return { wouldSucceed: false, description: `Source not found: ${from}`, warnings: ['source does not exist'] };
    return { wouldSucceed: true, description: `Would rename: ${from} → ${to}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { from, to } = args as { from: string; to: string };
    const ws = this.config.workspacePath;
    if (!from?.trim() || !to?.trim()) return { success: false, output: null, error: 'Both from and to paths are required' };

    const srcFull = resolve(ws, from);
    const dstFull = resolve(ws, to);

    if (!existsSync(srcFull)) {
      return { success: false, output: null, error: `Source file not found: ${from}` };
    }

    if (isProtected(from, ws)) {
      return { success: false, output: null, error: `Cannot move protected path: ${from}` };
    }

    if (existsSync(dstFull)) {
      return { success: false, output: null, error: `Destination already exists: ${to}. Delete it first if you want to overwrite.` };
    }

    try {
      mkdirSync(dirname(dstFull), { recursive: true });
      renameSync(srcFull, dstFull);
      return { success: true, output: { from, to, message: `Moved: ${from} → ${to}` } };
    } catch (error: any) {
      return { success: false, output: null, error: `Rename failed: ${error.message}` };
    }
  }
}
