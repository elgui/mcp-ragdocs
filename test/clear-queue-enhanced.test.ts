import { ClearQueueEnhancedTool } from '../src/tools/clear-queue-enhanced';
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

describe('ClearQueueEnhancedTool', () => {
  let tool: ClearQueueEnhancedTool;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    tool = new ClearQueueEnhancedTool();
    jest.clearAllMocks();
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'clear_queue',
      description: 'Clear all URLs from the queue',
      inputSchema: {
        type: 'object',
        properties: {
          verbose: {
            type: 'boolean',
            description: 'Whether to return detailed information about the cleared queue',
            default: false,
          },
        },
        required: [],
      },
    });
  });

  it('should successfully clear a queue with URLs (non-verbose)', async () => {
    const mockQueueContent = 'url1\nurl2\nurl3\n';
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);
    mockFs.writeFile.mockResolvedValue(undefined);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), '');
    expect(result).toEqual({
      type: 'text',
      content: 'Queue cleared successfully. Removed 3 URLs from the queue.',
    });
  });

  it('should successfully clear a queue with URLs (verbose)', async () => {
    const mockQueueContent = 'urlA\nurlB\nurlC\n';
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);
    mockFs.writeFile.mockResolvedValue(undefined);

    const result = await tool.execute({ verbose: true });

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), '');
    expect(result).toEqual({
      type: 'text',
      content: 'Queue cleared successfully. Removed 3 URLs from the queue:\n\n1. urlA\n2. urlB\n3. urlC',
    });
  });

  it('should successfully clear an empty queue file', async () => {
    const mockQueueContent = '';
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);
    mockFs.writeFile.mockResolvedValue(undefined);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), '');
    expect(result).toEqual({
      type: 'text',
      content: 'Queue cleared successfully. Removed 0 URLs from the queue.',
    });
  });

  it('should report queue is already empty if queue file does not exist', async () => {
    mockFs.access.mockRejectedValue(new Error('File not found')); // File does not exist

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'text',
      content: 'Queue is already empty (queue file does not exist)',
    });
  });

  it('should handle errors during file reading', async () => {
    const mockError = new Error('Read error');
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockRejectedValue(mockError);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'text',
      content: `Failed to clear queue: ${mockError}`,
    });
  });

  it('should handle errors during file writing', async () => {
    const mockQueueContent = 'url1\n';
    const mockError = new Error('Write error');
    mockFs.access.mockResolvedValue(undefined); // File exists
    mockFs.readFile.mockResolvedValue(mockQueueContent);
    mockFs.writeFile.mockRejectedValue(mockError);

    const result = await tool.execute({});

    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.readFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), '');
    expect(result).toEqual({
      type: 'text',
      content: `Failed to clear queue: ${mockError}`,
    });
  });
});
