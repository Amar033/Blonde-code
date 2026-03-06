import {promises as fs} from 'fs';
import {BaseTool, ToolResult, FakeRunResult} from './base.js';

export class ListFilesTool extends BaseTool {
  name = 'list_files';
  description = 'List files and directories in a given path. Returns file names and types.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to directory (relative or absolute). Use "./src" for src directory.',
        default: '.',
      },
    },
    required: ['path'],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const {path = '.'} = args as {path?: string};

    try {
      await fs.access(path);
      const stats = await fs.stat(path);
      if (!stats.isDirectory()) {
        return {
          wouldSucceed: false,
          description: `Path is not a directory: ${path}`,
          warnings: ['Not a Directory'],
        };
      }
      return {
        wouldSucceed: true,
        description: `Would list files in: ${path}`,
      };
    } catch {
      return {
        wouldSucceed: false,
        description: `Directory does not exist: ${path}`,
        warnings: ['Directory not found'],
      };
    }
  }

  async execute(args: unknown): Promise<ToolResult> {
    const {path = '.'} = args as {path?: string};

    try {
      const entries = await fs.readdir(path, {withFileTypes: true});

      // Filter out noise
      const filtered = entries.filter(e =>
        !e.name.startsWith('.') &&
        e.name !== 'node_modules' &&
        e.name !== 'dist' &&
        e.name !== 'build'
      );

      // Separate files and directories
      const files = filtered
        .filter(e => !e.isDirectory())
        .map(e => e.name);
      
      const directories = filtered
        .filter(e => e.isDirectory())
        .map(e => e.name);

      // Filter TypeScript files if in src
      const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

      // Return human-readable summary
      const summary = [
        `Directory: ${path}`,
        `Total items: ${filtered.length}`,
        `Files: ${files.length} (${tsFiles.length} TypeScript files)`,
        `Directories: ${directories.length}`,
        '',
        'TypeScript files:',
        ...tsFiles.map(f => `  - ${f}`),
        '',
        'Directories:',
        ...directories.map(d => `  - ${d}/`),
      ].join('\n');

      return {
        success: true,
        output: summary, // ← Human-readable string, not object!
        metadata: {
          path,
          fileCount: files.length,
          dirCount: directories.length,
          tsFileCount: tsFiles.length,
          files,
          directories,
          tsFiles,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: `Failed to list directory: ${error}`,
      };
    }
  }
}
