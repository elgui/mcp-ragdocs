import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', '..', 'queue.txt');

/**
 * Enhanced clear queue tool that replaces both the handler and tool versions.
 * This tool clears all URLs from the queue.
 */
export class ClearQueueEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'clear_queue',
      description: 'Clear all URLs from the queue',
      inputSchema: {
        type: 'object',
        properties: {
          verbose: {
            type: 'boolean',
            description: 'Whether to return detailed information about the cleared queue',
            default: false,
          },
        },
        required: [],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    const verbose = args?.verbose || false;
    
    try {
      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        return this.formatTextResponse('Queue is already empty (queue file does not exist)');
      }

      // Read current queue to get count of URLs being cleared
      const content = await fs.readFile(QUEUE_FILE, 'utf-8');
      const urls = content.split('\n').filter(url => url.trim() !== '');
      const urlCount = urls.length;

      // Clear the queue by emptying the file
      await fs.writeFile(QUEUE_FILE, '');

      if (verbose && urlCount > 0) {
        return this.formatTextResponse(
          `Queue cleared successfully. Removed ${urlCount} URL${urlCount === 1 ? '' : 's'} from the queue:\n\n` +
          urls.map((url, i) => `${i + 1}. ${url}`).join('\n')
        );
      } else {
        return this.formatTextResponse(
          `Queue cleared successfully. Removed ${urlCount} URL${urlCount === 1 ? '' : 's'} from the queue.`
        );
      }
    } catch (error) {
      return this.handleError(`Failed to clear queue: ${error}`);
    }
  }
}
