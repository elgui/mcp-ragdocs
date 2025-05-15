import { RemoveDocumentationEnhancedTool } from '../src/tools/remove-documentation-enhanced';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { RepositoryConfigLoader } from '../src/utils/repository-config-loader.js';
import { IndexingStatusManager } from '../src/utils/indexing-status-manager.js';
import { getFileMetadataManager, FileMetadataManager } from '../src/utils/file-metadata-manager.js';

// Mock external dependencies
jest.mock('fs/promises');
jest.mock('path');

// Declare mock variables here so they can be accessed in module factories and tests
let mockApiClient: any;
let mockServer: any;

// Mock internal dependencies using module factories
jest.mock('../src/utils/repository-config-loader.js', () => {
  return {
    RepositoryConfigLoader: jest.fn().mockImplementation(() => ({
      loadRepositories: jest.fn(),
      updateConfigFile: jest.fn(),
      addRepositoryToConfig: jest.fn(),
      removeRepositoryFromConfig: jest.fn(),
      // Public properties/methods used by the tool
      server: mockServer, // Use the variable from the outer scope
      apiClient: mockApiClient, // Use the variable from the outer scope
      updateHandler: jest.fn(),
      addHandler: jest.fn(),
      watchHandler: jest.fn(),
    })),
  };
});

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

jest.mock('../src/utils/file-metadata-manager.js', () => {
  return {
    getFileMetadataManager: jest.fn().mockResolvedValue({
      initialize: jest.fn(),
      getRepositoryMetadata: jest.fn(),
      getFileMetadata: jest.fn(),
      setFileMetadata: jest.fn(),
      removeFileMetadata: jest.fn(),
      getAllMetadata: jest.fn(),
      removeRepositoryMetadata: jest.fn(),
      // Public properties/methods used by the tool
      metadata: {},
      metadataFilePath: '/mock/metadata.json',
      saveMetadata: jest.fn(),
    }),
    FileMetadataManager: jest.fn(), // Keep the class mock for type hinting if needed elsewhere
  };
});

// Mock utility functions/classes
const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const MockRepositoryConfigLoader = RepositoryConfigLoader as jest.Mock;
const MockIndexingStatusManager = IndexingStatusManager as jest.Mock;
const mockGetFileMetadataManager = getFileMetadataManager as jest.Mock;

// Mock implementations for path functions
mockPath.resolve.mockImplementation((p) => p);
mockPath.join.mockImplementation((...args) => args.join('/'));


describe('RemoveDocumentationEnhancedTool', () => {
  let tool: RemoveDocumentationEnhancedTool;
  let mockStatusManagerInstance: any;
  let mockFileMetadataManagerInstance: any;
  let mockRepositoryConfigLoaderInstance: any;

  beforeEach(async () => {
    // Initialize mockApiClient and mockServer here
    mockApiClient = {
      qdrantClient: {
        delete: jest.fn(),
      },
    };
    mockServer = {
      sendProgress: jest.fn(),
    };

    // Reset mocks
    jest.clearAllMocks();
    MockIndexingStatusManager.mockClear();
    mockGetFileMetadataManager.mockClear();
    MockRepositoryConfigLoader.mockClear();

    // Get the mock instances created by the factories
    mockStatusManagerInstance = new MockIndexingStatusManager();
    mockFileMetadataManagerInstance = await mockGetFileMetadataManager();
    mockRepositoryConfigLoaderInstance = new MockRepositoryConfigLoader();


    // Instantiate the tool with mocks
    tool = new RemoveDocumentationEnhancedTool({ apiClient: mockApiClient, server: mockServer });
  });

  it('should successfully remove documentation for specified URLs', async () => {
    const urlsToRemove = ['http://example.com/file1.md', 'file:///path/to/repo/src/file2.js'];
    const mockMetadata = {
      'repo1': {
        files: {
          'file1.md': { url: 'http://example.com/file1.md', hash: 'hash1', mtime: 123 },
        },
      },
      'repo2': {
        files: {
          'src/file2.js': { url: 'file:///path/to/repo/src/file2.js', hash: 'hash2', mtime: 456 },
          'file3.txt': { url: 'file:///path/to/repo/file3.txt', hash: 'hash3', mtime: 789 },
        },
      },
    };

    mockGetFileMetadataManager().getAllMetadata.mockResolvedValue(mockMetadata);
    mockGetFileMetadataManager().removeFileMetadata.mockResolvedValue(undefined); // Mock this as it will be called for each file

    mockApiClient.qdrantClient.delete.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ urls: urlsToRemove });

    expect(mockGetFileMetadataManager().getAllMetadata).toHaveBeenCalled();
    expect(mockApiClient.qdrantClient.delete).toHaveBeenCalledWith('documentation', {
      filter: {
        should: urlsToRemove.map(url => ({
            key: 'url',
            match: { value: url }
        }))
      },
      wait: true
    });
    expect(mockGetFileMetadataManager().removeFileMetadata).toHaveBeenCalledTimes(urlsToRemove.length);
    expect(mockGetFileMetadataManager().removeFileMetadata).toHaveBeenCalledWith('repo1', 'file1.md');
    expect(mockGetFileMetadataManager().removeFileMetadata).toHaveBeenCalledWith('repo2', 'src/file2.js');

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully removed documentation from ${urlsToRemove.length} sources: ${urlsToRemove.join(', ')}`);
  });

  it('should throw InvalidParams error if urls parameter is missing', async () => {
    await expect(tool.execute({} as any)).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'At least one URL is required')
    );
  });

  it('should throw InvalidParams error if urls array is empty', async () => {
    await expect(tool.execute({ urls: [] })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'At least one URL is required')
    );
  });

  it('should throw InvalidParams error if urls array contains non-string values', async () => {
    await expect(tool.execute({ urls: ['url1', 123 as any, 'url3'] })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'All URLs must be strings')
    );
  });

  it('should return an error response if Qdrant deletion fails', async () => {
    const urlsToRemove = ['http://example.com/file1.md'];
    const mockError = new Error('Qdrant deletion failed');

    mockApiClient.qdrantClient.delete.mockRejectedValue(mockError);

    const result = await tool.execute({ urls: urlsToRemove });

    expect(mockApiClient.qdrantClient.delete).toHaveBeenCalledWith('documentation', {
      filter: {
        should: urlsToRemove.map(url => ({
            key: 'url',
            match: { value: url }
        }))
      },
      wait: true
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Failed to remove documentation: ${mockError.message}`);
  });

  // Add test cases here
});
