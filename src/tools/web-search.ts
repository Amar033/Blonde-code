import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class WebSearchTool extends BaseTool {
  name = 'web_search';
  description = 'Search the web for information. Use to find documentation, solutions, or answers to technical questions.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      numResults: {
        type: 'number',
        description: 'Number of results to return (default: 5)',
        default: 5,
      },
    },
    required: ['query'],
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { query } = args as { query: string };

    if (!query || query.trim().length < 2) {
      return {
        wouldSucceed: false,
        description: 'Search query too short',
        warnings: ['Query must be at least 2 characters'],
      };
    }

    return {
      wouldSucceed: true,
      description: `Would search for: ${query}`,
    };
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { query, numResults = 5 } = args as {
      query: string;
      numResults?: number;
    };

    if (!query || query.trim().length < 2) {
      return {
        success: false,
        output: null,
        error: 'Search query must be at least 2 characters',
      };
    }

    try {
      // Use DuckDuckGo HTML (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
      
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          output: null,
          error: `Search failed: HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const results = this.parseResults(html, numResults);

      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          query,
          resultsCount: results.length,
          results,
        },
        metadata: {
          duration,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        success: false,
        output: null,
        error: `Search failed: ${error.message}`,
        metadata: {
          duration,
        },
      };
    }
  }

  private parseResults(html: string, limit: number): Array<{
    title: string;
    url: string;
    snippet: string;
  }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    
    // Simple regex-based parsing (DuckDuckGo HTML format)
    const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    
    let match;
    while ((match = resultRegex.exec(html)) && results.length < limit) {
      const url = match[1];
      const title = this.stripHtml(match[2]).trim();
      const snippet = this.stripHtml(match[3]).trim();
      
      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    // Fallback: simpler parsing
    if (results.length === 0) {
      const titleRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
      while ((match = titleRegex.exec(html)) && results.length < limit) {
        results.push({
          url: match[1],
          title: this.stripHtml(match[2]).trim(),
          snippet: '',
        });
      }
    }

    return results;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
