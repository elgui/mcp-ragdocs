import { SearchDocumentationEnhancedTool } from '../src/tools/search-documentation-enhanced';
import { ApiClient } from '../src/api-client';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; // Ensure McpError and ErrorCode are imported
import { DocumentPayload } from '../src/types'; // Assuming DocumentPayload is the type for valid payloads

// Define mocks for ApiClient methods that will be used by the tool
let mockQdrantSearch: jest.Mock;
let mockGetEmbeddings: jest.Mock;

const COLLECTION_NAME = 'documentation'; // As defined in the tool

jest.mock('../src/api-client', () => {
  // Initialize mocks here because jest.mock is hoisted
  mockQdrantSearch = jest.fn();
  mockGetEmbeddings = jest.fn();
  return {
    ApiClient: jest.fn().mockImplementation(() => {
      return {
        getEmbeddings: mockGetEmbeddings,
        qdrantClient: {
          search: mockQdrantSearch,
        },
      };
    }),
  };
});

describe('SearchDocumentationEnhancedTool', () => {
  let mockApiClientInstance: jest.Mocked<ApiClient>;
  let searchTool: SearchDocumentationEnhancedTool;

  beforeEach(() => {
    // ApiClient is mocked via jest.mock, get a new instance for each test
    mockApiClientInstance = new ApiClient() as jest.Mocked<ApiClient>;

    // Reset mocks before each test to ensure test isolation
    mockGetEmbeddings.mockReset();
    mockQdrantSearch.mockReset();

    // Default mock implementations for successful calls
    mockGetEmbeddings.mockResolvedValue([0.1, 0.2, 0.3]); // Default mock embedding
    mockQdrantSearch.mockResolvedValue([]); // Default to empty search results

    searchTool = new SearchDocumentationEnhancedTool({
      apiClient: mockApiClientInstance,
    });
  });

  test('should have correct definition', () => {
    const definition = searchTool.definition;
    expect(definition.name).toBe('search_documentation');
    expect(definition.description).toBe('Search through stored documentation using natural language queries');
    expect(definition.inputSchema.type).toBe('object');
    expect(definition.inputSchema.properties).toHaveProperty('query');
    expect(definition.inputSchema.properties).toHaveProperty('limit');
    expect(definition.inputSchema.required).toEqual(['query']);
  });

  test('should return error if query is not provided', async () => {
    const args = { limit: 5 }; // Missing query
    await expect(searchTool.execute(args)).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Query is required')
    );
  });

  test('should return error if query is not a string', async () => {
    const args = { query: 123 }; // Invalid query type
    await expect(searchTool.execute(args)).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Query is required')
    );
  });
  
  test('should return error if apiClient is not provided during execution (if tool allows it)', async () => {
    // This test assumes the tool might be instantiated without an apiClient
    // and then checks for it during execute.
    // If the constructor enforces apiClient, this test needs adjustment or removal.
    const toolWithoutClient = new SearchDocumentationEnhancedTool({}); // No apiClient
    const args = { query: 'test' };
    await expect(toolWithoutClient.execute(args)).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'API client is required for search')
    );
  });

  test('should call getEmbeddings and qdrantClient.search with correct arguments', async () => {
    const query = 'test query';
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockQdrantSearch.mockResolvedValue([
      { id: '1', score: 0.9, payload: { title: 'Doc 1', url: 'url1', text: 'Content 1', domain: 'docs', symbol: 'sym1', lines: [1,10] } as DocumentPayload, vector: [] },
    ]);

    const args = { query };
    await searchTool.execute(args);

    expect(mockGetEmbeddings).toHaveBeenCalledWith(query);
    expect(mockQdrantSearch).toHaveBeenCalledWith(
      COLLECTION_NAME,
      expect.objectContaining({
        vector: mockEmbedding,
        limit: 5 * 2, // Default limit is 5, tool fetches 2x
        with_payload: true,
        with_vector: false,
        score_threshold: 0.7,
      })
    );
  });

  test('should handle limit argument correctly', async () => {
    const query = 'test query';
    const limit = 3;
    const mockEmbedding = [0.1, 0.2];
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockQdrantSearch.mockResolvedValue([]); // Not testing results here, just call params

    const args = { query, limit };
    await searchTool.execute(args);

    expect(mockQdrantSearch).toHaveBeenCalledWith(
      COLLECTION_NAME,
      expect.objectContaining({
        limit: limit * 2, // Tool fetches 2x the requested limit
      })
    );
  });

  test('should handle empty search results from qdrant', async () => {
    mockQdrantSearch.mockResolvedValue([]); // Qdrant returns no results
    const query = 'empty search';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBeUndefined(); // Or `toBe(false)` if explicitly set
    expect(result.content[0].type).toBe('json');
    const jsonResponse = result.content[0].json;
    expect(jsonResponse.results).toEqual([]);
    expect(jsonResponse.message).toBe('No results found matching the query.');
  });

  test('should sort and format results correctly', async () => {
    const mockResults = [
      { id: '1', score: 0.8, payload: { title: 'Code Snippet 1', url: 'file.ts', text: 'code text', symbol: 'funcA', lines: [5,10] } as DocumentPayload, vector: [] },
      { id: '2', score: 0.9, payload: { title: 'Documentation Page 1', url: 'docs.md', text: 'doc text', domain: 'docs' } as DocumentPayload, vector: [] },
      { id: '3', score: 0.85, payload: { title: 'Documentation Page 2', url: 'another.md', text: 'more doc text', domain: 'docs' } as DocumentPayload, vector: [] },
    ];
    mockQdrantSearch.mockResolvedValue(mockResults);

    const query = 'find stuff';
    const args = { query, limit: 2 }; // Limit to 2 to test slicing after sort
    const result = await searchTool.execute(args);
    
    const jsonResponse = result.content[0].json;
    expect(jsonResponse.results).toHaveLength(2);
    // Doc 2 (score 0.9, domain docs) should be first
    expect(jsonResponse.results[0].title).toBe('Documentation Page 1');
    expect(jsonResponse.results[0].content).toContain('Score: 0.900');
    expect(jsonResponse.results[0].content).toContain('Type: docs');
    // Doc 3 (score 0.85, domain docs) should be second
    expect(jsonResponse.results[1].title).toBe('Documentation Page 2');
    expect(jsonResponse.results[1].content).toContain('Score: 0.850');
    expect(jsonResponse.results[1].content).toContain('Type: docs');
    // Code Snippet 1 should be filtered out by limit or sorted after docs
  });

  test('should handle errors from getEmbeddings', async () => {
    const errorMessage = 'Embedding generation failed';
    mockGetEmbeddings.mockRejectedValue(new Error(errorMessage));
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('json');
    const jsonResponse = result.content[0].json;
    expect(jsonResponse.results).toEqual([]);
    expect(jsonResponse.message).toBe(`Search failed: ${errorMessage}`);
  });

  test('should handle McpError from getEmbeddings', async () => {
    const mcpError = new McpError(ErrorCode.InternalError, 'Embedding service MCP error'); // Changed to InternalError
    mockGetEmbeddings.mockRejectedValue(mcpError);
    const query = 'test query';
    const args = { query };
    
    await expect(searchTool.execute(args)).rejects.toThrow(mcpError);
  });

  test('should handle errors from qdrantClient.search', async () => {
    const errorMessage = 'Qdrant search operation failed';
    mockQdrantSearch.mockRejectedValue(new Error(errorMessage));
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('json');
    const jsonResponse = result.content[0].json;
    expect(jsonResponse.results).toEqual([]);
    expect(jsonResponse.message).toBe(`Search failed: ${errorMessage}`);
  });
  
  test('should handle McpError from qdrantClient.search', async () => {
    const mcpError = new McpError(ErrorCode.InternalError, 'Qdrant MCP error'); // Changed to InternalError
    mockQdrantSearch.mockRejectedValue(mcpError);
    const query = 'test query';
    const args = { query };

    await expect(searchTool.execute(args)).rejects.toThrow(mcpError);
  });

  // Tests for unexpected search result structures
  test('should handle qdrantClient.search returning null', async () => {
    mockQdrantSearch.mockResolvedValue(null as any); // Simulate null response
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain("Cannot read properties of null (reading 'sort')");
  });

  test('should handle qdrantClient.search returning undefined', async () => {
    mockQdrantSearch.mockResolvedValue(undefined as any); // Simulate undefined response
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);
    
    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain("Cannot read properties of undefined (reading 'sort')");
  });

  test('should handle qdrantClient.search results with null payload', async () => {
    mockQdrantSearch.mockResolvedValue([{ id: '1', score: 0.9, payload: null, vector: [] }] as any);
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain('Search failed: Invalid payload type');
  });

  test('should handle qdrantClient.search results with invalid payload structure (missing text)', async () => {
    // The isDocumentPayload checks for 'text', 'title', 'url'.
    // If 'text' is missing, it should be caught.
    const mockInvalidPayload = { title: 'Doc Title', url: 'doc/url' }; // Missing 'text'
    mockQdrantSearch.mockResolvedValue([{ id: '1', score: 0.9, payload: mockInvalidPayload, vector: [] }] as any);
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain('Search failed: Invalid payload type');
  });
  
  test('should handle qdrantClient.search results with payload missing title', async () => {
    const mockInvalidPayload = { text: 'Doc text', url: 'doc/url' }; // Missing 'title'
    mockQdrantSearch.mockResolvedValue([{ id: '1', score: 0.9, payload: mockInvalidPayload, vector: [] }] as any);
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain('Search failed: Invalid payload type');
  });

  test('should handle qdrantClient.search results with payload missing url', async () => {
    const mockInvalidPayload = { text: 'Doc text', title: 'Doc title' }; // Missing 'url'
    mockQdrantSearch.mockResolvedValue([{ id: '1', score: 0.9, payload: mockInvalidPayload, vector: [] }] as any);
    const query = 'test query';
    const args = { query };
    const result = await searchTool.execute(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].json.message).toContain('Search failed: Invalid payload type');
  });
});
