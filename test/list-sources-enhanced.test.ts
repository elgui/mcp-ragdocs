import { ListSourcesEnhancedTool } from '../src/tools/list-sources-enhanced';
import { McpToolResponse } from '../src/types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Mock the ApiClient and its dependencies
const mockInitCollection = jest.fn().mockResolvedValue(undefined);
const mockScroll = jest.fn();

const mockApiClient = {
  initCollection: mockInitCollection,
  qdrantClient: {
    scroll: mockScroll,
  },
};

describe('ListSourcesEnhancedTool', () => {
  let tool: ListSourcesEnhancedTool;

  beforeEach(() => {
    tool = new ListSourcesEnhancedTool();
    // Manually set the mocked apiClient
    (tool as any).apiClient = mockApiClient;
    jest.clearAllMocks();
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'list_sources',
      description: 'List all documentation sources currently stored in the system',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Format to return results in (grouped or flat)',
            default: 'grouped',
            enum: ['grouped', 'flat'],
          },
        },
        required: [],
      },
    });
  });

  it('should successfully list sources in grouped format', async () => {
    const mockQdrantResponse = {
      points: [
        { id: '1', payload: { title: 'Doc A', url: 'http://example.com/docs/a/page1.html' } },
        { id: '2', payload: { title: 'Doc B', url: 'http://example.com/docs/a/page2.html' } },
        { id: '3', payload: { title: 'Doc C', url: 'http://other.com/guide/page1.html' } },
        { id: '4', payload: { title: 'Doc D', url: 'http://example.com/docs/b/page1.html' } },
        { id: '5', payload: { title: 'Doc E', url: 'http://other.com/guide/page2.html' } },
        { id: '6', payload: { title: 'Doc F', url: 'http://example.com/docs/a/page1.html' } }, // Duplicate URL
      ],
      next_page_offset: null,
    };
    mockScroll.mockResolvedValue(mockQdrantResponse);

    const result = await tool.execute({});

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledWith('documentation', {
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset: null,
    });
    expect(result.content[0].type).toBe('text');
    const contentText = result.content[0].text;

    expect(contentText).toContain('1. example.com');
    expect(contentText).toContain('1.1. Doc A (http://example.com/docs/a/page1.html)');
    expect(contentText).toContain('1.2. Doc B (http://example.com/docs/a/page2.html)');
    expect(contentText).toContain('1.3. Doc D (http://example.com/docs/b/page1.html)'); // Sorted by title
    expect(contentText).toContain('2. other.com');
    expect(contentText).toContain('2.1. Doc C (http://other.com/guide/page1.html)');
    expect(contentText).toContain('2.2. Doc E (http://other.com/guide/page2.html)'); // Sorted by title
    expect(contentText).not.toContain('Doc F'); // Duplicate should be removed
  });

  it('should successfully list sources in flat format', async () => {
    const mockQdrantResponse = {
      points: [
        { id: '1', payload: { title: 'Doc A', url: 'http://example.com/docs/a/page1.html' } },
        { id: '2', payload: { title: 'Doc B', url: 'http://other.com/guide/page1.html' } },
      ],
      next_page_offset: null,
    };
    mockScroll.mockResolvedValue(mockQdrantResponse);

    const result = await tool.execute({ format: 'flat' });

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledWith('documentation', {
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset: null,
    });
    expect(result.content[0].type).toBe('text');
    const contentText = result.content[0].text;

    expect(contentText).toBe('Doc A (http://example.com/docs/a/page1.html)\nDoc B (http://other.com/guide/page1.html)');
  });

  it('should report no documentation sources found if Qdrant returns no points', async () => {
    const mockQdrantResponse = {
      points: [],
      next_page_offset: null,
    };
    mockScroll.mockResolvedValue(mockQdrantResponse);

    const result = await tool.execute({});

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledWith('documentation', {
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset: null,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No documentation sources found.' }],
      isError: false,
    });
  });

  it('should handle pagination when retrieving sources', async () => {
    const mockQdrantResponsePage1 = {
      points: Array.from({ length: 100 }).map((_, i) => ({
        id: `id${i}`,
        payload: { title: `Doc ${i}`, url: `http://example.com/page${i}.html` },
      })),
      next_page_offset: 'id99',
    };
    const mockQdrantResponsePage2 = {
      points: [
        { id: 'id100', payload: { title: 'Doc 100', url: 'http://example.com/page100.html' } },
      ],
      next_page_offset: null,
    };

    mockScroll.mockResolvedValueOnce(mockQdrantResponsePage1);
    mockScroll.mockResolvedValueOnce(mockQdrantResponsePage2);

    const result = await tool.execute({});

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledWith('documentation', {
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset: null,
    });
    expect(mockScroll).toHaveBeenCalledWith('documentation', {
      with_payload: true,
      with_vector: false,
      limit: 100,
      offset: 'id99',
    });
    expect(mockScroll).toHaveBeenCalledTimes(2);

    expect(result.content[0].type).toBe('text');
    const contentText = result.content[0].text;
    expect(contentText).toContain('1. example.com');
    expect(contentText).toContain('1.1. Doc 0 (http://example.com/page0.html)');
    expect(contentText).toContain('1.101. Doc 100 (http://example.com/page100.html)'); // Check for content from the second page
  });

  it('should handle invalid URLs in source data', async () => {
    const mockQdrantResponse = {
      points: [
        { id: '1', payload: { title: 'Valid Doc', url: 'http://example.com/page.html' } },
        { id: '2', payload: { title: 'Invalid Doc', url: 'invalid-url' } }, // Invalid URL
      ],
      next_page_offset: null,
    };
    mockScroll.mockResolvedValue(mockQdrantResponse);

    const result = await tool.execute({});

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledTimes(1);
    expect(result.content[0].type).toBe('text');
    const contentText = result.content[0].text;

    expect(contentText).toContain('1. example.com');
    expect(contentText).toContain('1.1. Valid Doc (http://example.com/page.html)');
    expect(contentText).not.toContain('Invalid Doc'); // Invalid URL should be skipped
  });

  it('should throw McpError with InvalidRequest if Qdrant scroll fails with unauthorized error', async () => {
    const mockQdrantError = new Error('unauthorized');
    mockScroll.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InvalidRequest, 'Failed to authenticate with Qdrant cloud while listing sources')
    );

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledTimes(1);
  });

  it('should throw McpError with InternalError if Qdrant scroll fails with connection refused error', async () => {
    const mockQdrantError = new Error('ECONNREFUSED');
    mockScroll.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'Connection to Qdrant cloud failed while listing sources')
    );

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledTimes(1);
  });

  it('should throw McpError with InternalError if Qdrant scroll fails with timeout error', async () => {
    const mockQdrantError = new Error('ETIMEDOUT');
    mockScroll.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'Connection to Qdrant cloud failed while listing sources')
    );

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledTimes(1);
  });

  it('should handle other errors during Qdrant interaction', async () => {
    const mockOtherError = new Error('Some other Qdrant error');
    mockScroll.mockRejectedValue(mockOtherError);

    const result = await tool.execute({});

    expect(mockInitCollection).toHaveBeenCalledWith('documentation');
    expect(mockScroll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Failed to list sources. Check logs for details.' }],
      isError: true,
    });
  });
});
