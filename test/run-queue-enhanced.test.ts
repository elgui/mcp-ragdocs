import { RunQueueEnhancedTool } from '../src/tools/run-queue-enhanced';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { IndexingStatusManager } from '../src/utils/indexing-status-manager.js';

// Declare mock variables here so they can be accessed in module factories and tests
let mockApiClient: any;
let mockServer: any;

// Mock internal dependencies using module factories
jest.mock('../src/utils/indexing-status-manager.js', () => {
  return {
    IndexingStatusManager: jest.fn().mockImplementation(() => ({
      createStatus: jest.fn(),
      updateStatus: jest.fn(),
      completeStatus: jest.fn(),
      getStatus: jest.fn(),
      getAllStatuses: jest.fn(),
      deleteStatus: jest.fn(),
      // Public properties/methods used by the tool
      statusFilePath: '/mock/status.json',
      ensureStatusDirectory: jest.fn(),
      saveStatus: jest.fn(),
    })),
  };
});

// Mock utility functions/classes
const MockIndexingStatusManager = IndexingStatusManager as jest.Mock;

describe('RunQueueEnhancedTool', () => {
  let tool: RunQueueEnhancedTool;
  let mockStatusManagerInstance: any;

  beforeEach(async () => {
    // Initialize mockApiClient and mockServer here
    mockApiClient = {
      // Add any API client mocks needed for RunQueueEnhancedTool
    };
    mockServer = {
      sendProgress: jest.fn(),
    };

    // Reset mocks
    jest.clearAllMocks();
    MockIndexingStatusManager.mockClear();

    // Get the mock instances created by the factories
    mockStatusManagerInstance = new MockIndexingStatusManager();

    // Instantiate the tool with mocks
    tool = new RunQueueEnhancedTool({ apiClient: mockApiClient, server: mockServer });
  });

  it('should successfully run an empty queue', async () => {
    mockStatusManagerInstance.getAllStatuses.mockResolvedValue([]);

    const result = await tool.execute({});

    expect(mockStatusManagerInstance.getAllStatuses).toHaveBeenCalled();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Indexing queue is empty.');
  });

  it('should successfully run a queue with one or more tasks', async () => {
    const mockTasks = [
      { id: 'task1', type: 'local-repository', status: 'pending', repositoryName: 'repo1' },
      { id: 'task2', type: 'extract-urls', status: 'pending', urls: ['url1'] },
    ];

    mockStatusManagerInstance.getAllStatuses.mockResolvedValue(mockTasks);
    // Mock the internal processTask method or equivalent logic
    // For simplicity, we'll directly mock the status updates that processTask would trigger
    mockStatusManagerInstance.updateStatus.mockResolvedValue(undefined);
    mockStatusManagerInstance.completeStatus.mockResolvedValue(undefined);

    const result = await tool.execute({});

    expect(mockStatusManagerInstance.getAllStatuses).toHaveBeenCalled();
    // Expect status updates for each task
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task1', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task1', true, expect.any(Object));
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task2', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task2', true, expect.any(Object));

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Finished processing indexing queue.');
  });

  it('should return an error response if getting the queue fails', async () => {
    const mockError = new Error('Failed to get queue');
    mockStatusManagerInstance.getAllStatuses.mockRejectedValue(mockError);

    const result = await tool.execute({});

    expect(mockStatusManagerInstance.getAllStatuses).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Failed to run queue: ${mockError.message}`);
  });

  it('should handle errors when processing a specific task and continue with others', async () => {
    const mockTasks = [
      { id: 'task1', type: 'local-repository', status: 'pending', repositoryName: 'repo1' },
      { id: 'task2', type: 'extract-urls', status: 'pending', urls: ['url1'] }, // This task will fail
      { id: 'task3', type: 'local-repository', status: 'pending', repositoryName: 'repo2' },
    ];

    mockStatusManagerInstance.getAllStatuses.mockResolvedValue(mockTasks);
    // Mock status updates to simulate task processing, including a failure for task2
    mockStatusManagerInstance.updateStatus.mockImplementation(async (taskId, status) => {
      if (taskId === 'task2' && status === 'indexing') {
        // Simulate an error during task2 processing
        await mockStatusManagerInstance.completeStatus(taskId, false, { error: 'Simulated task failure' });
        throw new Error('Simulated task failure'); // Throw to potentially test error handling in the loop
      } else {
        // Simulate successful update
        return Promise.resolve(undefined);
      }
    });
    mockStatusManagerInstance.completeStatus.mockResolvedValue(undefined);


    const result = await tool.execute({});

    expect(mockStatusManagerInstance.getAllStatuses).toHaveBeenCalled();
    // Expect status updates for all tasks, with task2 marked as failed
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task1', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task1', true, expect.any(Object));
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task2', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task2', false, { error: 'Simulated task failure' });
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task3', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task3', true, expect.any(Object));


    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Finished processing indexing queue.');
    // Optionally, check for a message indicating some tasks failed
    // This depends on how the tool reports partial failures
  });

  it('should handle invalid task types in the queue', async () => {
    const mockTasks = [
      { id: 'task1', type: 'local-repository', status: 'pending', repositoryName: 'repo1' },
      { id: 'task2', type: 'invalid-type' as any, status: 'pending' }, // Invalid task type
      { id: 'task3', type: 'extract-urls', status: 'pending', urls: ['url1'] },
    ];

    mockStatusManagerInstance.getAllStatuses.mockResolvedValue(mockTasks);
    // Mock status updates to simulate task processing, including marking the invalid task as failed
    mockStatusManagerInstance.updateStatus.mockResolvedValue(undefined);
    mockStatusManagerInstance.completeStatus.mockResolvedValue(undefined);


    const result = await tool.execute({});

    expect(mockStatusManagerInstance.getAllStatuses).toHaveBeenCalled();
    // Expect status updates for all tasks, with task2 marked as failed due to invalid type
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task1', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task1', true, expect.any(Object));
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task2', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task2', false, { error: 'Unknown task type: invalid-type' });
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalledWith('task3', 'indexing');
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith('task3', true, expect.any(Object));


    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Finished processing indexing queue.');
    // Optionally, check for a message indicating invalid tasks were encountered
  });

  // Add test cases here
});
