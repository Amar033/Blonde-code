import { promises as fs } from 'fs';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class GrepTool extends BaseTool {
  name = 'grep';
  description = 'Search for text patterns in files using regex. Use to find code, comments, or patterns across your codebase.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in (default: .)',
        default: '.',
      },
      include: {
        type: 'string',
        description: 'File patterns to include (e.g., "*.ts", "*.js")',
      },
      exclude: {
        type: 'string',
        description: 'File patterns to exclude (e.g., "node_modules", "*.json")',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
        default: false,
      },
      context: {
        type: 'number',
        description: 'Number of lines of context to show (default: 0)',
        default: 0,
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
    '*.log',
  ];

  private isExcluded(filePath: string, excludePatterns: string[]): boolean {
    const patterns = [...this.defaultExclude, ...excludePatterns];
    const lowerPath = filePath.toLowerCase();
    
    return patterns.some(pattern => {
      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        return lowerPath.endsWith(ext);
      }
      return lowerPath.includes(pattern.toLowerCase());
    });
  }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { pattern, path = '.' } = args as {
      pattern: string;
      path?: string;
      include?: string;
      exclude?: string;
    };

    try {
      const stats = await fs.stat(path);
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
    const {
      pattern,
      path = '.',
      include,
      exclude,
      caseSensitive = false,
      context = 0,
      maxResults = 100,
    } = args as {
      pattern: string;
      path?: string;
      include?: string;
      exclude?: string;
      caseSensitive?: boolean;
      context?: number;
      maxResults?: number;
    };

    const excludePatterns = exclude ? exclude.split(',').map(s => s.trim()) : [];

    try {
      const stats = await fs.stat(path);
      const isDirectory = stats.isDirectory();
      
      const filesToSearch = isDirectory 
        ? await this.findFiles(path as string, include, excludePatterns)
        : [path as string];

      const results: Array<{
        file: string;
        line: number;
        content: string;
        context?: string[];
      }> = [];

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      } catch (error) {
        return {
          success: false,
          output: null,
          error: `Invalid regex pattern: ${error}`,
        };
      }

      for (const filePath of filesToSearch) {
        if (results.length >= maxResults) break;

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;

            const line = lines[i];
            const match = caseSensitive 
              ? line.match(regex) 
              : line.match(new RegExp(pattern, 'i'));

            if (match) {
              const result: any = {
                file: filePath,
                line: i + 1,
                content: line.trim(),
              };

              if (context > 0) {
                const start = Math.max(0, i - context);
                const end = Math.min(lines.length - 1, i + context);
                result.context = lines.slice(start, end + 1).map((l, idx) => {
                  const lineNum = start + idx + 1;
                  const prefix = lineNum === i + 1 ? '>' : ' ';
                  return `${prefix}${lineNum}: ${l}`;
                });
              }

              results.push(result);
            }
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          pattern,
          path,
          matches: results.length,
          results: results.slice(0, maxResults),
          filesMatched: [...new Set(results.map(r => r.file))].length,
        },
        metadata: {
          duration,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Search failed: ${error}`,
      };
    }
  }

  private async findFiles(
    dirPath: string,
    include: string | undefined,
    excludePatterns: string[]
  ): Promise<string[]> {
    const files: string[] = [];
    
    const includePatterns = include 
      ? include.split(',').map(s => s.trim()) 
      : ['*'];

    const processDir = async (currentPath: string) => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = `${currentPath}/${entry.name}`;
          
          if (this.isExcluded(fullPath, excludePatterns)) {
            continue;
          }

          if (entry.isDirectory()) {
            await processDir(fullPath);
          } else if (entry.isFile()) {
            const matchesInclude = includePatterns.some(pattern => {
              if (pattern.startsWith('*.')) {
                const ext = pattern.slice(1);
                return entry.name.endsWith(ext);
              }
              return entry.name.includes(pattern);
            });
            
            if (matchesInclude || !include) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await processDir(dirPath);
    return files;
  }
}
