import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { BaseTool, ToolResult, FakeRunResult } from './base.js';

const CWD = process.cwd();

const BLOCKED = ['node_modules', '.git', 'dist', 'build'];
function isBlocked(p: string): boolean {
  return BLOCKED.some(b => p.includes(b));
}

// Normalize a block of code for fuzzy matching:
// - Collapse all leading whitespace per line to a single space
// - Strip trailing whitespace
// - Remove blank lines at top/bottom
function normalise(text: string): string {
  return text
    .split('\n')
    .map(l => l.trimStart())          // ignore indentation differences
    .join('\n')
    .trim();
}

// Find the best match of `search` inside `source`, tolerating indentation differences.
// Returns the start/end char indices of the matched region, or null if no match.
function findFuzzy(source: string, search: string): { start: number; end: number } | null {
  const normSearch = normalise(search);
  const sourceLines = source.split('\n');

  const searchLines = search.split('\n')
    .map(l => l.trimStart())
    .filter((_, i, arr) => !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === ''));

  if (searchLines.length === 0) return null;

  // Slide a window of searchLines.length over sourceLines, comparing normalised versions
  for (let i = 0; i <= sourceLines.length - searchLines.length; i++) {
    const window = sourceLines.slice(i, i + searchLines.length).map(l => l.trimStart());
    if (window.join('\n') === searchLines.join('\n')) {
      // Found — compute char offsets
      const start = sourceLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const end   = sourceLines.slice(0, i + searchLines.length).join('\n').length + (i + searchLines.length < sourceLines.length ? 1 : 0);
      return { start, end };
    }
  }

  return null;
}

export class ReplaceBlockTool extends BaseTool {
  name = 'replace_block';
  description = `Edit a file using a search/replace block. More reliable than edit_file when the exact whitespace is uncertain or the match might not be unique. Provide the exact lines to find and the replacement. Tolerates indentation differences.`;

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File to edit (relative to project root)',
      },
      search: {
        type: 'string',
        description: 'The exact lines to find and replace. Copy them directly from the file — do not paraphrase.',
      },
      replace: {
        type: 'string',
        description: 'The lines to substitute in. Use the correct final indentation.',
      },
    },
    required: ['path', 'search', 'replace'] as string[],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { path, search } = args as { path: string; search: string };
    if (!path || !search) return { wouldSucceed: false, description: 'path and search required', warnings: [] };
    return { wouldSucceed: true, description: `Would replace block in ${path}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { path, search, replace } = args as { path: string; search: string; replace: string };

    if (!path?.trim())   return { success: false, output: null, error: 'path is required' };
    if (!search?.trim()) return { success: false, output: null, error: 'search block cannot be empty' };
    if (replace === undefined || replace === null) return { success: false, output: null, error: 'replace is required (use empty string to delete)' };
    if (isBlocked(path)) return { success: false, output: null, error: `Cannot edit protected path: ${path}` };

    const full = resolve(CWD, path);
    let source: string;
    try {
      source = readFileSync(full, 'utf8');
    } catch {
      return { success: false, output: null, error: `File not found: ${path}` };
    }

    const match = findFuzzy(source, search);
    if (!match) {
      // Helpful error: show what we were looking for vs what the file looks like
      const preview = source.split('\n').slice(0, 20).join('\n');
      return {
        success: false,
        output: null,
        error: `Could not find the search block in ${path}.\n\nYou searched for:\n${search}\n\nFile starts with:\n${preview}\n\nTip: read_file first and copy the exact lines.`,
      };
    }

    // Check for multiple matches — same safety guarantee as edit_file
    const second = findFuzzy(source.slice(match.end), search);
    if (second) {
      return {
        success: false,
        output: null,
        error: `Search block appears more than once in ${path}. Add more context lines to make it unique.`,
      };
    }

    const before = source.slice(0, match.start);
    const after  = source.slice(match.end);
    const result = before + replace + after;

    try {
      writeFileSync(full, result, 'utf8');
    } catch (e: any) {
      return { success: false, output: null, error: `Write failed: ${e.message}` };
    }

    const linesRemoved = search.split('\n').length;
    const linesAdded   = replace.split('\n').length;

    return {
      success: true,
      output: {
        path,
        linesRemoved,
        linesAdded,
        netLines: linesAdded - linesRemoved,
        message: `Replaced ${linesRemoved} lines with ${linesAdded} lines in ${path}`,
      },
    };
  }
}
