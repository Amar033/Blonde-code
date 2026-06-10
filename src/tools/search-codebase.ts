import { BaseTool, ToolResult, FakeRunResult } from './base.js';
import { repoMapService } from '../services/repo-map.js';

export class SearchCodebaseTool extends BaseTool {
  name = 'search_codebase';
  description = 'Search the codebase symbol index for files, classes, functions, and types matching a query. Much faster than grep for locating where something is defined. Use this BEFORE read_file when you need to find where a class, function, or type lives.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Symbol name, partial name, or keyword (e.g. "BashTool", "execute", "auth", "session")',
      },
    },
    required: ['query'],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { query } = args as { query: string };
    if (!query?.trim()) {
      return { wouldSucceed: false, description: 'Empty query', warnings: ['Query required'] };
    }
    return { wouldSucceed: true, description: `Would search codebase for: ${query}` };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const { query } = args as { query: string };

    if (!query?.trim()) {
      return { success: false, output: null, error: 'Query cannot be empty' };
    }

    const matches = repoMapService.search(query.trim());

    if (matches.length === 0) {
      return {
        success: true,
        output: {
          query,
          matchCount: 0,
          message: 'No matches found in codebase index. Try grep for full-text search.',
        },
      };
    }

    const topMatches = matches.slice(0, 20);
    const formatted  = topMatches
      .map(m =>
        m.symbols.length > 0
          ? `${m.file}\n  ${m.symbols.slice(0, 6).join('\n  ')}`
          : m.file
      )
      .join('\n');

    return {
      success: true,
      output: {
        query,
        matchCount: matches.length,
        formatted,
        matches: topMatches,
      },
    };
  }
}
