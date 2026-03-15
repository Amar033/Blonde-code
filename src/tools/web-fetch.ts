import { BaseTool, ToolResult, FakeRunResult } from './base.js';

export class WebFetchTool extends BaseTool {
  name = 'web_fetch';
  description = 'Fetch content from a URL. Supports text, markdown, and HTML formats. Use to read documentation, articles, or any web content.';

  argsSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch content from',
      },
      format: {
        type: 'string',
        description: 'Format to return: text, markdown, or html (default: markdown)',
        enum: ['text', 'markdown', 'html'],
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
    const { url } = args as { url: string; format?: string };

    try {
      new URL(url);
      return {
        wouldSucceed: true,
        description: `Would fetch content from: ${url}`,
      };
    } catch {
      return {
        wouldSucceed: false,
        description: `Invalid URL: ${url}`,
        warnings: ['Invalid URL format'],
      };
    }
  }

  async execute(args: unknown): Promise<ToolResult> {
    const startTime = Date.now();
    const { url, format = 'markdown', timeout = 30 } = args as {
      url: string;
      format?: 'text' | 'markdown' | 'html';
      timeout?: number;
    };

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          success: false,
          output: null,
          error: 'Only HTTP and HTTPS URLs are supported',
        };
      }
    } catch {
      return {
        success: false,
        output: null,
        error: 'Invalid URL format',
      };
    }

    // Cap timeout
    const timeoutMs = Math.min(timeout * 1000, 120 * 1000);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(format),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          output: null,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      let content = await response.text();

      // Truncate if too large
      if (content.length > this.maxResponseSize) {
        content = content.slice(0, this.maxResponseSize) + '\n\n[Truncated - content too large]';
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        output: {
          url,
          format,
          statusCode: response.status,
          contentLength: content.length,
          content: format === 'html' ? content : this.sanitize(content, format),
        },
        metadata: {
          duration,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      if (error.name === 'AbortError') {
        return {
          success: false,
          output: null,
          error: `Request timed out after ${timeout} seconds`,
        };
      }

      return {
        success: false,
        output: null,
        error: `Fetch failed: ${error.message}`,
      };
    }
  }

  private getHeaders(format: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Blonde-Agent/1.0',
    };

    switch (format) {
      case 'markdown':
        headers['Accept'] = 'text/markdown, text/x-markdown, text/plain, text/html, */*;q=0.1';
        break;
      case 'text':
        headers['Accept'] = 'text/plain, */*;q=0.1';
        break;
      case 'html':
        headers['Accept'] = 'text/html, */*;q=0.1';
        break;
    }

    return headers;
  }

  private sanitize(content: string, format: string): string {
    if (format === 'text') {
      return content
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .slice(0, 50000);
    }

    // For markdown, keep some formatting but clean up
    return content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .slice(0, 100000);
  }
}
