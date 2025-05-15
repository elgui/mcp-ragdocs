import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse } from '../types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const COLLECTION_NAME = 'documentation';

export class RemoveDocumentationEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'remove_documentation',
      description: 'Remove one or more documentation sources by their URLs',
      inputSchema: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: {
              type: 'string',
              description: 'URL of a documentation source to remove'
            },
            description: 'Array of URLs to remove. Can be a single URL or multiple URLs.',
            minItems: 1
          }
        },
        required: ['urls'],
      },
    };
  }

  async execute(args: { urls: string[] }, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is not available for RemoveDocumentationEnhancedTool');
    }

    if (!Array.isArray(args.urls) || args.urls.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one URL is required');
    }

    if (!args.urls.every(url => typeof url === 'string')) {
      throw new McpError(ErrorCode.InvalidParams, 'All URLs must be strings');
    }

    try {
      // Delete using filter to match any of the provided URLs
      const result = await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
        filter: {
          should: args.urls.map(url => ({
            key: 'url',
            match: { value: url }
          }))
        },
        wait: true
      });

      if (!['acknowledged', 'completed'].includes(result.status)) {
        throw new Error('Delete operation failed');
      }

      return this.formatTextResponse(
        `Successfully removed documentation from ${args.urls.length} source${args.urls.length > 1 ? 's' : ''}: ${args.urls.join(', ')}`
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant cloud while removing documentation'
          );
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            'Connection to Qdrant cloud failed while removing documentation'
          );
        }
      }
      // Fallback for other errors
      return this.formatResponse({
        content: [{ type: 'text', text: `Failed to remove documentation: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      });
    }
  }
}
