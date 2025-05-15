import { GetIndexingStatusEnhancedTool } from '../src/tools/get-indexing-status-enhanced';
import { IndexingStatusManager } from '../src/utils/indexing-status-manager';

// Mock the IndexingStatusManager
jest.mock('../src/utils/indexing-status-manager');

const MockIndexingStatusManager = IndexingStatusManager as jest.Mock<IndexingStatusManager>;

describe('GetIndexingStatusEnhancedTool', () => {
  let tool: GetIndexingStatusEnhancedTool;
  let mockStatusManager: jest.Mocked<IndexingStatusManager>;

  beforeEach(() => {
    // Create a new mock instance for each test
    MockIndexingStatusManager.mockClear();
    tool = new GetIndexingStatusEnhancedTool();
    // Get the mocked instance created inside the tool's constructor
    mockStatusManager = MockIndexingStatusManager.mock.instances[0] as jest.Mocked<IndexingStatusManager>;
    jest.clearAllMocks();
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
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
    });
  });

  it('should successfully get status for a specific repository', async () => {
    const now = new Date().toISOString();
    const mockStatus = {
      repositoryName: 'test-repo',
      status: 'processing' as const, // Use literal type
      startTime: now,
      lastUpdated: now, // Added lastUpdated
      percentageComplete: 50,
      totalFiles: 100,
      processedFiles: 50,
      skippedFiles: 0,
      totalChunks: 500,
      indexedChunks: 250,
      currentBatch: 5,
      totalBatches: 10,
    };
    mockStatusManager.getStatus.mockResolvedValue(mockStatus);

    const result = await tool.execute({ name: 'test-repo' });

    expect(mockStatusManager.getStatus).toHaveBeenCalledWith('test-repo');
    expect(mockStatusManager.getAllStatuses).not.toHaveBeenCalled();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Repository: test-repo');
    expect(result.content[0].text).toContain('Status: 🔄 Processing');
    expect(result.content[0].text).toContain('Progress: 50%');
    expect(result.content[0].text).toContain('Files: 50 processed, 0 skipped (of 100)');
    expect(result.content[0].text).toContain('Chunks: 250 indexed (of 500)');
    expect(result.content[0].text).toContain('Batch: 5 of 10');
  });

  it('should report no status found for a specific repository if getStatus returns null', async () => {
    mockStatusManager.getStatus.mockResolvedValue(null);

    const result = await tool.execute({ name: 'non-existent-repo' });

    expect(mockStatusManager.getStatus).toHaveBeenCalledWith('non-existent-repo');
    expect(mockStatusManager.getAllStatuses).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No indexing status found for repository: non-existent-repo' }],
      isError: false, // Assuming no status found is not an error
    });
  });

  it('should successfully get all statuses', async () => {
    const now = new Date().toISOString();
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();

    const mockStatuses = [
      {
        repositoryName: 'repo1',
        status: 'completed' as const, // Use literal type
        startTime: oneMinuteAgo,
        endTime: now,
        lastUpdated: now, // Added lastUpdated
        percentageComplete: 100,
        totalFiles: 50,
        processedFiles: 50,
        skippedFiles: 0,
        totalChunks: 200,
        indexedChunks: 200,
      },
      {
        repositoryName: 'repo2',
        status: 'failed' as const, // Use literal type
        startTime: twoMinutesAgo,
        endTime: oneMinuteAgo,
        lastUpdated: oneMinuteAgo, // Added lastUpdated
        percentageComplete: 10,
        error: 'Indexing failed',
      },
    ];
    mockStatusManager.getAllStatuses.mockResolvedValue(mockStatuses);

    const result = await tool.execute({});

    expect(mockStatusManager.getStatus).not.toHaveBeenCalled();
    expect(mockStatusManager.getAllStatuses).toHaveBeenCalledTimes(1);
    expect(result.content[0].type).toBe('text');
    const contentText = result.content[0].text;
    expect(contentText).toContain('Repository: repo1');
    expect(contentText).toContain('Status: ✅ Completed');
    expect(contentText).toContain('Duration: 1m 0s'); // Approximate duration
    expect(contentText).toContain('Repository: repo2');
    expect(contentText).toContain('Status: ❌ Failed');
    expect(contentText).toContain('Error: Indexing failed');
    expect(contentText).toContain('Duration: 1m 0s'); // Approximate duration
    expect(contentText).toContain('\n\n---\n\n'); // Separator between statuses
  });

  it('should report no indexing operations found if getAllStatuses returns empty array', async () => {
    mockStatusManager.getAllStatuses.mockResolvedValue([]);

    const result = await tool.execute({});

    expect(mockStatusManager.getStatus).not.toHaveBeenCalled();
    expect(mockStatusManager.getAllStatuses).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No repository indexing operations found.' }],
      isError: false, // Assuming no operations found is not an error
    });
  });

  it('should format pending status correctly', async () => {
    const now = new Date().toISOString();
    const mockStatus = {
      repositoryName: 'pending-repo',
      status: 'pending' as const, // Use literal type
      startTime: now,
      lastUpdated: now, // Added lastUpdated
    };
    mockStatusManager.getStatus.mockResolvedValue(mockStatus);

    const result = await tool.execute({ name: 'pending-repo' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Status: ⏳ Pending');
    expect(result.content[0].text).toContain('Duration: 0s'); // Approximate duration
    expect(result.content[0].text).not.toContain('Ended:');
  });

  it('should format completed status correctly', async () => {
    const now = new Date().toISOString();
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const mockStatus = {
      repositoryName: 'completed-repo',
      status: 'completed' as const, // Use literal type
      startTime: fiveSecondsAgo,
      endTime: now,
      lastUpdated: now, // Added lastUpdated
      percentageComplete: 100,
    };
    mockStatusManager.getStatus.mockResolvedValue(mockStatus);

    const result = await tool.execute({ name: 'completed-repo' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Status: ✅ Completed');
    expect(result.content[0].text).toContain('Duration: 5s'); // Approximate duration
    expect(result.content[0].text).toContain('Ended:');
  });

  it('should format failed status correctly', async () => {
    const now = new Date().toISOString();
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    const mockStatus = {
      repositoryName: 'failed-repo',
      status: 'failed' as const, // Use literal type
      startTime: tenSecondsAgo,
      endTime: now,
      lastUpdated: now, // Added lastUpdated
      percentageComplete: 20,
      error: 'Some error occurred',
    };
    mockStatusManager.getStatus.mockResolvedValue(mockStatus);

    const result = await tool.execute({ name: 'failed-repo' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Status: ❌ Failed');
    expect(result.content[0].text).toContain('Duration: 10s'); // Approximate duration
    expect(result.content[0].text).toContain('Ended:');
    expect(result.content[0].text).toContain('Error: Some error occurred');
  });

  it('should format processing status with file and chunk counts', async () => {
    const now = new Date().toISOString();
    const mockStatus = {
      repositoryName: 'processing-repo',
      status: 'processing' as const, // Use literal type
      startTime: now,
      lastUpdated: now, // Added lastUpdated
      percentageComplete: 75,
      totalFiles: 200,
      processedFiles: 150,
      skippedFiles: 10,
      totalChunks: 1000,
      indexedChunks: 750,
      currentBatch: 15,
      totalBatches: 20,
    };
    mockStatusManager.getStatus.mockResolvedValue(mockStatus);

    const result = await tool.execute({ name: 'processing-repo' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Status: 🔄 Processing');
    expect(result.content[0].text).toContain('Progress: 75%');
    expect(result.content[0].text).toContain('Files: 150 processed, 10 skipped (of 200)');
    expect(result.content[0].text).toContain('Chunks: 750 indexed (of 1000)');
    expect(result.content[0].text).toContain('Batch: 15 of 20');
  });
});
