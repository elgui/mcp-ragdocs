import { LocalRepositoryEnhancedTool } from '../src/tools/local-repository-enhanced';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { detectLanguage } from '../src/utils/language-detection.js';
import { RepositoryConfigLoader } from '../src/utils/repository-config-loader.js';
import { IndexingStatusManager } from '../src/utils/indexing-status-manager.js';
import { getFileMetadataManager, FileMetadataManager } from '../src/utils/file-metadata-manager.js';
import { RepositoryWatcher } from '../src/utils/repository-watcher.js';
import { info, error, debug } from '../src/utils/logger.js';
import { parseCodeFile } from '../src/utils/ast-parser.js';
import { splitTextByTokens } from '../src/utils/token-counter.js';
import { getCurrentCommitSha } from '../src/utils/git-utils.js';

// Mock external dependencies
jest.mock('fs/promises');
jest.mock('path');
jest.mock('crypto');
jest.mock('glob', () => ({
  glob: jest.fn(),
}));
jest.mock('../src/utils/language-detection.js');

// Declare mock variables here so they can be accessed in module factories and tests
let mockApiClient: any;
let mockServer: any;

// Mock internal dependencies using module factories to handle private members
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


jest.mock('../src/utils/repository-watcher.js');
jest.mock('../src/utils/logger.js');
jest.mock('../src/utils/ast-parser.js');
jest.mock('../src/utils/token-counter.js');
jest.mock('../src/utils/git-utils.js');

// Mock utility functions/classes
const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const mockCrypto = crypto as jest.Mocked<typeof crypto>;
const mockGlob = glob as jest.Mocked<typeof glob>;
const mockDetectLanguage = detectLanguage as jest.Mock;
const MockRepositoryConfigLoader = RepositoryConfigLoader as jest.Mock; // Simplified type assertion
const MockIndexingStatusManager = IndexingStatusManager as jest.Mock; // Simplified type assertion
const mockGetFileMetadataManager = getFileMetadataManager as jest.Mock;
const MockRepositoryWatcher = RepositoryWatcher as jest.Mock; // Simplified type assertion
const mockInfo = info as jest.Mock;
const mockError = error as jest.Mock;
const mockDebug = debug as jest.Mock;
const mockParseCodeFile = parseCodeFile as jest.Mock;
const mockSplitTextByTokens = splitTextByTokens as jest.Mock;
const mockGetCurrentCommitSha = getCurrentCommitSha as jest.Mock;

// Mock implementations for path functions
mockPath.resolve.mockImplementation((p) => p);
mockPath.basename.mockImplementation((p) => p.split('/').pop() || '');
mockPath.join.mockImplementation((...args) => args.join('/'));
mockPath.extname.mockImplementation((p) => {
  const parts = p.split('.');
  return parts.length > 1 ? '.' + parts.pop() : '';
});
mockPath.relative.mockImplementation((from, to) => {
  const fromParts = from.split('/');
  const toParts = to.split('/');
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return '../'.repeat(fromParts.length) + toParts.join('/');
});


describe('LocalRepositoryEnhancedTool', () => {
  let tool: LocalRepositoryEnhancedTool;
  // Get the mock instances from the factories
  let mockStatusManagerInstance: any;
  let mockFileMetadataManagerInstance: any;
  let mockRepositoryConfigLoaderInstance: any;

  beforeEach(async () => {
    // Initialize mockApiClient and mockServer here
    mockApiClient = {
      getEmbeddings: jest.fn(),
      qdrantClient: {
        upsert: jest.fn(),
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
    MockRepositoryWatcher.mockClear();

    // Get the mock instances created by the factories
    mockStatusManagerInstance = new MockIndexingStatusManager();
    mockFileMetadataManagerInstance = await mockGetFileMetadataManager();
    mockRepositoryConfigLoaderInstance = new MockRepositoryConfigLoader();

    // Default mock implementations for file system and glob
    mockFs.stat.mockResolvedValue({ isDirectory: () => true, mtimeMs: Date.now() } as any);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.readFile.mockResolvedValue('');
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockGlob.glob.mockResolvedValue([]);

    // Default mock implementations for other utilities
    mockCrypto.createHash.mockReturnValue({ update: jest.fn().mockReturnThis(), digest: jest.fn().mockReturnValue('mockhash') } as any);
    mockDetectLanguage.mockReturnValue('unknown');
    mockParseCodeFile.mockReturnValue([]);
    mockSplitTextByTokens.mockImplementation((text) => [text]);
    mockGetCurrentCommitSha.mockResolvedValue('mocksha');

    // Instantiate the tool with mocks
    tool = new LocalRepositoryEnhancedTool({ apiClient: mockApiClient, server: mockServer });
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'local_repository',
      description: 'Adds a local repository to the documentation index.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute or relative path to the local repository.',
          },
          name: {
            type: 'string',
            description: 'A unique name for the repository. Defaults to the directory name.',
          },
          include: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns for files to include. Defaults to ["**/*"].',
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns for files to exclude. Defaults to common build/dependency directories.',
          },
          watchMode: {
            type: 'boolean',
            description: 'Enable watch mode to automatically re-index on file changes. Defaults to false.',
          },
          watchInterval: {
            type: 'number',
            description: 'Interval in milliseconds for checking file changes in watch mode. Defaults to 60000 (1 minute).',
          },
          chunkSize: {
            type: 'number',
            description: 'Maximum size of text chunks for indexing. Defaults to 1000.',
          },
          fileTypeConfig: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                include: { type: 'boolean' },
                chunkStrategy: { type: 'string', enum: ['semantic', 'line', 'text'] },
              },
            },
            description: 'Configuration for specific file types.',
          },
        },
        required: ['path'],
      },
    });
  });

  it('should throw InvalidParams error if path is missing', async () => {
    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Repository path is required')
    );
  });

  it('should throw InvalidParams error if path is not a string', async () => {
    await expect(tool.execute({ path: 123 as any })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'Repository path is required')
    );
  });

  it('should throw InvalidParams error if path does not exist', async () => {
    const testPath = '/non/existent/repo';
    mockFs.stat.mockRejectedValue(new Error('ENOENT')); // Simulate file not found

    await expect(tool.execute({ path: testPath })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, `Invalid repository path: ${testPath}`)
    );
    expect(mockPath.resolve).toHaveBeenCalledWith(testPath);
    expect(mockFs.stat).toHaveBeenCalledWith(testPath);
  });

  it('should throw InvalidParams error if path is not a directory', async () => {
    const testPath = '/path/to/file.txt';
    mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any); // Simulate path is a file

    await expect(tool.execute({ path: testPath })).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, `Path is not a directory: ${testPath}`)
    );
    expect(mockPath.resolve).toHaveBeenCalledWith(testPath);
    expect(mockFs.stat).toHaveBeenCalledWith(testPath);
  });

  it('should successfully index a local repository with default configurations', async () => {
    const testPath = '/path/to/test/repo';
    const repoName = 'test-repo';
    const mockFiles = ['file1.md', 'src/file2.js'];
    const mockFile1Content = '# Heading\n\nContent for file 1.';
    const mockFile2Content = 'console.log("hello world");';
    const mockEmbedding = [0.1, 0.2, 0.3];

    // Mock path functions to return expected values for this test
    mockPath.resolve.mockReturnValue(testPath);
    mockPath.basename.mockReturnValue(repoName);
    mockPath.join.mockImplementation((...args) => args.join('/'));
    mockPath.relative.mockImplementation((from, to) => {
      if (from === testPath && to === `${testPath}/file1.md`) return 'file1.md';
      if (from === testPath && to === `${testPath}/src/file2.js`) return 'src/file2.js';
      return jest.requireActual('path').relative(from, to);
    });
    mockPath.extname.mockImplementation((p) => {
      if (p === `${testPath}/file1.md`) return '.md';
      if (p === `${testPath}/src/file2.js`) return '.js';
      return jest.requireActual('path').extname(p);
    });

    // Mock file system operations
    mockFs.stat.mockResolvedValue({ isDirectory: () => true, mtimeMs: Date.now() } as any); // For repo path
    mockGlob.glob.mockResolvedValue(mockFiles.map(f => `${testPath}/${f}`)); // Files found by glob
    mockFs.stat.mockImplementation(async (filePath) => { // For individual files
      if (filePath === `${testPath}/file1.md` || filePath === `${testPath}/src/file2.js`) {
        return { isDirectory: () => false, mtimeMs: Date.now() } as any;
      }
      throw new Error('File not found');
    });
    mockFs.readFile.mockImplementation(async (filePath) => {
      if (filePath === `${testPath}/file1.md`) return mockFile1Content;
      if (filePath === `${testPath}/src/file2.js`) return mockFile2Content;
      return '';
    });

    // Mock other dependencies
    mockCrypto.createHash.mockReturnValue({ update: jest.fn().mockReturnThis(), digest: jest.fn().mockReturnValue('mockhash') } as any);
    mockDetectLanguage.mockImplementation((_file, content) => {
      if (content === mockFile1Content) return 'markdown';
      if (content === mockFile2Content) return 'javascript';
      return 'unknown';
    });
    mockSplitTextByTokens.mockImplementation((text) => [text]); // Simple chunking for this test
    mockGetCurrentCommitSha.mockResolvedValue('mocksha');
    mockApiClient.getEmbeddings.mockResolvedValue([0.1, 0.2, 0.3]);
    mockApiClient.qdrantClient.upsert.mockResolvedValue({ status: 'ok' });
    mockStatusManagerInstance.getStatus.mockResolvedValue(null); // No active indexing

    const result = await tool.execute({ path: testPath });

    // Assertions for tool execution flow
    expect(mockPath.resolve).toHaveBeenCalledWith(testPath);
    expect(mockFs.stat).toHaveBeenCalledWith(testPath);
    expect(mockStatusManagerInstance.getStatus).toHaveBeenCalledWith(repoName);
    expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('repo-configs'), { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining(`${repoName}.json`), expect.any(String), 'utf-8');
    expect(mockRepositoryConfigLoaderInstance.addRepositoryToConfig).toHaveBeenCalledWith(expect.objectContaining({ name: repoName, path: testPath }));
    expect(mockStatusManagerInstance.createStatus).toHaveBeenCalledWith(repoName);
    expect(mockGlob.glob).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ cwd: testPath }));
    expect(mockFs.stat).toHaveBeenCalledTimes(mockFiles.length + 1); // Once for repo, once for each file
    expect(mockFs.readFile).toHaveBeenCalledTimes(mockFiles.length);
    expect(mockDetectLanguage).toHaveBeenCalledTimes(mockFiles.length);
    expect(mockSplitTextByTokens).toHaveBeenCalledTimes(mockFiles.length);
    expect(mockApiClient.getEmbeddings).toHaveBeenCalledTimes(mockFiles.length); // One embedding per chunk (file)
    expect(mockApiClient.qdrantClient.upsert).toHaveBeenCalledTimes(1); // One batch upsert
    expect(mockStatusManagerInstance.updateStatus).toHaveBeenCalled(); // Should be called multiple times
    expect(mockStatusManagerInstance.completeStatus).toHaveBeenCalledWith(repoName, true, expect.any(Object));
    expect(mockFileMetadataManagerInstance.setFileMetadata).toHaveBeenCalledTimes(mockFiles.length);

    // Assertions for the response
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(`Repository configuration saved for ${repoName} (${testPath}).`);
    expect(result.content[0].text).toContain('Indexing has started in the background and will continue after this response.');
    expect(result.content[0].text).toContain(`You can check the status using the 'get_indexing_status' tool with parameter name="${repoName}".`);
    expect(result.content[0].text).toContain('Watch mode: disabled');
  });

  // Add more test cases for different configurations, file processing scenarios, error handling, watch mode, etc.
});
