import { promises as fs } from 'fs';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class EditFileTool extends BaseTool {
  name = 'edit_file';
  description = 'Edit a file by finding exact text and replacing it with new content.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      find: {
        type: 'string',
        description: 'Exact text to find in the file',
      },
      replace: {
        type: 'string',
        description: 'Text to replace the found text with',
      },
    },
    required: ['path', 'find', 'replace'],
  };

  isDangerous = true;  // Modifies existing files
  requiresApproval = true;  // Should ask before executing

  private blockedPaths = [
    'node_modules',
    '.git',
    'dist',
    'build',
  ];

  private isBlockedPath(filePath: string): boolean {
    const normalized = filePath.toLowerCase();
    return this.blockedPaths.some(blocked => 
      normalized.includes(blocked.toLowerCase())
    );
  }

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { path, find } = args as { path: string; find: string; replace: string };

    if (this.isBlockedPath(path)) {
      return {
        wouldSucceed: false,
        description: `Cannot edit blocked path: ${path}`,
        warnings: ['Blocked path detected'],
      };
    }

    try {
      const content = await fs.readFile(path, 'utf-8');
      const matches = this.countMatches(content, find);
      
      if (matches === 0) {
        return {
          wouldSucceed: false,
          description: `Text not found in ${path}`,
          warnings: ['No match found'],
        };
      } else if (matches > 1) {
        return {
          wouldSucceed: false,
          description: `Multiple matches (${matches}) found - be more specific`,
          warnings: ['Multiple matches - ambiguous'],
        };
      }

      return {
        wouldSucceed: true,
        description: `Would replace ${find.length} chars in ${path}`,
      };
    } catch {
      return {
        wouldSucceed: false,
        description: `File not found: ${path}`,
        warnings: ['File does not exist'],
      };
    }
  }

  private countMatches(content: string, search: string): number {
    let count = 0;
    let index = 0;
    const lowerContent = content.toLowerCase();
    const lowerSearch = search.toLowerCase();
    
    while ((index = lowerContent.indexOf(lowerSearch, index)) !== -1) {
      count++;
      index += lowerSearch.length;
    }
    
    return count;
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { path, find, replace } = args as { path: string; find: string; replace: string };

    if (this.isBlockedPath(path)) {
      return {
        success: false,
        output: null,
        error: `Blocked path: ${path} is in a protected directory`,
      };
    }

    if (!find) {
      return {
        success: false,
        output: null,
        error: 'The "find" parameter cannot be empty',
      };
    }

    try {
      const content = await fs.readFile(path, 'utf-8');
      
      const matchCount = this.countMatches(content, find);
      
      if (matchCount === 0) {
        return {
          success: false,
          output: null,
          error: `Text not found in file. Make sure the text exactly matches (including whitespace).`,
        };
      }
      
      if (matchCount > 1) {
        return {
          success: false,
          output: null,
          error: `Found ${matchCount} matches. The "find" text must be unique to avoid unintended changes.`,
        };
      }

      const newContent = content.replace(find, replace);
      
      await fs.writeFile(path, newContent, 'utf-8');
      
      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          path,
          charsReplaced: find.length,
          charsAdded: replace.length,
          netChange: replace.length - find.length,
        },
        metadata: {
          duration,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          success: false,
          output: null,
          error: `File not found: ${path}`,
        };
      }
      return {
        success: false,
        output: null,
        error: `Failed to edit file: ${error}`,
      };
    }
  }
}
