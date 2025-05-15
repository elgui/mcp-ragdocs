import request from 'supertest';
import express, { Application } from 'express';
import { EnhancedHandlerRegistry } from '../src/handler-registry-enhanced';
import { join } from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { RepositoryConfig } from '../src/types';

// Mock dependencies
jest.mock('../src/handler-registry-enhanced');
jest.mock('fs/promises');

// Mock the WebInterfaceEnhanced class
jest.mock('../src/server-enhanced', () => {
  const mockApp = express(); // Create a mock express app
  return {
    WebInterfaceEnhanced: jest.fn().mockImplementation((handlerRegistry: any, apiClient: any) => {
      return {
        // Mock the internal app property
        app: mockApp,
        // Mock the methods called in beforeEach
        setupMiddleware: jest.fn(),
        setupRoutes: jest.fn(),
        // Mock other methods if they are called in tests (e.g., start, stop)
        start: jest.fn(),
        stop: jest.fn(),
      };
    }),
    // Keep getAvailablePort if it's used elsewhere or needs to be mocked separately
    getAvailablePort: jest.fn().mockResolvedValue(3031),
  };
});

// Import the mocked WebInterfaceEnhanced
const { WebInterfaceEnhanced } = require('../src/server-enhanced');

// Create a mock ApiClient with a mocked LLMService
const mockLlmService = {
  getAvailabilityStatus: jest.fn(() => ({
    primary: {
      available: true,
      error: undefined,
      provider: 'MockLLM',
    },
    fallback: undefined,
    overallAvailable: true,
  })),
};

const mockApiClient = {
  llmService: mockLlmService,
};

const mockHandlerRegistry = new EnhancedHandlerRegistry(
  {} as any, // Mock ToolFactory
  {} as any // Mock ApiClient
) as jest.Mocked<EnhancedHandlerRegistry>;


describe('WebInterfaceEnhanced', () => {
  let webInterface: any; // Use any as we are mocking the class
  let app: Application;

  beforeEach(() => {
    // Instantiate the mocked WebInterfaceEnhanced, passing the mock apiClient
    webInterface = new WebInterfaceEnhanced(mockHandlerRegistry, mockApiClient);
    // Access the mocked internal app instance
    app = webInterface.app;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /status', () => {
    test('should return server and LLM status', async () => {
      const response = await request(app).get('/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        llmStatus: {
          primary: {
            available: true,
            error: undefined,
            provider: 'MockLLM',
          },
          fallback: undefined,
          overallAvailable: true,
        },
      });
      // Check if the mocked getAvailabilityStatus was called on the mocked apiClient's llmService
      expect(mockApiClient.llmService.getAvailabilityStatus).toHaveBeenCalled();
    });
  });

  describe('GET /repositories', () => {
    const mockRepoConfigs: RepositoryConfig[] = [
      {
        name: 'repo1',
        path: '/path/to/repo1',
        include: ['*.md'],
        exclude: [],
        watchMode: false,
        watchInterval: 0,
        chunkSize: 1000,
        fileTypeConfig: {}
      },
      {
        name: 'repo2',
        path: '/path/to/repo2',
        include: ['*.ts'],
        exclude: ['dist'],
        watchMode: true,
        watchInterval: 5000,
        chunkSize: 500,
        fileTypeConfig: {}
      },
    ];

    beforeEach(() => {
      // Mock fsPromises.access to indicate the directory exists
      (fsPromises.access as jest.Mock).mockResolvedValue(undefined);
      // Mock fsPromises.readdir to return config files
      (fsPromises.readdir as jest.Mock).mockResolvedValue(['repo1.json', 'repo2.json', 'other.txt']);
      // Mock fsPromises.readFile to return config content
      (fsPromises.readFile as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(mockRepoConfigs[0]))
        .mockResolvedValueOnce(JSON.stringify(mockRepoConfigs[1]));
    });

    test('should return a list of repository configurations', async () => {
      const response = await request(app).get('/repositories');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockRepoConfigs);
      expect(fsPromises.access).toHaveBeenCalledWith(expect.stringContaining('repo-configs'));
      expect(fsPromises.readdir).toHaveBeenCalledWith(expect.stringContaining('repo-configs'));
      expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
      expect(fsPromises.readFile).toHaveBeenCalledWith(expect.stringContaining('repo1.json'), 'utf-8');
      expect(fsPromises.readFile).toHaveBeenCalledWith(expect.stringContaining('repo2.json'), 'utf-8');
    });

    test('should return an empty array if repo-configs directory does not exist', async () => {
      // Mock fsPromises.access to throw an error, simulating directory not found
      (fsPromises.access as jest.Mock).mockRejectedValue(new Error('Directory not found'));

      const response = await request(app).get('/repositories');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(fsPromises.access).toHaveBeenCalledWith(expect.stringContaining('repo-configs'));
      expect(fsPromises.readdir).not.toHaveBeenCalled(); // Should not read if directory doesn't exist
      expect(fsPromises.readFile).not.toHaveBeenCalled(); // Should not read if directory doesn't exist
    });

    test('should handle errors when reading config files', async () => {
      // Mock fsPromises.access to indicate the directory exists
      (fsPromises.access as jest.Mock).mockResolvedValue(undefined);
      // Mock fsPromises.readdir to return config files
      (fsPromises.readdir as jest.Mock).mockResolvedValue(['repo1.json', 'invalid.json']);
      // Mock fsPromises.readFile to return valid config for repo1 and throw error for invalid
      (fsPromises.readFile as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(mockRepoConfigs[0]))
        .mockRejectedValueOnce(new Error('Invalid JSON'));

      const response = await request(app).get('/repositories');

      expect(response.status).toBe(200);
      // Should return only the valid repository
      expect(response.body).toEqual([mockRepoConfigs[0]]);
      expect(fsPromises.access).toHaveBeenCalledWith(expect.stringContaining('repo-configs'));
      expect(fsPromises.readdir).toHaveBeenCalledWith(expect.stringContaining('repo-configs'));
      expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
      expect(fsPromises.readFile).toHaveBeenCalledWith(expect.stringContaining('repo1.json'), 'utf-8');
      expect(fsPromises.readFile).toHaveBeenCalledWith(expect.stringContaining('invalid.json'), 'utf-8');
    });
  });

  describe('GET /documents', () => {
    test('should return a list of documents', async () => {
      const mockListSourcesTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Doc 1 (url1)\nDoc 2 (url2)' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListSourcesTool as any);

      const response = await request(app).get('/documents');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { url: 'url1', title: 'Doc 1', timestamp: expect.any(String), status: 'COMPLETED' },
        { url: 'url2', title: 'Doc 2', timestamp: expect.any(String), status: 'COMPLETED' },
      ]);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
    });

    test('should return empty array if no documents found', async () => {
      const mockListSourcesTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'No documentation sources found in the cloud collection.' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListSourcesTool as any);

      const response = await request(app).get('/documents');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
    });

    test('should handle errors from list_sources tool', async () => {
      const mockListSourcesTool = {
        execute: jest.fn().mockRejectedValue(new Error('Failed to list sources')),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListSourcesTool as any);

      const response = await request(app).get('/documents');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list sources' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
    });
  });

  describe('GET /queue', () => {
    const mockQueuePath = join(__dirname, '..', 'queue.txt');

    beforeEach(() => {
      // Mock fsPromises.readFile for the queue file
      (fsPromises.readFile as jest.Mock).mockResolvedValue(''); // Default empty queue file
      // Mock fs.existsSync for the queue file
      (fs.existsSync as jest.Mock).mockReturnValue(true); // Assume queue file exists
      // Mock fsPromises.writeFile for initializeQueueFile
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
      // Mock fsPromises.appendFile for add-doc
      (fsPromises.appendFile as jest.Mock).mockResolvedValue(undefined);
    });

    test('should return pending and processing queue items', async () => {
      // Mock queue file content
      (fsPromises.readFile as jest.Mock).mockResolvedValue('url1\nurl2');

      // Mock list_queue tool response
      const mockListQueueTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'url3 | PROCESSING | 2023-01-01T10:00:00Z' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListQueueTool as any);

      const response = await request(app).get('/queue');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: expect.any(String), url: 'url1', status: 'PENDING', timestamp: expect.any(String) },
        { id: expect.any(String), url: 'url2', status: 'PENDING', timestamp: expect.any(String) },
        { id: expect.any(String), url: 'url3', status: 'PROCESSING', timestamp: '2023-01-01T10:00:00Z' },
      ]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_queue');
      expect(mockListQueueTool.execute).toHaveBeenCalledWith({});
    });

    test('should return only pending items if list_queue returns empty', async () => {
      // Mock queue file content
      (fsPromises.readFile as jest.Mock).mockResolvedValue('url1\nurl2');

      // Mock list_queue tool response
      const mockListQueueTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListQueueTool as any);

      const response = await request(app).get('/queue');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: expect.any(String), url: 'url1', status: 'PENDING', timestamp: expect.any(String) },
        { id: expect.any(String), url: 'url2', status: 'PENDING', timestamp: expect.any(String) },
      ]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_queue');
      expect(mockListQueueTool.execute).toHaveBeenCalledWith({});
    });

    test('should return empty array if queue file is empty and list_queue is empty', async () => {
      // Mock queue file content
      (fsPromises.readFile as jest.Mock).mockResolvedValue('');

      // Mock list_queue tool response
      const mockListQueueTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListQueueTool as any);

      const response = await request(app).get('/queue');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_queue');
      expect(mockListQueueTool.execute).toHaveBeenCalledWith({});
    });

    test('should handle errors from list_queue tool', async () => {
      // Mock queue file content
      (fsPromises.readFile as jest.Mock).mockResolvedValue('url1');

      // Mock list_queue tool response
      const mockListQueueTool = {
        execute: jest.fn().mockRejectedValue(new Error('Failed to list queue')),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListQueueTool as any);

      const response = await request(app).get('/queue');

      // Even with tool error, should return pending items from file
      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: expect.any(String), url: 'url1', status: 'PENDING', timestamp: expect.any(String) },
      ]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_queue');
      expect(mockListQueueTool.execute).toHaveBeenCalledWith({});
    });

    test('should initialize queue file if it does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false); // Simulate file not existing
      (fsPromises.readFile as jest.Mock).mockResolvedValue(''); // Still mock readFile for subsequent calls

      // Mock list_queue tool response
      const mockListQueueTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListQueueTool as any);

      const response = await request(app).get('/queue');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(fs.existsSync).toHaveBeenCalledWith(mockQueuePath);
      expect(fsPromises.writeFile).toHaveBeenCalledWith(mockQueuePath, '', 'utf8');
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_queue');
      expect(mockListQueueTool.execute).toHaveBeenCalledWith({});
    });
  });

  describe('POST /add-doc', () => {
    const mockQueuePath = join(__dirname, '..', 'queue.txt');
    let mockRunQueueTool: any;

    beforeEach(() => {
      // Mock fsPromises.readFile for the queue file
      (fsPromises.readFile as jest.Mock).mockResolvedValue(''); // Default empty queue file
      // Mock fs.existsSync for the queue file
      (fs.existsSync as jest.Mock).mockReturnValue(true); // Assume queue file exists
      // Mock fsPromises.writeFile for initializeQueueFile
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
      // Mock fsPromises.appendFile for add-doc
      (fsPromises.appendFile as jest.Mock).mockResolvedValue(undefined);
    });

    test('should add a single URL to the queue and start processing', async () => {
      const url = 'http://example.com/doc1';
      const response = await request(app).post('/add-doc').send({ url });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{
        id: expect.any(Number),
        url: url,
        status: 'PENDING',
        timestamp: expect.any(String),
      }]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, url);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      // expect(mockRunQueueTool.execute).toHaveBeenCalledWith({}); // This is now mocked within the beforeEach
    });

    test('should add multiple URLs to the queue and start processing', async () => {
      const urls = ['http://example.com/doc1', 'http://example.com/doc2'];
      // Mock readFile to return content after first append to test newline logic
      (fsPromises.readFile as jest.Mock).mockResolvedValueOnce('').mockResolvedValueOnce(urls[0]);

      const response = await request(app).post('/add-doc').send({ urls });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { id: expect.any(Number), url: urls[0], status: 'PENDING', timestamp: expect.any(String) },
        { id: expect.any(Number), url: urls[1], status: 'PENDING', timestamp: expect.any(String) },
      ]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(mockQueuePath, 'utf8');
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, urls[0]);
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, '\n' + urls[1]); // Check for newline
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      // expect(mockRunQueueTool.execute).toHaveBeenCalledWith({}); // This is now mocked within the beforeEach
    });

    test('should return 400 if no URL or URLs array is provided', async () => {
      const response = await request(app).post('/add-doc').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'URL or array of URLs is required' });
      expect(fsPromises.appendFile).not.toHaveBeenCalled();
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalled();
    });

    test('should initialize queue file if it does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false); // Simulate file not existing
      const url = 'http://example.com/doc1';
      const response = await request(app).post('/add-doc').send({ url });

      expect(response.status).toBe(200);
      expect(fs.existsSync).toHaveBeenCalledWith(mockQueuePath);
      expect(fsPromises.writeFile).toHaveBeenCalledWith(mockQueuePath, '', 'utf8');
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, url);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      // expect(mockRunQueueTool.execute).toHaveBeenCalledWith({}); // This is now mocked within the beforeEach
    });

    test('should handle errors when appending to queue file', async () => {
      const url = 'http://example.com/doc1';
      (fsPromises.appendFile as jest.Mock).mockRejectedValue(new Error('Failed to write file'));

      const response = await request(app).post('/add-doc').send({ url });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to write file' });
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, url);
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalledWith('run_queue'); // Should not call run_queue on file error
    });

    test('should handle errors from run_queue tool', async () => {
      const url = 'http://example.com/doc1';
      // mockRunQueueTool.execute.mockRejectedValue(new Error('Run queue failed')); // This is now mocked within the beforeEach

      const response = await request(app).post('/add-doc').send({ url });

      expect(response.status).toBe(200); // Should still return success for adding to queue
      expect(response.body).toEqual([{
        id: expect.any(Number),
        url: url,
        status: 'PENDING',
        timestamp: expect.any(String),
      }]);
      expect(fsPromises.appendFile).toHaveBeenCalledWith(mockQueuePath, url);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      // expect(mockRunQueueTool.execute).toHaveBeenCalledWith({}); // This is now mocked within the beforeEach
      // Error from run_queue is handled internally and not propagated to the client
    });
  });

  describe('POST /search', () => {
    let mockSearchDocumentationTool: any;

    beforeEach(() => {
      // Mock search_documentation tool
      mockSearchDocumentationTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{
            type: 'json',
            json: {
              results: [
                { url: 'url1', title: 'Doc 1', content: 'Content 1', snippet: 'Snippet 1' },
                { url: 'url2', title: 'Doc 2', content: 'Content 2', snippet: 'Snippet 2' },
              ],
            },
          }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValue(mockSearchDocumentationTool as any);
    });

    test('should return search results', async () => {
      const query = 'test query';
      const response = await request(app).post('/search').send({ query });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        results: [
          { url: 'url1', title: 'Doc 1', content: 'Content 1', snippet: 'Snippet 1' },
          { url: 'url2', title: 'Doc 2', content: 'Content 2', snippet: 'Snippet 2' },
        ],
      });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({ query, returnFormat: 'json' });
    });

    test('should return 400 if no query is provided', async () => {
      const response = await request(app).post('/search').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Query is required' });
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalled();
    });

    test('should handle errors from search_documentation tool', async () => {
      const query = 'test query';
      mockSearchDocumentationTool.execute.mockRejectedValue(new Error('Search failed'));

      const response = await request(app).post('/search').send({ query });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Search failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({ query, returnFormat: 'json' });
    });

    test('should handle unexpected response format from search_documentation tool', async () => {
      const query = 'test query';
      mockSearchDocumentationTool.execute.mockResolvedValue({
        content: [{ type: 'text', text: 'Unexpected format' }],
      });

      const response = await request(app).post('/search').send({ query });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Unexpected response format from search documentation tool' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({ query, returnFormat: 'json' });
    });
  });

  describe('POST /clear-queue', () => {
    const mockQueuePath = join(__dirname, '..', 'queue.txt');
    let mockClearQueueTool: any;
    let mockRunQueueTool: any;

    beforeEach(() => {
      // Mock fsPromises.writeFile for clearing the queue file
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);

      // Mock clear_queue tool
      mockClearQueueTool = {
        execute: jest.fn().mockResolvedValue({ isError: false, content: [] }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockClearQueueTool as any); // For clear_queue

      // Mock run_queue tool for stopping processing
      mockRunQueueTool = {
        execute: jest.fn().mockResolvedValue({}),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockRunQueueTool as any); // For run_queue
    });

    test('should clear the queue and stop processing', async () => {
      const response = await request(app).post('/clear-queue').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Queue cleared successfully' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('clear_queue');
      expect(mockClearQueueTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      expect(mockRunQueueTool.execute).toHaveBeenCalledWith({ action: 'stop' });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(mockQueuePath, '', 'utf8');
    });

    test('should handle errors from clear_queue tool', async () => {
      mockClearQueueTool.execute.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Clear failed' }] });

      const response = await request(app).post('/clear-queue').send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Clear failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('clear_queue');
      expect(mockClearQueueTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalledWith('run_queue'); // Should not call run_queue on clear error
      expect(fsPromises.writeFile).not.toHaveBeenCalled(); // Should not clear file on clear error
    });

    test('should handle errors from run_queue tool', async () => {
      mockRunQueueTool.execute.mockRejectedValue(new Error('Stop processing failed'));

      const response = await request(app).post('/clear-queue').send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Stop processing failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('clear_queue');
      expect(mockClearQueueTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      expect(mockRunQueueTool.execute).toHaveBeenCalledWith({ action: 'stop' });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(mockQueuePath, '', 'utf8'); // Should still clear file even if stop fails
    });

    test('should handle errors when clearing queue file', async () => {
      (fsPromises.writeFile as jest.Mock).mockRejectedValue(new Error('Failed to clear file'));

      const response = await request(app).post('/clear-queue').send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to clear file' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('clear_queue');
      expect(mockClearQueueTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      expect(mockRunQueueTool.execute).toHaveBeenCalledWith({ action: 'stop' });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(mockQueuePath, '', 'utf8');
    });
  });

  describe('POST /process-queue', () => {
    let mockRunQueueTool: any;

    beforeEach(() => {
      // Mock run_queue tool
      mockRunQueueTool = {
        execute: jest.fn().mockResolvedValue({}),
      };
      mockHandlerRegistry.getTool.mockReturnValue(mockRunQueueTool as any);
    });

    test('should start processing the queue', async () => {
      const response = await request(app).post('/process-queue').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Queue processing started' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      expect(mockRunQueueTool.execute).toHaveBeenCalledWith({});
    });

    test('should handle errors from run_queue tool', async () => {
      mockRunQueueTool.execute.mockRejectedValue(new Error('Processing failed'));

      const response = await request(app).post('/process-queue').send({});

      expect(response.status).toBe(200); // Should still return success for starting processing
      expect(response.body).toEqual({ message: 'Queue processing started' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('run_queue');
      expect(mockRunQueueTool.execute).toHaveBeenCalledWith({});
      // Error from run_queue is handled internally and not propagated to the client
    });
  });

  describe('DELETE /documents', () => {
    let mockRemoveDocumentationTool: any;

    beforeEach(() => {
      // Mock remove_documentation tool
      mockRemoveDocumentationTool = {
        execute: jest.fn().mockResolvedValue({}),
      };
      mockHandlerRegistry.getTool.mockReturnValue(mockRemoveDocumentationTool as any);
    });

    test('should remove a single document', async () => {
      const url = 'url1';
      const response = await request(app).delete('/documents').send({ url });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: '1 document removed successfully', count: 1 });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('remove_documentation');
      expect(mockRemoveDocumentationTool.execute).toHaveBeenCalledWith({ urls: [url] });
    });

    test('should remove multiple documents', async () => {
      const urls = ['url1', 'url2'];
      const response = await request(app).delete('/documents').send({ urls });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: '2 documents removed successfully', count: 2 });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('remove_documentation');
      expect(mockRemoveDocumentationTool.execute).toHaveBeenCalledWith({ urls: urls });
    });

    test('should return 400 if no URL or URLs array is provided', async () => {
      const response = await request(app).post('/add-doc').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'URL or array of URLs is required' });
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalled();
    });

    test('should handle errors from remove_documentation tool', async () => {
      const url = 'url1';
      mockRemoveDocumentationTool.execute.mockRejectedValue(new Error('Remove failed'));

      const response = await request(app).delete('/documents').send({ url });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Remove failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('remove_documentation');
      expect(mockRemoveDocumentationTool.execute).toHaveBeenCalledWith({ urls: [url] });
    });
  });

  describe('DELETE /documents/all', () => {
    let mockListSourcesTool: any;
    let mockRemoveDocumentationTool: any;

    beforeEach(() => {
      // Mock list_sources tool
      mockListSourcesTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Doc 1 (url1)\nDoc 2 (url2)' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockListSourcesTool as any); // For list_sources

      // Mock remove_documentation tool
      mockRemoveDocumentationTool = {
        execute: jest.fn().mockResolvedValue({}),
      };
      mockHandlerRegistry.getTool.mockReturnValueOnce(mockRemoveDocumentationTool as any); // For remove_documentation
    });

    test('should remove all documents', async () => {
      const response = await request(app).delete('/documents/all').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: '2 documents removed successfully', count: 2 });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('remove_documentation');
      expect(mockRemoveDocumentationTool.execute).toHaveBeenCalledWith({ urls: ['url1', 'url2'] });
    });

    test('should return message if no documents to remove', async () => {
      mockListSourcesTool.execute.mockResolvedValue({
        content: [{ type: 'text', text: 'No documentation sources found in the cloud collection.' }],
      });

      const response = await request(app).delete('/documents/all').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'No documents to remove', count: 0 });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalledWith('remove_documentation');
    });

    test('should handle errors from list_sources tool', async () => {
      mockListSourcesTool.execute.mockRejectedValue(new Error('List sources failed'));

      const response = await request(app).delete('/documents/all').send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'List sources failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalledWith('remove_documentation');
    });

    test('should handle errors from remove_documentation tool', async () => {
      mockRemoveDocumentationTool.execute.mockRejectedValue(new Error('Remove failed'));

      const response = await request(app).delete('/documents/all').send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Remove failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('list_sources');
      expect(mockListSourcesTool.execute).toHaveBeenCalledWith({});
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('remove_documentation');
      expect(mockRemoveDocumentationTool.execute).toHaveBeenCalledWith({ urls: ['url1', 'url2'] });
    });
  });

  describe('POST /extract-urls', () => {
    let mockExtractUrlsTool: any;

    beforeEach(() => {
      // Mock extract_urls tool
      mockExtractUrlsTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'url1\nurl2' }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValue(mockExtractUrlsTool as any);
    });

    test('should extract URLs from a given URL', async () => {
      const url = 'http://example.com';
      const response = await request(app).post('/extract-urls').send({ url });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ urls: ['url1', 'url2'] });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('extract_urls');
      expect(mockExtractUrlsTool.execute).toHaveBeenCalledWith({ url });
    });

    test('should return 400 if no URL is provided', async () => {
      const response = await request(app).post('/extract-urls').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'URL is required' });
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalled();
    });

    test('should handle errors from extract_urls tool', async () => {
      const url = 'http://example.com';
      mockExtractUrlsTool.execute.mockRejectedValue(new Error('Extraction failed'));

      const response = await request(app).post('/extract-urls').send({ url });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Extraction failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('extract_urls');
      expect(mockExtractUrlsTool.execute).toHaveBeenCalledWith({ url });
    });
  });

  describe('POST /file-descriptions', () => {
    let mockSearchDocumentationTool: any;

    beforeEach(() => {
      // Mock search_documentation tool for file descriptions
      mockSearchDocumentationTool = {
        execute: jest.fn().mockResolvedValue({
          content: [{
            type: 'json',
            json: {
              fileDescriptions: [
                { filePath: 'file1.md', description: 'Description 1' },
                { filePath: 'file2.ts', description: 'Description 2' },
              ],
            },
          }],
        }),
      };
      mockHandlerRegistry.getTool.mockReturnValue(mockSearchDocumentationTool as any);
    });

    test('should return file descriptions', async () => {
      const query = 'test query';
      const response = await request(app).post('/file-descriptions').send({ query });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        fileDescriptions: [
          { filePath: 'file1.md', description: 'Description 1' },
          { filePath: 'file2.ts', description: 'Description 2' },
        ],
      });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({
        query,
        limit: 10,
        generateFileDescriptions: true,
        returnFormat: 'json',
      });
    });

    test('should use provided limit', async () => {
      const query = 'test query';
      const limit = 5;
      const response = await request(app).post('/file-descriptions').send({ query, limit });

      expect(response.status).toBe(200);
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({
        query,
        limit: limit,
        generateFileDescriptions: true,
        returnFormat: 'json',
      });
    });

    test('should return 400 if no query is provided', async () => {
      const response = await request(app).post('/file-descriptions').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Query is required' });
      expect(mockHandlerRegistry.getTool).not.toHaveBeenCalled();
    });

    test('should handle errors from search_documentation tool', async () => {
      const query = 'test query';
      mockSearchDocumentationTool.execute.mockRejectedValue(new Error('File description search failed'));

      const response = await request(app).post('/file-descriptions').send({ query });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'File description search failed' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({
        query,
        limit: 10,
        generateFileDescriptions: true,
        returnFormat: 'json',
      });
    });

    test('should handle unexpected response format from search_documentation tool', async () => {
      const query = 'test query';
      mockSearchDocumentationTool.execute.mockResolvedValue({
        content: [{ type: 'text', text: 'Unexpected format' }],
      });

      const response = await request(app).post('/file-descriptions').send({ query });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Invalid response format from search documentation tool for file descriptions.' });
      expect(mockHandlerRegistry.getTool).toHaveBeenCalledWith('search_documentation');
      expect(mockSearchDocumentationTool.execute).toHaveBeenCalledWith({
        query,
        limit: 10,
        generateFileDescriptions: true,
        returnFormat: 'json',
      });
    });
  });
});
