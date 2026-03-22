import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

const execAsync = promisify(exec);

export interface BashConfig {
  allowedCommands: string[];
  deniedCommands: string[];
  timeout: number;
  workingDirectory?: string;
}

export class BashTool extends BaseTool {
  name = 'bash';
  description = 'Execute shell commands. Use for installing dependencies, running tests, git operations, and other terminal tasks.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30)',
        default: 30,
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
    },
    required: ['command'],
  };

  isDangerous = true;
  requiresApproval = true;

  private config: BashConfig = {
    allowedCommands: [
      // Package managers
      'npm', 'npx', 'yarn', 'pnpm', 'bun',
      // Build tools
      'cargo', 'go', 'make', 'cmake', 'gradle',
      // Git (read-only mostly)
      'git status', 'git diff', 'git log', 'git branch', 'git show',
      'git stash', 'git stash pop', 'git fetch', 'git pull',
      // Reading/listing
      'ls', 'pwd', 'cat', 'head', 'tail', 'less', 'more',
      'find', 'grep', 'rg', 'fd', 'fzf',
      // Development
      'tsx', 'node', 'python', 'python3', 'ruby', 'php',
      'cargo', 'go', 'rustc', 'gcc', 'clang',
      // Utilities
      'curl', 'wget', 'echo', 'date', 'whoami', 'which',
      'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod', 'chown',
    ],
    deniedCommands: [
      // Destructive
      'rm -rf /', 'rm -rf ~', 'rm -rf /*',
      'dd', 'mkfs', 'fdisk', 'parted',
      // Privilege escalation
      'sudo', 'su', 'doas',
      // Malicious - pipe to bash
      '| bash', '| sh', '| zsh',
      'curl |', 'wget |',
      // System modification
      'chmod 777', 'chown -R',
      // Fork bombs
      ':(){:|:&};:', 'fork()',
      // Network exfiltration
      'nc -e', 'netcat -e', '/dev/tcp',
    ],
    timeout: 30,
  };

  private isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    const lowerCommand = command.toLowerCase().trim();
    
    // Check denylist first (takes priority)
    for (const denied of this.config.deniedCommands) {
      if (lowerCommand.includes(denied.toLowerCase())) {
        return { allowed: false, reason: `Command matches denied pattern: ${denied}` };
      }
    }

    // Check allowlist
    const baseCommand = lowerCommand.split(' ')[0];
    const isAllowed = this.config.allowedCommands.some(allowed => 
      lowerCommand.startsWith(allowed.toLowerCase()) || 
      baseCommand === allowed.toLowerCase()
    );

    if (isAllowed) {
      return { allowed: true };
    }

    // Not in allowlist - require approval
    return { allowed: false, reason: 'Command not in allowed list - requires approval' };
  }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { command } = args as { command: string; timeout?: number };
    
    const check = this.isCommandAllowed(command);
    
    if (!check.allowed) {
      return {
        wouldSucceed: false,
        description: check.reason || 'Command not allowed',
        warnings: ['Security check failed'],
      };
    }

    return {
      wouldSucceed: true,
      description: `Would execute: ${command}`,
    };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { command, timeout, cwd } = args as { 
      command: string; 
      timeout?: number; 
      cwd?: string;
    };

    const timeoutMs = (timeout || this.config.timeout) * 1000;

    // Security check
    const securityCheck = this.isCommandAllowed(command);
    if (!securityCheck.allowed) {
      return {
        success: false,
        output: null,
        error: securityCheck.reason || 'Command not allowed for security reasons',
      };
    }

    try {
      const workingDir = cwd || this.config.workingDirectory || process.cwd();
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB max output
      });

      const duration = Date.now() - startTime;
      
      const output = {
        stdout: stdout.slice(-100000), // Last 100KB
        stderr: stderr.slice(-50000),  // Last 50KB
        exitCode: 0,
        command,
        workingDir,
      };

      return {
        success: true,
        output,
        metadata: {
          duration,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      // Handle timeout
      if (error.killed || error.signal === 'SIGTERM') {
        return {
          success: false,
          output: null,
          error: `Command timed out after ${timeout || this.config.timeout} seconds`,
        };
      }

      // Handle non-zero exit code
      const output = {
        stdout: (error.stdout || '').slice(-100000),
        stderr: (error.stderr || '').slice(-50000),
        exitCode: error.code || 1,
        command,
      };

      return {
        success: false,
        output,
        error: error.message || `Command failed with exit code ${error.code}`,
        metadata: {
          duration,
        },
      };
    }
  }
}
