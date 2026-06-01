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
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;

      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          // Without Referer, DDG returns its homepage instead of search results
          'Referer': 'https://duckduckgo.com/',
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

    // DDG HTML structure (2024+):
    //   <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL&rut=...">TITLE</a>
    //   <a class="result__snippet" href="...">SNIPPET (may contain <b> tags)</a>
    const titleRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = titleRegex.exec(html)) && results.length < limit) {
      const rawHref = match[1];
      const title   = this.stripHtml(match[2]).trim();
      if (!title) continue;

      const url = this.extractRealUrl(rawHref);

      // Find the snippet that follows this title link
      const afterTitle = html.slice(match.index + match[0].length);
      const snippetMatch = afterTitle.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]).trim() : '';

      results.push({ title, url, snippet });
    }

    return results;
  }

  // DDG wraps real URLs as: //duckduckgo.com/l/?uddg=URL_ENCODED_URL&rut=...
  private extractRealUrl(href: string): string {
    try {
      const uddg = href.match(/[?&]uddg=([^&]+)/)?.[1];
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      // fall through
    }
    // Already a normal URL or unknown format — return as-is
    return href.startsWith('//') ? `https:${href}` : href;
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
