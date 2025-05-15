import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse } from '../types.js';
import { IndexingStatusManager } from '../utils/indexing-status-manager.js';

export class GetIndexingStatusEnhancedTool extends EnhancedBaseTool {
  private statusManager: IndexingStatusManager;

  constructor(options: { apiClient?: any; server?: any } = {}) {
    super(options);
    this.statusManager = new IndexingStatusManager();
  }

  get definition() {
    return {
      name: 'get_indexing_status',
      description: 'Gets the current indexing status for repositories.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Optional: The name of the repository to get the status for.',
          },
        },
        required: [],
      },
    };
  }

  async execute(args: { name?: string }): Promise<McpToolResponse> {
    // If name is provided, get status for specific repository
    if (args.name && typeof args.name === 'string') {
      const status = await this.statusManager.getStatus(args.name);

      if (!status) {
        return this.formatTextResponse(`No indexing status found for repository: ${args.name}`);
      }

      // Format the status information
      const formattedStatus = this.formatStatus(status);

      return this.formatTextResponse(formattedStatus);
    }
    // Otherwise, get all statuses
    else {
      const allStatuses = await this.statusManager.getAllStatuses();

      if (allStatuses.length === 0) {
        return this.formatTextResponse('No repository indexing operations found.');
      }

      // Format all statuses
      const formattedStatuses = allStatuses.map(status => this.formatStatus(status)).join('\n\n---\n\n');

      return this.formatTextResponse(formattedStatuses);
    }
  }

  private formatStatus(status: any): string {
    const startTime = new Date(status.startTime).toLocaleString();
    const endTime = status.endTime ? new Date(status.endTime).toLocaleString() : 'In progress';
    const duration = status.endTime
      ? this.formatDuration(new Date(status.endTime).getTime() - new Date(status.startTime).getTime())
      : this.formatDuration(Date.now() - new Date(status.startTime).getTime());

    let statusText = '';

    switch (status.status) {
      case 'pending':
        statusText = '⏳ Pending';
        break;
      case 'processing':
        statusText = '🔄 Processing';
        break;
      case 'completed':
        statusText = '✅ Completed';
        break;
      case 'failed':
        statusText = '❌ Failed';
        break;
      default:
        statusText = status.status;
    }

    let result = `Repository: ${status.repositoryName}\n`;
    result += `Status: ${statusText}\n`;
    result += `Progress: ${status.percentageComplete || 0}%\n`;
    result += `Started: ${startTime}\n`;

    if (status.status === 'completed' || status.status === 'failed') {
      result += `Ended: ${endTime}\n`;
    }

    result += `Duration: ${duration}\n`;

    if (status.totalFiles !== undefined) {
      result += `Files: ${status.processedFiles || 0} processed, ${status.skippedFiles || 0} skipped (of ${status.totalFiles})\n`;
    }

    if (status.totalChunks !== undefined) {
      result += `Chunks: ${status.indexedChunks || 0} indexed (of ${status.totalChunks})\n`;
    }

    if (status.currentBatch !== undefined && status.totalBatches !== undefined) {
      result += `Batch: ${status.currentBatch} of ${status.totalBatches}\n`;
    }

    if (status.error) {
      result += `Error: ${status.error}\n`;
    }

    return result;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
