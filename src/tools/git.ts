import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
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

export class GitLogTool extends BaseTool {
  name = 'git_log';
  description = 'Show recent git commit history. Use to understand what changed recently or find a commit hash.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Number of commits to show (default: 10)',
      },
      file: {
        type: 'string',
        description: 'Limit log to commits touching this file path (optional)',
      },
    },
    required: [] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(): Promise<FakeRunResult> {
    return { wouldSucceed: true, description: 'Would run: git log --oneline' };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { limit = 10, file } = (args ?? {}) as { limit?: number; file?: string };
    try {
      const n    = Math.min(Math.max(1, limit), 50);
      const tail = file ? ` -- "${file}"` : '';
      const { stdout } = await execAsync(
        `git log --oneline --no-decorate -n ${n}${tail}`,
        { cwd: CWD }
      );
      const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, ...rest] = line.split(' ');
        return { hash, message: rest.join(' ') };
      });
      return { success: true, output: { commits, count: commits.length } };
    } catch (error) {
      return { success: false, output: null, error: `git log failed: ${error}` };
    }
  }
}

export class GitAddTool extends BaseTool {
  name = 'git_add';
  description = 'Stage files for commit. Pass specific paths or "." to stage everything.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      paths: {
        type: 'string',
        description: 'Space-separated file paths to stage, or "." for all changes',
      },
    },
    required: ['paths'] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { paths } = args as { paths: string };
    return { wouldSucceed: !!paths, description: `Would run: git add ${paths}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { paths } = args as { paths: string };
    try {
      await execAsync(`git add ${paths}`, { cwd: CWD });
      const { stdout } = await execAsync('git status --short', { cwd: CWD });
      const staged = stdout.split('\n').filter(l => l.match(/^[MADRC]/)).map(l => l.trim());
      return {
        success: true,
        output: { paths, staged, message: `Staged: ${paths}` },
      };
    } catch (error: any) {
      return { success: false, output: null, error: `git add failed: ${error.message}` };
    }
  }
}

export class GitCommitTool extends BaseTool {
  name = 'git_commit';
  description = 'Commit staged changes with a message. Run git_add first to stage files.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'Commit message — be concise and descriptive',
      },
    },
    required: ['message'] as string[],
  };

  isDangerous = false;
  requiresApproval = true;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { message } = args as { message: string };
    if (!message?.trim()) return { wouldSucceed: false, description: 'Empty commit message', warnings: ['message required'] };
    return { wouldSucceed: true, description: `Would commit: "${message}"` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { message } = args as { message: string };
    if (!message?.trim()) return { success: false, output: null, error: 'Commit message cannot be empty' };

    try {
      // Check there is something staged
      const { stdout: statusOut } = await execAsync('git status --short', { cwd: CWD });
      const staged = statusOut.split('\n').filter(l => l.match(/^[MADRC]/));
      if (staged.length === 0) {
        return { success: false, output: null, error: 'Nothing staged to commit. Run git_add first.' };
      }

      const safeMsg = message.replace(/"/g, '\\"');
      const { stdout } = await execAsync(`git commit -m "${safeMsg}"`, { cwd: CWD });
      const hashMatch  = stdout.match(/\[[\w/]+ ([a-f0-9]+)\]/);
      return {
        success: true,
        output: { message, hash: hashMatch?.[1] ?? '', raw: stdout.trim() },
      };
    } catch (error: any) {
      return { success: false, output: null, error: `git commit failed: ${error.message}` };
    }
  }
}

export class GitBranchTool extends BaseTool {
  name = 'git_branch';
  description = 'List branches, create a new branch, or switch to an existing one.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: '"list" — show all branches. "create" — make a new branch. "switch" — check out an existing branch.',
        enum: ['list', 'create', 'switch'],
      },
      name: {
        type: 'string',
        description: 'Branch name (required for create/switch)',
      },
    },
    required: ['action'] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { action, name } = args as { action: string; name?: string };
    return { wouldSucceed: true, description: `Would ${action} branch${name ? ': ' + name : ''}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { action, name } = args as { action: 'list' | 'create' | 'switch'; name?: string };

    try {
      if (action === 'list') {
        const { stdout } = await execAsync('git branch -a', { cwd: CWD });
        const branches = stdout.trim().split('\n').map(b => b.trim()).filter(Boolean);
        const current  = branches.find(b => b.startsWith('*'))?.replace('* ', '') ?? '';
        return { success: true, output: { branches: branches.map(b => b.replace('* ', '')), current } };
      }

      if (!name?.trim()) return { success: false, output: null, error: `Branch name required for action: ${action}` };

      if (action === 'create') {
        await execAsync(`git checkout -b "${name}"`, { cwd: CWD });
        return { success: true, output: { action, name, message: `Created and switched to branch: ${name}` } };
      }

      if (action === 'switch') {
        await execAsync(`git checkout "${name}"`, { cwd: CWD });
        return { success: true, output: { action, name, message: `Switched to branch: ${name}` } };
      }

      return { success: false, output: null, error: `Unknown action: ${action}` };
    } catch (error: any) {
      return { success: false, output: null, error: `git branch failed: ${error.message}` };
    }
  }
}

export class GitStashTool extends BaseTool {
  name = 'git_stash';
  description = 'Save or restore uncommitted work. Use "push" to stash changes, "pop" to restore, "list" to see stashes.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: '"push" — stash current changes. "pop" — restore most recent stash. "list" — show all stashes.',
        enum: ['push', 'pop', 'list'],
      },
      message: {
        type: 'string',
        description: 'Optional label for the stash (push only)',
      },
    },
    required: ['action'] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { action } = args as { action: string };
    return { wouldSucceed: true, description: `Would git stash ${action}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { action, message } = args as { action: 'push' | 'pop' | 'list'; message?: string };
    try {
      if (action === 'list') {
        const { stdout } = await execAsync('git stash list', { cwd: CWD });
        const stashes = stdout.trim().split('\n').filter(Boolean);
        return { success: true, output: { stashes, count: stashes.length } };
      }
      if (action === 'push') {
        const label = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
        const { stdout } = await execAsync(`git stash push${label}`, { cwd: CWD });
        return { success: true, output: { action, message: stdout.trim() } };
      }
      if (action === 'pop') {
        const { stdout } = await execAsync('git stash pop', { cwd: CWD });
        return { success: true, output: { action, message: stdout.trim() } };
      }
      return { success: false, output: null, error: `Unknown action: ${action}` };
    } catch (error: any) {
      return { success: false, output: null, error: `git stash failed: ${error.message}` };
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
