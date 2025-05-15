import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpToolResponse } from '../types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt');

/**
 * Enhanced extract URLs tool that replaces both the handler and tool versions.
 * This demonstrates the migration pattern for consolidating handlers and tools.
 */
export class ExtractUrlsEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'extract_urls',
      description: 'Extract all URLs from a given web page',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page to extract URLs from',
          },
          add_to_queue: {
            type: 'boolean',
            description: 'If true, automatically add extracted URLs to the queue',
            default: false,
          },
        },
        required: ['url'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required');
    }

    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is required for browser operations');
    }

    await this.apiClient.initBrowser();
    const page = await this.apiClient.browser.newPage();

    try {
      const baseUrl = new URL(args.url);
      const basePath = baseUrl.pathname.split('/').slice(0, 3).join('/'); // Get the base path (e.g., /3/ for Python docs)

      await page.goto(args.url, { waitUntil: 'networkidle' });
      const content = await page.content();
      const $ = cheerio.load(content);
      const urls = new Set<string>();

      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          try {
            const url = new URL(href, args.url);
            // Only include URLs from the same documentation section
            if (url.hostname === baseUrl.hostname && 
                url.pathname.startsWith(basePath) && 
                !url.hash && 
                !url.href.endsWith('#')) {
              urls.add(url.href);
            }
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      });

      const urlArray = Array.from(urls);

      if (args.add_to_queue) {
        try {
          // Ensure queue file exists
          try {
            await fs.access(QUEUE_FILE);
          } catch {
            await fs.writeFile(QUEUE_FILE, '');
          }

          // Append URLs to queue
          const urlsToAdd = urlArray.join('\n') + (urlArray.length > 0 ? '\n' : '');
          await fs.appendFile(QUEUE_FILE, urlsToAdd);

          return this.formatTextResponse(`Successfully added ${urlArray.length} URLs to the queue`);
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to add URLs to queue: ${error}`,
              },
            ],
            isError: true,
          };
        }
      }

      return this.formatTextResponse(urlArray.join('\n') || 'No URLs found on this page.');
    } catch (error) {
      return this.handleError(`Failed to extract URLs: ${error}`);
    } finally {
      await page.close();
    }
  }
}
