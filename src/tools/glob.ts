import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class GlobTool extends BaseTool {
  name = 'glob';
  description = 'Find files by name pattern. Use glob patterns like "**/*.ts" or "src/**/*.tsx" to locate files in your codebase.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")',
      },
      path: {
        type: 'string',
        description: 'Root directory to search from (default: ".")',
        default: '.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 100)',
        default: 100,
      },
    },
    required: ['pattern'],
  };

  isDangerous = false;
  requiresApproval = false;

  private defaultExclude = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.sst',
    '.cache',
    '.parcel-cache',
  ];

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { pattern, path = '.' } = args as { pattern: string; path?: string };

    try {
      await fs.access(path);
      return {
        wouldSucceed: true,
        description: `Would search for "${pattern}" in ${path}`,
      };
    } catch {
      return {
        wouldSucceed: false,
        description: `Path not found: ${path}`,
        warnings: ['Invalid path'],
      };
    }
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { pattern, path = '.', maxResults = 100 } = args as {
      pattern: string;
      path?: string;
      maxResults?: number;
    };

    try {
      const results = await this.glob(pattern, path, maxResults);
      
      const duration = Date.now() - startTime;

      // Group by directory
      const byDirectory: Record<string, string[]> = {};
      for (const file of results) {
        const dir = dirname(file);
        if (!byDirectory[dir]) {
          byDirectory[dir] = [];
        }
        byDirectory[dir].push(basename(file));
      }

      return {
        success: true,
        output: {
          pattern,
          path,
          matches: results.length,
          files: results,
          byDirectory,
        },
        metadata: {
          duration,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Glob failed: ${error}`,
      };
    }
  }

  private async glob(
    pattern: string,
    rootPath: string,
    maxResults: number
  ): Promise<string[]> {
    const results: string[] = [];
    
    // Parse the pattern
    const parts = this.parsePattern(pattern);
    
    // Start searching
    await this.search(parts, rootPath, results, maxResults, 0);
    
    return results;
  }

  private parsePattern(pattern: string): string[] {
    // Split pattern into parts, handling ** specially
    const parts: string[] = [];
    let current = '';
    let i = 0;
    
    while (i < pattern.length) {
      if (pattern[i] === '*' && pattern[i + 1] === '*') {
        if (current) {
          parts.push(current);
          current = '';
        }
        parts.push('**');
        i += 2;
      } else if (pattern[i] === '/') {
        if (current) parts.push(current);
        current = '';
        i++;
      } else {
        current += pattern[i];
        i++;
      }
    }
    if (current) parts.push(current);
    
    return parts;
  }

  private async search(
    parts: string[],
    currentPath: string,
    results: string[],
    maxResults: number,
    partIndex: number
  ): Promise<void> {
    if (results.length >= maxResults || partIndex >= parts.length) {
      return;
    }

    const part = parts[partIndex];
    const isLast = partIndex === parts.length - 1;
    const isGlobstar = part === '**';

    if (isGlobstar) {
      // ** matches any number of directories
      await this.search(parts, currentPath, results, maxResults, partIndex + 1);
      
      // Also search in subdirectories
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !this.defaultExclude.includes(entry.name)) {
            const subPath = join(currentPath, entry.name);
            await this.search(parts, subPath, results, maxResults, partIndex);
          }
        }
      } catch {
        // Ignore errors
      }
    } else if (this.hasGlob(part)) {
      // Has glob characters (*, ?, [])
      const regex = this.globToRegex(part);
      
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          
          if (regex.test(entry.name) && !this.defaultExclude.includes(entry.name)) {
            const fullPath = join(currentPath, entry.name);
            
            if (isLast) {
              results.push(fullPath);
            } else if (entry.isDirectory()) {
              await this.search(parts, fullPath, results, maxResults, partIndex + 1);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    } else {
      // Literal match
      const fullPath = join(currentPath, part);
      
      try {
        const stats = await fs.stat(fullPath);
        
        if (isLast) {
          if (stats.isFile()) {
            results.push(fullPath);
          }
        } else if (stats.isDirectory()) {
          await this.search(parts, fullPath, results, maxResults, partIndex + 1);
        }
      } catch {
        // Path doesn't exist, ignore
      }
    }
  }

  private hasGlob(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
  }

  private globToRegex(pattern: string): RegExp {
    let regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    return new RegExp(`^${regexStr}$`, 'i');
  }
}
