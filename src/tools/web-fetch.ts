import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class WebFetchTool extends BaseTool {
  name = 'web_fetch';
  description = 'Fetch content from a URL and return clean AI-readable markdown. Extracts main article/doc content, preserves links for further navigation. Use "jina" format as cloud fallback when the local extractor fails.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch content from',
      },
      format: {
        type: 'string',
        description: 'Extraction mode. "markdown" (default) uses local Readability+Turndown — unlimited, private, preserves links. "jina" uses r.jina.ai as a cloud fallback. "html" returns raw HTML. "text" strips all tags.',
        enum: ['markdown', 'jina', 'html', 'text'],
        default: 'markdown',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30, max: 120)',
        default: 30,
      },
    },
    required: ['url'],
  };

  isDangerous = false;
  requiresApproval = false;

  private maxResponseSize = 5 * 1024 * 1024; // 5MB

  async fakeRun(args: unknown): Promise<FakeRunResult> {
    const { url } = args as { url: string };
    try {
      new URL(url);
      return { wouldSucceed: true, description: `Would fetch content from: ${url}` };
    } catch {
      return { wouldSucceed: false, description: `Invalid URL: ${url}`, warnings: ['Invalid URL format'] };
    }
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { url, format = 'markdown', timeout = 30 } = args as {
      url: string;
      format?: 'markdown' | 'jina' | 'html' | 'text';
      timeout?: number;
    };

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, output: null, error: 'Only HTTP and HTTPS URLs are supported' };
      }
    } catch {
      return { success: false, output: null, error: 'Invalid URL format' };
    }

    if (format === 'jina') {
      return this.fetchViaJina(url, timeout, startTime);
    }

    // Fetch raw HTML from the origin
    const timeoutMs = Math.min(timeout * 1000, 120 * 1000);
    let rawHtml: string;
    let statusCode: number;

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (!response.ok) {
        return { success: false, output: null, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      statusCode = response.status;
      rawHtml = await response.text();
      if (rawHtml.length > this.maxResponseSize) {
        rawHtml = rawHtml.slice(0, this.maxResponseSize);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, output: null, error: `Request timed out after ${timeout}s` };
      }
      return { success: false, output: null, error: `Fetch failed: ${error.message}` };
    }

    // Return raw HTML as-is
    if (format === 'html') {
      return {
        success: true,
        output: { url, format: 'html', statusCode, contentLength: rawHtml.length, content: rawHtml },
        metadata: { duration: Date.now() - startTime },
      };
    }

    // Local extraction: Readability → Turndown → clean markdown with links
    try {
      const content = await this.extractLocally(rawHtml, url, format);
      return {
        success: true,
        output: { url, format: 'markdown', statusCode, contentLength: content.length, content },
        metadata: { duration: Date.now() - startTime },
      };
    } catch {
      // Extraction failed — fall back to Jina
      return this.fetchViaJina(url, timeout, startTime);
    }
  }

  // ── Local extractor: Readability + Turndown ──────────────────────────────

  private async extractLocally(html: string, url: string, format: string): Promise<string> {
    const { parseHTML }  = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const TurndownService = (await import('turndown')).default;

    const { document } = parseHTML(html);

    // Resolve relative links to absolute before extraction
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head?.appendChild(base);

    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article) throw new Error('Readability could not extract content');

    if (format === 'text') {
      return (article.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000);
    }

    const td = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    });

    // Keep links and images
    td.keep(['a', 'img']);

    const markdown = td.turndown(article.content ?? '');
    const header   = `# ${article.title ?? ''}\n\n`;
    return (header + markdown).slice(0, 100000);
  }

  // ── Jina Reader (cloud fallback) ─────────────────────────────────────────

  private async fetchViaJina(url: string, timeout: number, startTime: number): Promise<ToolResult> {
    const jinaUrl  = `https://r.jina.ai/${url}`;
    const timeoutMs = Math.min(timeout * 1000, 120 * 1000);

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        'User-Agent': 'Blonde-Agent/1.0',
        'Accept': 'text/plain, text/markdown, */*',
        'X-Return-Format': 'markdown',
      };
      if (process.env.JINA_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
      }

      const response = await fetch(jinaUrl, { headers, signal: controller.signal });
      clearTimeout(t);

      if (!response.ok) {
        return { success: false, output: null, error: `Jina Reader: HTTP ${response.status}` };
      }

      let content = await response.text();
      if (content.length > this.maxResponseSize) content = content.slice(0, this.maxResponseSize) + '\n\n[Truncated]';

      return {
        success: true,
        output: { url, format: 'jina', statusCode: response.status, contentLength: content.length, content },
        metadata: { duration: Date.now() - startTime },
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, output: null, error: `Jina Reader timed out after ${timeout}s` };
      }
      return { success: false, output: null, error: `Jina Reader failed: ${error.message}` };
    }
  }
}
