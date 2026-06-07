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
      category: {
        type: 'string',
        description: 'Search category: general, news, code, science (default: general, SearXNG only)',
        enum: ['general', 'news', 'code', 'science'],
        default: 'general',
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
    const { query, numResults = 5, category = 'general' } = args as {
      query: string;
      numResults?: number;
      category?: string;
    };

    if (!query || query.trim().length < 2) {
      return {
        success: false,
        output: null,
        error: 'Search query must be at least 2 characters',
      };
    }

    const searxngUrl = process.env.SEARXNG_BASE_URL;
    if (searxngUrl) {
      return this.searchViaSearXNG(query, numResults, category, searxngUrl, startTime);
    }
    return this.searchViaDuckDuckGo(query, numResults, startTime);
  }

  private async searchViaSearXNG(
    query: string,
    numResults: number,
    category: string,
    baseUrl: string,
    startTime: number
  ): Promise<ToolResult> {
    try {
      const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=${category}`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(t);

      if (!response.ok) {
        console.warn(`[WebSearch] SearXNG returned ${response.status}, falling back to DDG`);
        return this.searchViaDuckDuckGo(query, numResults, startTime);
      }

      const data = await response.json() as {
        results?: Array<{ title: string; url: string; content?: string; score?: number; engines?: string[] }>;
      };

      const results = (data.results ?? []).slice(0, numResults).map(r => ({
        title: r.title ?? '',
        url:   r.url   ?? '',
        snippet: r.content ?? '',
      }));

      return {
        success: true,
        output: { query, provider: 'searxng', resultsCount: results.length, results },
        metadata: { duration: Date.now() - startTime },
      };
    } catch (error: any) {
      console.warn(`[WebSearch] SearXNG error (${error.message}), falling back to DDG`);
      return this.searchViaDuckDuckGo(query, numResults, startTime);
    }
  }

  private async searchViaDuckDuckGo(
    query: string,
    numResults: number,
    startTime: number
  ): Promise<ToolResult> {
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
        output: { query, provider: 'duckduckgo', resultsCount: results.length, results },
        metadata: { duration },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: `Search failed: ${error.message}`,
        metadata: { duration: Date.now() - startTime },
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
