import { UpdateRepositoryEnhancedTool } from '../src/tools/update-repository-enhanced';
import { ApiClient } from '../src/api-client';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { RepositoryConfig, FileIndexMetadata } from '../src/types'; // DocumentChunk removed as it's not directly used in top-level test suite vars
import fs from 'fs/promises';
import { Stats } from 'fs'; // Import Stats from 'fs'
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto'; // Import crypto for use in jest.doMock
import { detectLanguage } from '../src/utils/language-detection';
import { RepositoryConfigLoader } from '../src/utils/repository-config-loader';
import { getFileMetadataManager, FileMetadataManager } from '../src/utils/file-metadata-manager';
import * as logger from '../src/utils/logger';

// --- Mocks ---
jest.mock('fs/promises');
jest.mock('glob');
jest.mock('../src/utils/language-detection');
jest.mock('../src/utils/repository-config-loader');
jest.mock('../src/utils/file-metadata-manager');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock ApiClient methods
let mockQdrantUpsert: jest.Mock;
let mockQdrantDelete: jest.Mock;
let mockGetEmbeddings: jest.Mock;

jest.mock('../src/api-client', () => {
  mockQdrantUpsert = jest.fn();
  mockQdrantDelete = jest.fn();
  mockGetEmbeddings = jest.fn();
  return {
    ApiClient: jest.fn().mockImplementation(() => ({
      getEmbeddings: mockGetEmbeddings,
      qdrantClient: {
        upsert: mockQdrantUpsert,
        delete: mockQdrantDelete,
      },
    })),
  };
});

// Mock Server
let mockSendProgress: jest.Mock;
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  mockSendProgress = jest.fn();
  return {
    Server: jest.fn().mockImplementation(() => ({
      sendProgress: mockSendProgress,
    })),
  };
});

// Scoped mock for crypto using jest.doMock at the top level
// This will apply to all tests in this file.
// If more granular control is needed per describe block, this strategy might need adjustment.
const MOCKED_VALUES = { // Define outside doMock to avoid closure issues if accessed from elsewhere
  file1Id: 'file1-id-mock',
  newFileId: 'new-file-id-mock',
  deletedFileId: 'deleted-file-id-mock',
  file1UpdatedHash: 'file1-content-updated-mock',
  newFileHash: 'new-file-content-mock',
  file1InitialHash: 'file1-content-initial-mock',
  deletedFileInitialHash: 'deleted-file-content-initial-mock',
  repoNameForCryptoMock: 'test-repo-updated', // Default, can be overridden in tests if needed
  file1UpdatedContentForCryptoMock: 'Updated content for file1.',
  newFileContentForCryptoMock: 'Content for the new file.',
  file1InitialContentForCryptoMock: 'Initial content for file1.',
};

jest.doMock('crypto', () => {
  const originalCrypto = jest.requireActual('crypto');

  // Define the hasher interface to avoid TypeScript errors
  interface MockHasher {
    update: jest.Mock<MockHasher, [string | Buffer]>;
    digest: jest.Mock<string | Buffer, [string?]>;
  }

  return {
    ...originalCrypto,
    createHash: jest.fn((_algorithm: string) => {
      let accumulatedData = '';

      // Create the mock hasher with proper type annotations
      const mockHasherInstance: MockHasher = {
        update: jest.fn((data: string | Buffer): MockHasher => {
          accumulatedData += data.toString();
          return mockHasherInstance;
        }),
        digest: jest.fn((format?: string): string | Buffer => {
          // In Node.js, digest() returns a string when format is provided (like 'hex')
          // or a Buffer when no format is provided
          if (format === 'hex') {
            // Return the appropriate mock value based on the accumulated data
            if (accumulatedData.includes('file1.txt')) {
              return MOCKED_VALUES.file1Id;
            } else if (accumulatedData.includes('new_file.txt')) {
              return MOCKED_VALUES.newFileId;
            } else if (accumulatedData.includes(MOCKED_VALUES.file1UpdatedContentForCryptoMock)) {
              return MOCKED_VALUES.file1UpdatedHash;
            } else if (accumulatedData.includes(MOCKED_VALUES.newFileContentForCryptoMock)) {
              return MOCKED_VALUES.newFileHash;
            } else if (accumulatedData.includes(MOCKED_VALUES.file1InitialContentForCryptoMock)) {
              return MOCKED_VALUES.file1InitialHash;
            }
            // Default fallback
            return 'fixed-mock-hash';
          }
          // If format is not 'hex', return a Buffer (though this case shouldn't occur in our tests)
          return Buffer.from('mocked-hash-buffer');
        }),
      };

      return mockHasherInstance;
    }),
    randomBytes: jest.fn().mockReturnValue(Buffer.from('mocked-random-bytes-for-pointid')),
  };
});


const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');
const COLLECTION_NAME = 'documentation';

describe('UpdateRepositoryEnhancedTool', () => {
  let tool: UpdateRepositoryEnhancedTool;
  let mockApiClientInstance: jest.Mocked<ApiClient>; // Renamed to avoid conflict with module-level mockApiClient
  let mockServerInstance: jest.Mocked<Server>; // Renamed
  let mockMetadataManagerInstance: jest.Mocked<FileMetadataManager>; // Renamed

  const mockFsAccess = fs.access as jest.Mock;
  const mockFsReadFile = fs.readFile as jest.Mock;
  const mockFsWriteFile = fs.writeFile as jest.Mock;
  const mockFsStat = fs.stat as jest.Mock;
  const mockGlob = glob as jest.MockedFunction<typeof glob>;
  const mockDetectLanguage = detectLanguage as jest.Mock;
  const MockRepositoryConfigLoader = RepositoryConfigLoader as jest.MockedClass<typeof RepositoryConfigLoader>;
  let mockAddRepositoryToConfig: jest.Mock;
  const mockGetFileMetadataManager = getFileMetadataManager as jest.Mock;
  let mockGetRepoMetadata: jest.Mock;
  let mockGetFileMeta: jest.Mock;
  let mockSetFileMeta: jest.Mock;
  let mockRemoveFileMeta: jest.Mock;
  let mockInitializeMeta: jest.Mock;
  let mockRemoveRepoMeta: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks(); // Clears invocation counts and mock implementations set by jest.fn() or jest.spyOn()

    // Re-assign module-level mocks to instance variables for clarity in tests if needed,
    // or directly use the module-level mocks (mockGetEmbeddings, mockQdrantUpsert, etc.)
    mockApiClientInstance = new ApiClient() as jest.Mocked<ApiClient>; // ApiClient itself is mocked
    mockServerInstance = new Server({} as any, {} as any) as jest.Mocked<Server>; // Server is mocked

    mockGetRepoMetadata = jest.fn().mockResolvedValue({});
    mockGetFileMeta = jest.fn().mockResolvedValue(null);
    mockSetFileMeta = jest.fn().mockResolvedValue(undefined);
    mockRemoveFileMeta = jest.fn().mockResolvedValue(undefined);
    mockInitializeMeta = jest.fn().mockResolvedValue(undefined);
    mockRemoveRepoMeta = jest.fn().mockResolvedValue(undefined);
    mockMetadataManagerInstance = {
      initialize: mockInitializeMeta,
      getRepositoryMetadata: mockGetRepoMetadata,
      getFileMetadata: mockGetFileMeta,
      setFileMetadata: mockSetFileMeta,
      removeFileMetadata: mockRemoveFileMeta,
      removeRepositoryMetadata: mockRemoveRepoMeta,
      getAllMetadata: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<FileMetadataManager>;
    mockGetFileMetadataManager.mockResolvedValue(mockMetadataManagerInstance);

    mockAddRepositoryToConfig = jest.fn().mockResolvedValue(undefined);
    MockRepositoryConfigLoader.mockImplementation(() => ({
        addRepositoryToConfig: mockAddRepositoryToConfig,
        loadAllRepositories: jest.fn(),
        removeRepositoryFromConfig: jest.fn(),
        updateRepositoryInConfig: jest.fn(),
        getRepositories: jest.fn(),
      } as any));

    tool = new UpdateRepositoryEnhancedTool({ apiClient: mockApiClientInstance, server: mockServerInstance });

    // Default mock implementations for fs, glob etc. for general tests
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify({ name: 'test-repo', path: '/path/to/repo', include: '*.md' }));
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsStat.mockResolvedValue({ isFile: () => true, isDirectory: () => true, mtimeMs: Date.now() } as Stats);
    mockGlob.mockResolvedValue([]);
    mockDetectLanguage.mockReturnValue('plaintext');
    mockGetEmbeddings.mockResolvedValue([0.1, 0.2, 0.3]); // Uses module-level mockGetEmbeddings
    mockQdrantUpsert.mockResolvedValue({ status: 'ok' }); // Uses module-level mockQdrantUpsert
    mockQdrantDelete.mockResolvedValue({ status: 'ok' }); // Uses module-level mockQdrantDelete
  });

  test('should have correct definition', () => {
    const definition = tool.definition;
    expect(definition.name).toBe('update_repository');
    // ... other definition checks
  });

  test('should throw error if name is not provided', async () => {
    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Repository not found: undefined')
    );
  });

  test('should throw error if API client is not provided', async () => {
    const toolWithoutClient = new UpdateRepositoryEnhancedTool({ server: mockServerInstance });
    await expect(toolWithoutClient.execute({ name: 'test-repo' })).rejects.toThrow('API client is required for UpdateRepositoryEnhancedTool');
  });

  test('should throw error if Server instance is not provided', async () => {
    const toolWithoutServer = new UpdateRepositoryEnhancedTool({ apiClient: mockApiClientInstance });
    await expect(toolWithoutServer.execute({ name: 'test-repo' })).rejects.toThrow('Server instance is required for UpdateRepositoryEnhancedTool to send progress');
  });

  test('should throw error if repository path does not exist', async () => {
    mockFsAccess.mockResolvedValue(undefined); // Config file exists
    mockFsReadFile.mockResolvedValue(JSON.stringify({ name: 'test-repo', path: '/nonexistent/path', include: '*.md' }));
    mockFsStat.mockRejectedValue(new Error('ENOENT: no such file or directory')); // Path doesn't exist

    await expect(tool.execute({ name: 'test-repo' })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Invalid repository path: /nonexistent/path')
    );
  });

  test('should throw error if repository path is not a directory', async () => {
    mockFsAccess.mockResolvedValue(undefined); // Config file exists
    mockFsReadFile.mockResolvedValue(JSON.stringify({ name: 'test-repo', path: '/path/to/file.txt', include: '*.md' }));
    mockFsStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as Stats); // Path is a file, not a directory

    await expect(tool.execute({ name: 'test-repo' })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Path is not a directory: /path/to/file.txt')
    );
  });

  test('should handle errors during file reading operations', async () => {
    mockFsAccess.mockResolvedValue(undefined); // Config file exists
    mockFsReadFile.mockResolvedValueOnce(JSON.stringify({ name: 'test-repo', path: '/path/to/repo', include: ['*.md'], exclude: [], watchMode: false, watchInterval: 60000, chunkSize: 100, fileTypeConfig: {} }));
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats); // Path is a directory
    mockGlob.mockResolvedValue(['/path/to/repo/file1.md']);

    // Mock fs.readFile to throw an error when reading a specific file
    mockFsReadFile.mockImplementation((path) => {
      if (path === '/path/to/repo/file1.md') {
        return Promise.reject(new Error('EACCES: permission denied'));
      }
      return Promise.resolve('file content');
    });

    const result = await tool.execute({ name: 'test-repo' });

    expect(result.isError).toBeUndefined(); // Should not be an error response
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Successfully updated repository: test-repo');
    expect(result.content[0].text).toContain('Processed 0 files');
    expect(result.content[0].text).toContain('skipped 1 files');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing file file1.md'));
  });

  test('should handle errors during Qdrant delete operations', async () => {
    const repoName = 'test-repo-qdrant-error';

    // Setup basic mocks
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify({
      name: repoName,
      path: '/path/to/repo',
      include: ['*.md'],
      exclude: [],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {}
    }));
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => true, mtimeMs: Date.now() } as Stats);
    mockGlob.mockResolvedValue(['/path/to/repo/file1.md']);
    mockFsReadFile.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('file1.md')) {
        return Promise.resolve('Updated content');
      }
      return Promise.resolve(JSON.stringify({
        name: repoName,
        path: '/path/to/repo',
        include: ['*.md'],
        exclude: [],
        watchMode: false,
        watchInterval: 60000,
        chunkSize: 100,
        fileTypeConfig: {}
      }));
    });

    // Setup metadata mocks
    mockGetRepoMetadata.mockResolvedValue({
      'file1-id': { repositoryId: repoName, fileId: 'file1-id', filePath: 'file1.md', contentHash: 'old-hash', lastModifiedTimestamp: Date.now() - 1000 }
    });

    // Mock Qdrant delete to fail
    mockQdrantDelete.mockRejectedValueOnce(new Error('Qdrant connection error'));

    // Mock successful embedding and upsert
    mockGetEmbeddings.mockResolvedValue([0.1, 0.2, 0.3]);
    mockQdrantUpsert.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ name: repoName });

    // Should still complete successfully despite Qdrant delete error
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully updated repository: ${repoName}`);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to upsert batch'));
  });

  test('should handle errors during embedding generation', async () => {
    const repoName = 'test-repo-embedding-error';

    // Setup basic mocks
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify({
      name: repoName,
      path: '/path/to/repo',
      include: ['*.md'],
      exclude: [],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {}
    }));
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => true, mtimeMs: Date.now() } as Stats);
    mockGlob.mockResolvedValue(['/path/to/repo/file1.md', '/path/to/repo/file2.md']);
    mockFsReadFile.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('file1.md')) {
        return Promise.resolve('Content for file 1');
      }
      if (typeof path === 'string' && path.includes('file2.md')) {
        return Promise.resolve('Content for file 2');
      }
      return Promise.resolve(JSON.stringify({
        name: repoName,
        path: '/path/to/repo',
        include: ['*.md'],
        exclude: [],
        watchMode: false,
        watchInterval: 60000,
        chunkSize: 100,
        fileTypeConfig: {}
      }));
    });

    // Mock embedding generation to fail for one file but succeed for another
    mockGetEmbeddings.mockImplementation((text) => {
      if (text.includes('file 1')) {
        return Promise.reject(new Error('Embedding service error'));
      }
      return Promise.resolve([0.1, 0.2, 0.3]);
    });

    mockQdrantDelete.mockResolvedValue({ status: 'ok' });
    mockQdrantUpsert.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ name: repoName });

    // Should still complete with partial success
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully updated repository: ${repoName}`);
    expect(result.content[0].text).toContain('Created 2 chunks');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to generate embedding for chunk'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to generate embeddings for'));
  });

  test('should handle different chunking strategies based on file type configuration', async () => {
    const repoName = 'test-repo-chunking';
    const fileContent = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';

    // Setup config with different chunking strategies for different file types
    const config = {
      name: repoName,
      path: '/path/to/repo',
      include: ['*.md', '*.txt'],
      exclude: [],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {
        '.md': { include: true, chunkStrategy: 'semantic' },
        '.txt': { include: true, chunkStrategy: 'line' }
      }
    };

    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockImplementation((path) => {
      if (typeof path === 'string' && (path.includes('file1.md') || path.includes('file2.txt'))) {
        return Promise.resolve(fileContent);
      }
      return Promise.resolve(JSON.stringify(config));
    });
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => true, mtimeMs: Date.now() } as Stats);
    mockGlob.mockResolvedValue(['/path/to/repo/file1.md', '/path/to/repo/file2.txt']);

    // Spy on the chunking methods
    const chunkByParagraphsSpy = jest.spyOn(tool as any, 'chunkByParagraphs');
    const chunkByLinesSpy = jest.spyOn(tool as any, 'chunkByLines');

    await tool.execute({ name: repoName });

    // Verify different chunking strategies were used
    expect(chunkByParagraphsSpy).toHaveBeenCalled();
    expect(chunkByLinesSpy).toHaveBeenCalled();

    // Restore the spies
    chunkByParagraphsSpy.mockRestore();
    chunkByLinesSpy.mockRestore();
  });

  test('should handle empty repositories with no files matching include patterns', async () => {
    const repoName = 'empty-repo';
    const config = {
      name: repoName,
      path: '/path/to/empty-repo',
      include: ['*.md'],
      exclude: [],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {}
    };

    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify(config));
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    mockGlob.mockResolvedValue([]); // No files match the pattern
    mockGetRepoMetadata.mockResolvedValue({}); // No existing metadata

    const result = await tool.execute({ name: repoName });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully updated repository: ${repoName}`);
    expect(result.content[0].text).toContain('Processed 0 files');
    expect(result.content[0].text).toContain('Created 0 chunks');

    // Verify no Qdrant operations were performed
    expect(mockQdrantDelete).not.toHaveBeenCalled();
    expect(mockQdrantUpsert).not.toHaveBeenCalled();
    expect(mockGetEmbeddings).not.toHaveBeenCalled();
  });

  test('should update repository configuration with provided parameters', async () => {
    const repoName = 'config-update-repo';
    const initialConfig = {
      name: repoName,
      path: '/path/to/repo',
      include: ['*.md'],
      exclude: ['node_modules/**'],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {}
    };

    // New parameters to update
    const updateParams = {
      name: repoName,
      include: '*.{md,txt}', // Changed to include txt files
      exclude: 'temp/**', // Changed exclude pattern
      watchMode: true, // Enable watch mode
      watchInterval: 30000, // Change interval
      chunkSize: 200, // Increase chunk size
      fileTypeConfig: {
        '.md': { include: true, chunkStrategy: 'semantic' }
      }
    };

    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue(JSON.stringify(initialConfig));
    mockFsStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as Stats);
    mockGlob.mockResolvedValue([]); // No files for simplicity
    mockGetRepoMetadata.mockResolvedValue({});

    await tool.execute(updateParams);

    // Verify config was updated and saved
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      path.join(REPO_CONFIG_DIR, `${repoName}.json`),
      expect.stringContaining('"include":"*.{md,txt}"'),
      'utf-8'
    );
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      path.join(REPO_CONFIG_DIR, `${repoName}.json`),
      expect.stringContaining('"exclude":"temp/**"'),
      'utf-8'
    );
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      path.join(REPO_CONFIG_DIR, `${repoName}.json`),
      expect.stringContaining('"watchMode":true'),
      'utf-8'
    );
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      path.join(REPO_CONFIG_DIR, `${repoName}.json`),
      expect.stringContaining('"watchInterval":30000'),
      'utf-8'
    );
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      path.join(REPO_CONFIG_DIR, `${repoName}.json`),
      expect.stringContaining('"chunkSize":200'),
      'utf-8'
    );

    // Verify RepositoryConfigLoader was called with updated config
    expect(mockAddRepositoryToConfig).toHaveBeenCalledWith(expect.objectContaining({
      name: repoName,
      include: '*.{md,txt}',
      exclude: 'temp/**',
      watchMode: true,
      watchInterval: 30000,
      chunkSize: 200,
      fileTypeConfig: {
        '.md': { include: true, chunkStrategy: 'semantic' }
      }
    }));
  });

  test('should handle files with special characters in paths', async () => {
    const repoName = 'special-chars-repo';
    const repoPath = '/path/to/repo with spaces';
    const config = {
      name: repoName,
      path: repoPath,
      include: ['*.md'],
      exclude: [],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {}
    };

    // Files with special characters in paths
    const specialFiles = [
      path.join(repoPath, 'file with spaces.md'),
      path.join(repoPath, 'file-with-dashes.md'),
      path.join(repoPath, 'file_with_underscores.md'),
      path.join(repoPath, 'file+with+plus.md'),
      path.join(repoPath, 'file(with)parentheses.md'),
      path.join(repoPath, 'file[with]brackets.md'),
      path.join(repoPath, 'file{with}braces.md'),
      path.join(repoPath, 'file@with@at.md'),
      path.join(repoPath, 'file#with#hash.md'),
      path.join(repoPath, 'file$with$dollar.md'),
      path.join(repoPath, 'file%with%percent.md'),
      path.join(repoPath, 'file&with&ampersand.md')
    ];

    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockImplementation((p) => {
      if (p === path.join(REPO_CONFIG_DIR, `${repoName}.json`)) {
        return Promise.resolve(JSON.stringify(config));
      }
      return Promise.resolve('Content for special file');
    });
    mockFsStat.mockImplementation((p) => {
      if (p === repoPath) {
        return Promise.resolve({ isDirectory: () => true, isFile: () => false } as Stats);
      }
      return Promise.resolve({ isDirectory: () => false, isFile: () => true, mtimeMs: Date.now() } as Stats);
    });
    mockGlob.mockResolvedValue(specialFiles);
    mockGetRepoMetadata.mockResolvedValue({});
    mockGetEmbeddings.mockResolvedValue([0.1, 0.2, 0.3]);
    mockQdrantUpsert.mockResolvedValue({ status: 'ok' });

    const result = await tool.execute({ name: repoName });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Successfully updated repository: ${repoName}`);
    expect(result.content[0].text).toContain(`Processed ${specialFiles.length} files`);

    // Verify all files were processed
    for (const file of specialFiles) {
      const relativePath = path.relative(repoPath, file);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`New file ${relativePath}`));
    }

    // Verify embeddings were generated for all files
    expect(mockGetEmbeddings).toHaveBeenCalledTimes(specialFiles.length);

    // Verify Qdrant upsert was called with the correct number of points
    expect(mockQdrantUpsert).toHaveBeenCalledWith(
      COLLECTION_NAME,
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              repository: repoName,
              isRepositoryFile: true
            })
          })
        ])
      })
    );
  });

  describe('Successful repository update with changes', () => {
    const repoName = MOCKED_VALUES.repoNameForCryptoMock; // Use consistent repoName
    const repoPath = '/path/to/updated-repo';

    const file1Id = MOCKED_VALUES.file1Id;
    const newFileId = MOCKED_VALUES.newFileId;
    const deletedFileId = MOCKED_VALUES.deletedFileId;
    const file1UpdatedHash = MOCKED_VALUES.file1UpdatedHash;
    const newFileHash = MOCKED_VALUES.newFileHash;
    const file1InitialHash = MOCKED_VALUES.file1InitialHash;
    const deletedFileInitialHash = MOCKED_VALUES.deletedFileInitialHash;

    const initialConfig: RepositoryConfig = {
      name: repoName,
      path: repoPath,
      include: ['*.txt'],
      exclude: ['skip.txt'],
      watchMode: false,
      watchInterval: 60000,
      chunkSize: 100,
      fileTypeConfig: {},
    };

    const file1Path = path.join(repoPath, 'file1.txt');
    // We need file1InitialTs for metadata but not file1InitialContent directly
    const file1InitialTs = Date.now() - 10000;
    const file1UpdatedContent = MOCKED_VALUES.file1UpdatedContentForCryptoMock;
    const file1UpdatedTs = Date.now();

    const newFilePath = path.join(repoPath, 'new_file.txt');
    const newFileContent = MOCKED_VALUES.newFileContentForCryptoMock;
    const newFileTs = Date.now();

    const deletedFileInitialTs = Date.now() - 20000;

    beforeEach(async () => {
      // No jest.restoreAllMocks() here, rely on clearAllMocks from outer scope
      // and specific mock setups.

      // Configure fs mocks for this suite
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockImplementation(async (p) => {
        if (p === file1Path) return file1UpdatedContent;
        if (p === newFilePath) return newFileContent;
        if (p === path.join(REPO_CONFIG_DIR, `${repoName}.json`)) return JSON.stringify(initialConfig);
        throw new Error(`fs.readFile not mocked for ${p} in test suite`);
      });
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.stat as jest.Mock).mockImplementation(async (p) => {
        if (p === repoPath) return { isDirectory: () => true, isFile: () => false } as Stats;
        if (p === file1Path) return { isDirectory: () => false, isFile: () => true, mtimeMs: file1UpdatedTs } as Stats;
        if (p === newFilePath) return { isDirectory: () => false, isFile: () => true, mtimeMs: newFileTs } as Stats;
        throw new Error(`fs.stat not mocked for ${p} in test suite`);
      });
      (glob as jest.MockedFunction<typeof glob>).mockResolvedValue([file1Path, newFilePath]);

      // Configure other utility mocks
      (detectLanguage as jest.Mock).mockReturnValue('text');
      (getFileMetadataManager as jest.Mock).mockResolvedValue(mockMetadataManagerInstance);
      (RepositoryConfigLoader as jest.MockedClass<typeof RepositoryConfigLoader>).mockImplementation(() => ({
        addRepositoryToConfig: mockAddRepositoryToConfig,
        loadAllRepositories: jest.fn(),
        removeRepositoryFromConfig: jest.fn(),
        updateRepositoryInConfig: jest.fn(),
        getRepositories: jest.fn(),
      } as any));

      // Configure metadata mocks
      mockGetRepoMetadata.mockResolvedValue({
        [file1Id]: { repositoryId: repoName, fileId: file1Id, filePath: 'file1.txt', contentHash: file1InitialHash, lastModifiedTimestamp: file1InitialTs },
        [deletedFileId]: { repositoryId: repoName, fileId: deletedFileId, filePath: 'deleted_file.txt', contentHash: deletedFileInitialHash, lastModifiedTimestamp: deletedFileInitialTs },
      });
      mockGetFileMeta.mockImplementation(async (currentRepoId, currentFileId) => {
        if (currentRepoId === repoName && currentFileId === file1Id) {
          return { repositoryId: repoName, fileId: file1Id, filePath: 'file1.txt', contentHash: file1InitialHash, lastModifiedTimestamp: file1InitialTs };
        }
        if (currentRepoId === repoName && currentFileId === deletedFileId) {
           return { repositoryId: repoName, fileId: deletedFileId, filePath: 'deleted_file.txt', contentHash: deletedFileInitialHash, lastModifiedTimestamp: deletedFileInitialTs };
        }
        return undefined;
      });

      // Configure ApiClient mocks (these are module-level, ensure they are reset if stateful)
      mockGetEmbeddings.mockResolvedValue([0.1, 0.2]);
      mockQdrantUpsert.mockResolvedValue({ status: 'ok', points_count: 1, operation_id: 1 });
      mockQdrantDelete.mockResolvedValue({ status: 'ok' });
    });

    test('should successfully update repository, re-index changed/new files, and remove deleted files', async () => {
      const result = await tool.execute({ name: repoName });

      expect(fs.readFile).toHaveBeenCalledWith(path.join(REPO_CONFIG_DIR, `${repoName}.json`), 'utf-8');
      expect(fs.writeFile).toHaveBeenCalledWith(path.join(REPO_CONFIG_DIR, `${repoName}.json`), JSON.stringify(initialConfig, null, 2), 'utf-8');
      expect(mockAddRepositoryToConfig).toHaveBeenCalledWith(initialConfig);
      expect(glob).toHaveBeenCalledWith(initialConfig.include, expect.objectContaining({ cwd: initialConfig.path, ignore: initialConfig.exclude }));
      expect(mockGetFileMetadataManager).toHaveBeenCalled();
      expect(mockGetRepoMetadata).toHaveBeenCalledWith(repoName);
      expect(mockGetFileMeta).toHaveBeenCalledWith(repoName, file1Id);
      expect(mockGetFileMeta).toHaveBeenCalledWith(repoName, newFileId);

      expect(mockQdrantDelete).toHaveBeenCalledWith(COLLECTION_NAME, expect.objectContaining({
        filter: { must: [{ key: 'fileId', match: { any: [deletedFileId] } }] }
      }));
      expect(mockQdrantDelete).toHaveBeenCalledWith(COLLECTION_NAME, expect.objectContaining({
        filter: { must: [{ key: 'repository', match: { value: repoName } }, { key: 'isRepositoryFile', match: { value: true } }] }
      }));

      expect(mockGetEmbeddings).toHaveBeenCalledTimes(2);
      expect(mockGetEmbeddings).toHaveBeenCalledWith(file1UpdatedContent);
      expect(mockGetEmbeddings).toHaveBeenCalledWith(newFileContent);

      expect(mockQdrantUpsert).toHaveBeenCalledTimes(1);
      const upsertedPoints = mockQdrantUpsert.mock.calls[0][1].points;
      expect(upsertedPoints).toHaveLength(2);
      expect(upsertedPoints[0].payload.text).toBe(file1UpdatedContent);
      expect(upsertedPoints[0].payload.fileId).toBe(file1Id);
      expect(upsertedPoints[1].payload.text).toBe(newFileContent);
      expect(upsertedPoints[1].payload.fileId).toBe(newFileId);

      expect(mockSetFileMeta).toHaveBeenCalledTimes(2);
      expect(mockSetFileMeta).toHaveBeenCalledWith(expect.objectContaining({
        repositoryId: repoName,
        fileId: file1Id,
        filePath: 'file1.txt',
        contentHash: file1UpdatedHash,
        lastModifiedTimestamp: file1UpdatedTs,
      }));
      expect(mockSetFileMeta).toHaveBeenCalledWith(expect.objectContaining({
        repositoryId: repoName,
        fileId: newFileId,
        filePath: 'new_file.txt',
        contentHash: newFileHash,
        lastModifiedTimestamp: newFileTs,
      }));

      expect(mockSendProgress).toHaveBeenCalled(); // Check if called at various stages

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain(`Successfully updated repository: ${repoName}`);
      expect(result.content[0].text).toContain(`Processed 2 files`);
      expect(result.content[0].text).toContain(`skipped 0 files`);
      expect(result.content[0].text).toContain(`Created 2 chunks, indexed 2 chunks`);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Repository configuration updated and saved.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Starting to re-process repository files...`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] File file1.txt has changed. Marking for update.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] New file new_file.txt. Processing.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] File deleted_file.txt (ID: ${deletedFileId}) deleted from source. Marking for removal from Qdrant and metadata.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Removing 1 deleted files from vector database.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Removing all existing documents for the repository before re-indexing.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Starting to generate embeddings and re-index 2 chunks...`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Finished generating embeddings and re-indexing. Total indexed: 2 chunks.`));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[${repoName}] Successfully updated metadata for 2 files.`));
    });
  });
});
