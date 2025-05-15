import { ListRepositoriesEnhancedTool } from '../src/tools/list-repositories-enhanced';
import { McpToolResponse, RepositoryConfig } from '../src/types';
import fs from 'fs/promises';
import path from 'path';

// Mock the fs/promises module
jest.mock('fs/promises');

// Mock path.join to control the config directory path
const mockPathJoin = jest.fn();
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: mockPathJoin,
}));

const REPO_CONFIG_DIR = '/mock/repo-configs';

describe('ListRepositoriesEnhancedTool', () => {
  let tool: ListRepositoriesEnhancedTool;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    // Reset the mock path.join implementation
    mockPathJoin.mockImplementation(jest.requireActual('path').join);
    // Set the mock REPO_CONFIG_DIR for the tool
    mockPathJoin.mockReturnValueOnce(REPO_CONFIG_DIR);

    tool = new ListRepositoriesEnhancedTool();
    jest.clearAllMocks();

    // Default mock implementations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.readFile.mockResolvedValue('');
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'list_repositories',
      description: 'Lists all configured documentation repositories.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    });
  });

  it('should successfully list repositories from valid JSON files', async () => {
    const mockRepoConfigs: RepositoryConfig[] = [
      {
        name: 'repo1',
        path: '/path/to/repo1',
        include: ['**/*.md'],
        exclude: ['ignore.md'],
        watchMode: true,
        watchInterval: 5000, // Added watchInterval
        chunkSize: 1000, // Added chunkSize
        fileTypeConfig: { markdown: { include: true } },
      },
      {
        name: 'repo2',
        path: '/path/to/repo2',
        include: ['**/*.txt'],
        exclude: [],
        watchMode: false,
        watchInterval: 5000, // Added watchInterval
        chunkSize: 1000, // Added chunkSize
        fileTypeConfig: { text: { include: true } },
      },
    ];
    const mockConfigFiles = ['repo1.json', 'repo2.json', 'other.txt'];

    mockFs.readdir.mockResolvedValue(mockConfigFiles);
    mockFs.readFile.mockImplementation(async (filePath) => {
      if (filePath === path.join(REPO_CONFIG_DIR, 'repo1.json')) {
        return JSON.stringify(mockRepoConfigs[0]);
      }
      if (filePath === path.join(REPO_CONFIG_DIR, 'repo2.json')) {
        return JSON.stringify(mockRepoConfigs[1]);
      }
      return ''; // For other files
    });

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).toHaveBeenCalledTimes(2); // Only for JSON files
    expect(result.content[0].type).toBe('text'); // Access content correctly
    expect(result.content[0].text).toContain('Found 2 repositories:');
    expect(result.content[0].text).toContain('- repo1 (/path/to/repo1)');
    expect(result.content[0].text).toContain('Include: **/*.md');
    expect(result.content[0].text).toContain('Exclude: ignore.md');
    expect(result.content[0].text).toContain('Watch Mode: Enabled');
    expect(result.content[0].text).toContain('File Types: 1 configured');
    expect(result.content[0].text).toContain('- repo2 (/path/to/repo2)');
    expect(result.content[0].text).toContain('Include: **/*.txt');
    expect(result.content[0].text).toContain('Exclude: ');
    expect(result.content[0].text).toContain('Watch Mode: Disabled');
    expect(result.content[0].text).toContain('File Types: 1 configured');
  });

  it('should handle the case where the repo-configs directory does not exist', async () => {
    mockFs.readdir.mockRejectedValue(new Error('Directory not found')); // Simulate directory not existing

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No repositories found (config directory is empty)' }], // Access content correctly
      isError: false, // Assuming no repos found is not an error
    });
  });

  it('should handle the case where the repo-configs directory is empty', async () => {
    mockFs.readdir.mockResolvedValue([]); // Simulate empty directory

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No repositories found' }], // Access content correctly
      isError: false, // Assuming no repos found is not an error
    });
  });

  it('should handle the case where the repo-configs directory contains only non-JSON files', async () => {
    const mockConfigFiles = ['other.txt', 'another.md'];
    mockFs.readdir.mockResolvedValue(mockConfigFiles);

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).not.toHaveBeenCalled(); // No JSON files to read
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No repositories found' }], // Access content correctly
      isError: false, // Assuming no repos found is not an error
    });
  });

  it('should handle the case where a config file contains invalid JSON', async () => {
    const mockConfigFiles = ['invalid.json'];
    mockFs.readdir.mockResolvedValue(mockConfigFiles);
    mockFs.readFile.mockResolvedValue('{ invalid json'); // Simulate invalid JSON

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).toHaveBeenCalledWith(path.join(REPO_CONFIG_DIR, 'invalid.json'), 'utf-8');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No valid repositories found' }], // Access content correctly
      isError: false, // Should report no valid repos if parsing fails, not an error response type
    });
  });

  it('should handle errors during directory reading', async () => {
    const mockError = new Error('Permission denied');
    mockFs.readdir.mockRejectedValue(mockError); // Simulate readdir error

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: 'text', text: `Failed to list repositories: ${mockError}` }], // Access content correctly
      isError: true,
    });
  });

  it('should handle errors during file reading', async () => {
    const mockConfigFiles = ['repo1.json'];
    const mockError = new Error('File read error');
    mockFs.readdir.mockResolvedValue(mockConfigFiles);
    mockFs.readFile.mockRejectedValue(mockError); // Simulate readFile error

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).toHaveBeenCalledWith(path.join(REPO_CONFIG_DIR, 'repo1.json'), 'utf-8');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No valid repositories found' }], // Should report no valid repos if reading fails, not an error response type
      isError: false,
    });
  });

  it('should report "No valid repositories found" if all files are invalid or non-JSON', async () => {
    const mockConfigFiles = ['invalid.json', 'other.txt'];
    mockFs.readdir.mockResolvedValue(mockConfigFiles);
    mockFs.readFile.mockResolvedValue('{ invalid json'); // Simulate invalid JSON for the .json file

    const result = await tool.execute({});

    expect(mockFs.mkdir).toHaveBeenCalledWith(REPO_CONFIG_DIR, { recursive: true });
    expect(mockFs.readdir).toHaveBeenCalledWith(REPO_CONFIG_DIR);
    expect(mockFs.readFile).toHaveBeenCalledWith(path.join(REPO_CONFIG_DIR, 'invalid.json'), 'utf-8'); // Only attempt to read JSON
    expect(result).toEqual({
      content: [{ type: 'text', text: 'No valid repositories found' }], // Access content correctly
      isError: false,
    });
  });
});
