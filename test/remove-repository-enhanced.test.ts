import { RemoveRepositoryEnhancedTool } from '../src/tools/remove-repository-enhanced';
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


describe('RemoveRepositoryEnhancedTool', () => {
  let tool: RemoveRepositoryEnhancedTool;
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
    tool = new RemoveRepositoryEnhancedTool({ apiClient: mockApiClient, server: mockServer });
  });

  it('should successfully remove a repository', async () => {
    const repoName = 'test-repo';

    mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig.mockResolvedValue(undefined);
    mockFileMetadataManagerInstance.removeRepositoryMetadata.mockResolvedValue(undefined);
    mockApiClient.qdrantClient.delete.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ name: repoName });

    expect(mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig).toHaveBeenCalledWith(repoName);
    expect(mockFileMetadataManagerInstance.removeRepositoryMetadata).toHaveBeenCalledWith(repoName);
    expect(mockApiClient.qdrantClient.delete).toHaveBeenCalledWith('documentation', {
      filter: {
        must: [{
          key: 'repository',
          match: {
            value: repoName,
          },
        }],
      },
    });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully removed repository: ${repoName}`);
  });

  it('should throw InvalidParams error if name parameter is missing', async () => {
    await expect(tool.execute({} as any)).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Repository name is required')
    );
  });

  it('should throw InvalidParams error if repository name does not exist in config', async () => {
    const repoName = 'non-existent-repo';
    const mockError = new Error(`Repository "${repoName}" not found in configuration.`);

    mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig.mockRejectedValue(mockError);

    await expect(tool.execute({ name: repoName })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, mockError.message)
    );
    expect(mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig).toHaveBeenCalledWith(repoName);
    // Ensure subsequent calls are not made
    expect(mockFileMetadataManagerInstance.removeRepositoryMetadata).not.toHaveBeenCalled();
    expect(mockApiClient.qdrantClient.delete).not.toHaveBeenCalled();
  });

  it('should return an error response if Qdrant deletion fails', async () => {
    const repoName = 'test-repo';
    const mockError = new Error('Qdrant deletion failed');

    mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig.mockResolvedValue(undefined);
    mockFileMetadataManagerInstance.removeRepositoryMetadata.mockResolvedValue(undefined);
    mockApiClient.qdrantClient.delete.mockRejectedValue(mockError);

    const result = await tool.execute({ name: repoName });

    expect(mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig).toHaveBeenCalledWith(repoName);
    expect(mockFileMetadataManagerInstance.removeRepositoryMetadata).toHaveBeenCalledWith(repoName);
    expect(mockApiClient.qdrantClient.delete).toHaveBeenCalledWith('documentation', {
      filter: {
        must: [{
          key: 'repository',
          match: {
            value: repoName,
          },
        }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Failed to remove repository: ${mockError.message}`);
  });

  it('should return an error response if removing repository from config fails', async () => {
    const repoName = 'test-repo';
    const mockError = new Error('Failed to remove from config');

    mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig.mockRejectedValue(mockError);

    const result = await tool.execute({ name: repoName });

    expect(mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig).toHaveBeenCalledWith(repoName);
    // Ensure subsequent calls are not made
    expect(mockFileMetadataManagerInstance.removeRepositoryMetadata).not.toHaveBeenCalled();
    expect(mockApiClient.qdrantClient.delete).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Failed to remove repository: ${mockError.message}`);
  });

  it('should return an error response if removing repository metadata fails', async () => {
    const repoName = 'test-repo';
    const mockError = new Error('Failed to remove metadata');

    mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig.mockResolvedValue(undefined);
    mockFileMetadataManagerInstance.removeRepositoryMetadata.mockRejectedValue(mockError);
    mockApiClient.qdrantClient.delete.mockResolvedValue({ status: 'ok' }); // Qdrant deletion should still be attempted

    const result = await tool.execute({ name: repoName });

    expect(mockRepositoryConfigLoaderInstance.removeRepositoryFromConfig).toHaveBeenCalledWith(repoName);
    expect(mockFileMetadataManagerInstance.removeRepositoryMetadata).toHaveBeenCalledWith(repoName);
    expect(mockApiClient.qdrantClient.delete).toHaveBeenCalledWith('documentation', {
      filter: {
        must: [{
          key: 'repository',
          match: {
            value: repoName,
          },
        }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Failed to remove repository: ${mockError.message}`);
  });

  // Add test cases here
});
