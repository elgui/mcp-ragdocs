import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { McpToolResponse, isDocumentPayload } from '../types.js';

const COLLECTION_NAME = 'documentation';

export class SearchDocumentationHandler extends BaseHandler {
  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    const limit = args.limit || 5;

    try {
      const queryEmbedding = await this.apiClient.getEmbeddings(args.query);

      // Prioritize docstrings in search results
      const searchResults = await this.apiClient.qdrantClient.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit: limit * 2, // Get more results initially to filter
        with_payload: true,
        with_vector: false, // Optimize network transfer by not retrieving vectors
        score_threshold: 0.7, // Only return relevant results
      });

      // Sort results to prioritize docstrings over code
      const sortedResults = searchResults
        .sort((a, b) => {
          // First sort by domain (docs first)
          const aDomain = a.payload && 'domain' in a.payload ? a.payload.domain : undefined;
          const bDomain = b.payload && 'domain' in b.payload ? b.payload.domain : undefined;

          if (aDomain === 'docs' && bDomain !== 'docs') return -1;
          if (aDomain !== 'docs' && bDomain === 'docs') return 1;
          // Then by score
          return b.score - a.score;
        })
        .slice(0, limit); // Take only the requested number after sorting

      const formattedResults = sortedResults.map(result => {
        if (!isDocumentPayload(result.payload)) {
          throw new Error('Invalid payload type');
        }

        // Include symbol and domain information in the result
        let content = `[${result.payload.title}](${result.payload.url})\n`;
        content += `Score: ${result.score.toFixed(3)}\n`;

        if (result.payload.symbol) {
          content += `Symbol: ${result.payload.symbol}\n`;
        }

        if (result.payload.domain) {
          content += `Type: ${result.payload.domain}\n`;
        }

        if (result.payload.lines && result.payload.lines[0] !== 0) {
          content += `Lines: ${result.payload.lines[0]}-${result.payload.lines[1]}\n`;
        }

        content += `Content: ${result.payload.text}\n`;
        return content;
      }).join('\n---\n');

      return {
        content: [
          {
            type: 'text',
            text: formattedResults || 'No results found matching the query.',
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Failed to authenticate with Qdrant cloud while searching'
          );
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            'Connection to Qdrant cloud failed while searching'
          );
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: `Search failed: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}
