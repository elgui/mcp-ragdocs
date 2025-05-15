import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AddDocumentationEnhancedTool } from './add-documentation-enhanced.js'; // Use the enhanced tool
import { error } from '../utils/logger.js';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt');

export class RunQueueEnhancedTool extends EnhancedBaseTool {
  private addDocTool: AddDocumentationEnhancedTool;

  constructor(options: { apiClient?: any; server?: any } = {}) {
    super(options);
    if (!this.apiClient) {
      throw new Error('API client is required for RunQueueEnhancedTool');
    }
    // Initialize the enhanced tool, passing necessary options
    this.addDocTool = new AddDocumentationEnhancedTool({ apiClient: this.apiClient, server: this.server || options.server });
  }

  get definition() {
    return {
      name: 'run_queue',
      description: 'Process URLs from the queue one at a time until complete',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  async execute(_args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    try {
      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        return this.formatTextResponse('Queue is empty (queue file does not exist)');
      }

      let processedCount = 0;
      let failedCount = 0;
      const failedUrls: string[] = [];

      while (true) {
        // Read current queue
        const content = await fs.readFile(QUEUE_FILE, 'utf-8');
        const urls = content.split('\n').filter(url => url.trim() !== '');

        if (urls.length === 0) {
          break; // Queue is empty
        }

        const currentUrl = urls[0]; // Get first URL

        try {
          // Process the URL using the enhanced add_documentation tool
          // Pass the callContext along if it exists
          await this.addDocTool.execute({ url: currentUrl }, callContext);
          processedCount++;
        } catch (process_error) {
          failedCount++;
          failedUrls.push(currentUrl);
          error(`Failed to process URL ${currentUrl}: ${process_error instanceof Error ? process_error.message : String(process_error)}`);
        }

        // Remove the processed URL from queue
        const remainingUrls = urls.slice(1);
        await fs.writeFile(QUEUE_FILE, remainingUrls.join('\n') + (remainingUrls.length > 0 ? '\n' : ''));
      }

      let resultText = `Queue processing complete.\nProcessed: ${processedCount} URLs\nFailed: ${failedCount} URLs`;
      if (failedUrls.length > 0) {
        resultText += `\n\nFailed URLs:\n${failedUrls.join('\n')}`;
      }

      return this.formatTextResponse(resultText);
    } catch (err) {
      error(`Failed to process queue: ${err instanceof Error ? err.message : String(err)}`);
      return this.formatTextResponse(`Failed to process queue. Check logs for details.`);
    }
  }
}
