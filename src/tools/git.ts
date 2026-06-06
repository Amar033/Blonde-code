import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

const execAsync = promisify(exec);
const CWD = process.cwd();

export class GitStatusTool extends BaseTool {
  name = 'git_status';
  description = 'Show which files are modified, staged, or untracked in the git repo.';

  argsSchema = {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(): Promise<FakeRunResult> {
    return { wouldSucceed: true, description: 'Would run: git status --short --branch' };
  }

  async execute(): Promise<ToolResult> {
    try {
      const { stdout } = await execAsync('git status --short --branch', { cwd: CWD });
      const lines = stdout.trim().split('\n');
      const branch = lines[0]?.replace('## ', '') ?? 'unknown';
      const changes = lines.slice(1).filter(Boolean);
      return {
        success: true,
        output: { branch, changes, raw: stdout.trim() },
        metadata: { changeCount: changes.length },
      };
    } catch (error) {
      return { success: false, output: null, error: `git status failed: ${error}` };
    }
  }
}

export class GitDiffTool extends BaseTool {
  name = 'git_diff';
  description = 'Show what changed in the working tree vs the last commit. Pass a file path to narrow it.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to diff. Omit to see all changes.',
      },
    },
    required: [] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(): Promise<FakeRunResult> {
    return { wouldSucceed: true, description: 'Would run: git diff' };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { path } = (args ?? {}) as { path?: string };
    try {
      const cmd = path ? `git diff -- "${path}"` : 'git diff';
      const { stdout } = await execAsync(cmd, { cwd: CWD });
      const diff = stdout.trim();
      const additions = (diff.match(/^\+[^+]/gm) ?? []).length;
      const deletions  = (diff.match(/^-[^-]/gm) ?? []).length;
      return {
        success: true,
        output: { diff: diff || '(no changes)', path: path ?? 'all files' },
        metadata: { additions, deletions, hasChanges: diff.length > 0 },
      };
    } catch (error) {
      return { success: false, output: null, error: `git diff failed: ${error}` };
    }
  }
}
