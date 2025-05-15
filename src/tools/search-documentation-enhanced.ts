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
          repository: {
            type: 'string',
            description: 'Filter results by repository name'
          },
          language: {
            type: 'string',
            description: 'Filter results by programming language'
          },
          fileType: {
            type: 'string',
            description: 'Filter results by file extension (e.g., "js", "py")'
          },
          score_threshold: {
            type: 'number',
            description: 'Minimum relevance score for results (0.0 to 1.0)',
            default: 0.65,
          }
        },
        required: ['query'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    console.log('SearchDocumentationTool: execute method invoked with args:', args);

    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is required for search');
    }

    const limit = args.limit || 5;

    try {
      console.log('SearchDocumentationTool: Calling getEmbeddings with query:', args.query);
      const queryEmbedding = await this.apiClient.getEmbeddings(args.query);
      console.log('SearchDocumentationTool: getEmbeddings successful. Query embedding generated.');

      console.log('SearchDocumentationTool: Parsing query for potential filters...');
      // Parse the query for potential filters
      const filters: any = {};
      
      // Add explicit parameter filters if provided
      if (args.repository) {
        filters.repository = args.repository;
      }
      
      if (args.language) {
        filters.language = args.language.toLowerCase();
      }
      
      if (args.fileType) {
        filters.fileExtension = args.fileType.startsWith('.') ? args.fileType : `.${args.fileType}`;
      }
      
      // Also check for filters in the query string
      if (!filters.language) {
        const langMatch = args.query.match(/language:\s*([\w\+\#]+)/i);
        if (langMatch && langMatch[1]) {
          filters.language = langMatch[1].toLowerCase();
        }
      }
      
      if (!filters.repository) {
        const repoMatch = args.query.match(/repo(?:sitory)?:\s*([\w\-\.]+)/i);
        if (repoMatch && repoMatch[1]) {
          filters.repository = repoMatch[1];
        }
      }
      
      if (!filters.fileExtension) {
        const fileMatch = args.query.match(/file(?:type)?:\s*\.?([\w]+)/i);
        if (fileMatch && fileMatch[1]) {
          filters.fileExtension = `.${fileMatch[1].toLowerCase()}`;
        }
      }
      
      console.log('SearchDocumentationTool: Using search filters:', filters);
      
      console.log('SearchDocumentationTool: Building search filter...');
      // Build the search filter if any filters were detected
      const filterParams: any = {};
      if (Object.keys(filters).length > 0) {
        const mustConditions = [];
        
        if (filters.language) {
          mustConditions.push({
            key: 'language',
            match: { value: filters.language }
          });
        }
        
        if (filters.repository) {
          mustConditions.push({
            key: 'repository',
            match: { value: filters.repository }
          });
        }
        
        if (filters.fileExtension) {
          // Use a text match for file extensions
          mustConditions.push({
            key: 'filePath',
            match: { text: filters.fileExtension }
          });
        }
        
        if (mustConditions.length > 0) {
          filterParams.filter = {
            must: mustConditions
          };
        }
      }
      
      console.log('SearchDocumentationTool: Search filter built:', filterParams);
      
      const finalScoreThreshold = args.score_threshold !== undefined ? args.score_threshold : 0.65;
      console.log('SearchDocumentationTool: Calling qdrantClient.search with score_threshold:', finalScoreThreshold);
      // Optimize the search parameters for better results
      const searchResults = await this.apiClient.qdrantClient.search(COLLECTION_NAME, {
        vector: queryEmbedding,
        limit: limit * 2, // Get more results initially to filter
        with_payload: true,
        with_vector: false, // Optimize network transfer by not retrieving vectors
        score_threshold: finalScoreThreshold, // Use provided threshold or default
        ...filterParams, // Add any filters we constructed
        params: {
          hnsw_ef: 128, // Increase search accuracy (at cost of some performance)
          exact: false // Set to true for precise but slower search
        }
      });
      
      console.log(`SearchDocumentationTool: qdrantClient.search successful, found ${searchResults.length} results.`);

      console.log('SearchDocumentationTool: Sorting and slicing results...');
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
      console.log(`SearchDocumentationTool: Sorted and sliced results, keeping ${sortedResults.length} results.`);

      console.log('SearchDocumentationTool: Formatting results...');
      const formattedResults = sortedResults.map(result => {
        if (!isDocumentPayload(result.payload)) {
          console.error('SearchDocumentationTool: Invalid payload type encountered:', result.payload);
          throw new Error('Invalid payload type');
        }

        // Construct a result object for the frontend
        return {
          title: result.payload.title,
          url: result.payload.url,
          score: result.score, // Add the score here
          // Combine relevant information for the snippet/content
          content: `Score: ${result.score.toFixed(3)}${result.payload.symbol ? ` | Symbol: ${result.payload.symbol}` : ''}${result.payload.domain ? ` | Type: ${result.payload.domain}` : ''}${result.payload.lines && result.payload.lines[0] !== 0 ? ` | Lines: ${result.payload.lines[0]}-${result.payload.lines[1]}` : ''}\n${result.payload.text}`,
          snippet: result.payload.text, // Provide the text as a snippet
        };
      });

      console.log('SearchDocumentationTool: Results formatted. Returning response.');
      return this.formatJsonResponse({
        results: formattedResults.length > 0 ? formattedResults : [],
        message: formattedResults.length > 0 ? 'Search successful' : 'No results found matching the query.',
        filters: Object.keys(filters).length > 0 ? filters : undefined
      });
    } catch (error: any) {
      console.error('SearchDocumentationTool: Backend search error:', error);
      console.error('SearchDocumentationTool: Error details:', error);
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
