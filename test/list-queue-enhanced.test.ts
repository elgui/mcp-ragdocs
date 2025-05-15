import { ListQueueEnhancedTool } from '../src/tools/list-queue-enhanced';
import { McpToolResponse } from '../src/types';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock the fs/promises module
jest.mock('fs/promises');

// Get the path to the queue file relative to the test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', 'queue.txt');

describe('ListQueueEnhancedTool', () => {
  let tool: ListQueueEnhancedTool;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    tool = new ListQueueEnhancedTool();
    jest.clearAllMocks();
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'list_queue',
      description: 'List all URLs currently in the documentation processing queue',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    });
  });

  it('should successfully list URLs from a queue file with content', async () => {
    const mockQueueContent = 'url1\nurl2\nurl3\n';
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(result).toEqual({
      type: 'text',
      content: 'Queue contains 3 URLs:\nurl1\nurl2\nurl3',
    });
  });

  it('should report that the queue is empty when the file exists but is empty', async () => {
    const mockQueueContent = '';
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(result).toEqual({
      type: 'text',
      content: 'Queue is empty',
    });
  });

  it('should report that the queue is empty when the queue file does not exist', async () => {
    mockFs.access.mockRejectedValue(new Error('File not found')); // File does not exist

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'text',
      content: 'Queue is empty (queue file does not exist)',
    });
  });

  it('should handle errors during file reading', async () => {
    const mockError = new Error('Read error');
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockRejectedValue(mockError);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(result).toEqual({
      content: [{ type: 'text', text: `Failed to read queue: ${mockError}` }],
      isError: true,
    });
  });
});
