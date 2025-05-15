import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { McpToolResponse, isDocumentPayload } from '../types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';

const COLLECTION_NAME = 'documentation';

/**
 * Enhanced search documentation tool that replaces both the handler and tool versions.
 * This demonstrates the migration pattern for consolidating handlers and tools.
 */
export class SearchDocumentationEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'search_documentation',
      description: 'Search through stored documentation using natural language queries',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 5,
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    console.log('SearchDocumentationTool: execute method invoked.');

    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is required for search');
    }

    const limit = args.limit || 5;

    try {
      console.log('SearchDocumentationTool: Calling getEmbeddings...');
      const queryEmbedding = await this.apiClient.getEmbeddings(args.query);
      console.log('SearchDocumentationTool: getEmbeddings successful.');

      console.log('SearchDocumentationTool: Calling qdrantClient.search...');
      const searchResults = await this.apiClient.qdrantClient.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit: limit * 2, // Get more results initially to filter
        with_payload: true,
        with_vector: false, // Optimize network transfer by not retrieving vectors
        score_threshold: 0.7, // Only return relevant results
      });
      console.log('SearchDocumentationTool: qdrantClient.search successful.');

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

        // Construct a result object for the frontend
        return {
          title: result.payload.title,
          url: result.payload.url,
          // Combine relevant information for the snippet/content
          content: `Score: ${result.score.toFixed(3)}${result.payload.symbol ? ` | Symbol: ${result.payload.symbol}` : ''}${result.payload.domain ? ` | Type: ${result.payload.domain}` : ''}${result.payload.lines && result.payload.lines[0] !== 0 ? ` | Lines: ${result.payload.lines[0]}-${result.payload.lines[1]}` : ''}\n${result.payload.text}`,
          snippet: result.payload.text, // Provide the text as a snippet
        };
      });

      return this.formatJsonResponse({
        results: formattedResults.length > 0 ? formattedResults : [],
        message: formattedResults.length > 0 ? 'Search successful' : 'No results found matching the query.',
      });
    } catch (error: any) {
      console.error('Backend search error:', error);
      if (error instanceof McpError) {
        throw error; // Re-throw known MCP errors
      }
      // Handle other errors and return a structured error response
      return {
        content: [
          {
            type: 'json',
            json: {
              results: [],
              message: `Search failed: ${(error as Error).message || error}`,
            }
          },
        ],
        isError: true,
      };
    }
  }
}
