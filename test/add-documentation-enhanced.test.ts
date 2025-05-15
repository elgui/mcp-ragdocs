import { AddDocumentationEnhancedTool } from '../src/tools/add-documentation-enhanced';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Mock the ApiClient and its dependencies
const mockGetEmbeddings = jest.fn();
const mockUpsert = jest.fn();
const mockPageContent = jest.fn();
const mockPageGoto = jest.fn();
const mockPageClose = jest.fn();
const mockBrowserNewPage = jest.fn().mockResolvedValue({
  goto: mockPageGoto,
  content: mockPageContent,
  close: mockPageClose,
});

const mockApiClient = {
  getEmbeddings: mockGetEmbeddings,
  qdrantClient: {
    upsert: mockUpsert,
  },
  browser: {
    newPage: mockBrowserNewPage,
  },
};

describe('AddDocumentationEnhancedTool', () => {
  let tool: AddDocumentationEnhancedTool;

  beforeEach(() => {
    tool = new AddDocumentationEnhancedTool();
    // Manually set the mocked apiClient
    (tool as any).apiClient = mockApiClient;
    jest.clearAllMocks();
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'add_documentation',
      description: 'Adds documentation from a given URL to the knowledge base.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the documentation to add.',
          },
        },
        required: ['url'],
      },
    });
  });

  it('should throw InvalidParams error if URL is missing', async () => {
    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'URL is required')
    );
  });

  it('should throw McpError with InternalError if browser is not initialized', async () => {
    // Temporarily remove the browser from the mockApiClient
    const originalBrowser = mockApiClient.browser;
    delete (mockApiClient as any).browser;

    await expect(tool.execute({ url: 'http://example.com' })).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'Browser is not initialized for AddDocumentationEnhancedTool')
    );

    // Restore the browser
    (mockApiClient as any).browser = originalBrowser;
  });

  it('should throw McpError with InternalError if page.goto fails', async () => {
    const testUrl = 'http://example.com/docs';
    const mockError = new Error('Navigation failed');
    mockPageGoto.mockRejectedValue(mockError);

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(
      new McpError(ErrorCode.InternalError, `Failed to fetch URL ${testUrl}: ${mockError}`)
    );

    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageClose).toHaveBeenCalledTimes(1);
  });

  it('should throw McpError with InternalError if page.content fails', async () => {
    const testUrl = 'http://example.com/docs';
    const mockError = new Error('Failed to get content');
    mockPageContent.mockRejectedValue(mockError);
    mockPageGoto.mockResolvedValue(undefined); // Ensure goto succeeds

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(
      new McpError(ErrorCode.InternalError, `Failed to fetch URL ${testUrl}: ${mockError}`)
    );

    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
  });


  it('should successfully add documentation', async () => {
    const testUrl = 'http://example.com/docs';
    const mockHtmlContent = `
      <html>
        <head><title>Test Documentation</title></head>
        <body>
          <main>
            <h1>Documentation Title</h1>
            <p>This is some test documentation content.</p>
            <p>It has multiple paragraphs to be chunked.</p>
          </main>
        </body>
      </html>
    `;
    const mockEmbedding = [0.1, 0.2, 0.3];

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockUpsert.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ url: testUrl });

    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);

    // Expect getEmbeddings to be called for each chunk
    // The chunking logic splits the text into chunks of ~1000 characters
    // Based on the mockHtmlContent, there should be at least one chunk
    expect(mockGetEmbeddings).toHaveBeenCalled();

    // Expect upsert to be called with the correct collection name and points
    expect(mockUpsert).toHaveBeenCalledWith('documentation', expect.objectContaining({
      wait: true,
      points: expect.any(Array),
    }));

    // Check the structure of the points being upserted
    const upsertCall = mockUpsert.mock.calls[0][1];
    expect(upsertCall.points.length).toBeGreaterThan(0);
    expect(upsertCall.points[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      vector: mockEmbedding,
      payload: expect.objectContaining({
        text: expect.any(String),
        url: testUrl,
        title: 'Test Documentation',
        timestamp: expect.any(String),
        _type: 'DocumentChunk',
      }),
    }));

    expect(result).toEqual({
      type: 'text',
      content: expect.stringContaining(`Successfully added documentation from ${testUrl}`),
    });
  });

  it('should throw McpError with InvalidRequest if Qdrant upsert fails with unauthorized error', async () => {
    const testUrl = 'http://example.com/docs';
    const mockHtmlContent = `<html><body><p>content</p></body></html>`;
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockQdrantError = new Error('unauthorized');

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockUpsert.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(
      new McpError(ErrorCode.InvalidRequest, 'Failed to authenticate with Qdrant cloud while adding documents')
    );

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('should throw McpError with InternalError if Qdrant upsert fails with connection refused error', async () => {
    const testUrl = 'http://example.com/docs';
    const mockHtmlContent = `<html><body><p>content</p></body></html>`;
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockQdrantError = new Error('ECONNREFUSED');

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockUpsert.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'Connection to Qdrant cloud failed while adding documents')
    );

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('should throw McpError with InternalError if Qdrant upsert fails with timeout error', async () => {
    const testUrl = 'http://example.com/docs';
    const mockHtmlContent = `<html><body><p>content</p></body></html>`;
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockQdrantError = new Error('ETIMEDOUT');

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockUpsert.mockRejectedValue(mockQdrantError);

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(
      new McpError(ErrorCode.InternalError, 'Connection to Qdrant cloud failed while adding documents')
    );

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('should re-throw non-McpError from Qdrant upsert', async () => {
    const testUrl = 'http://example.com/docs';
    const mockHtmlContent = `<html><body><p>content</p></body></html>`;
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockOtherError = new Error('Some other Qdrant error');

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue(mockEmbedding);
    mockUpsert.mockRejectedValue(mockOtherError);

    await expect(tool.execute({ url: testUrl })).rejects.toThrow(mockOtherError);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('should successfully handle empty content', async () => {
    const testUrl = 'http://example.com/empty';
    const mockHtmlContent = `
      <html>
        <head><title>Empty Page</title></head>
        <body>
          <script>console.log('hi')</script>
          <style>body { color: red; }</style>
          <!-- comment -->
        </body>
      </html>
    `;

    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockGetEmbeddings.mockResolvedValue([]); // Should not be called for empty content
    mockUpsert.mockResolvedValue({ status: 'ok' }); // Should not be called for empty content

    const result = await tool.execute({ url: testUrl });

    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockGetEmbeddings).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    expect(result).toEqual({
      type: 'text',
      content: expect.stringContaining(`Successfully added documentation from ${testUrl} (0 chunks processed in 0 batches)`),
    });
  });

  // Add more test cases for different content structures, chunking logic, etc.
});
