import { ExtractUrlsEnhancedTool } from '../src/tools/extract-urls-enhanced';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

// Mock the fs/promises module
jest.mock('fs/promises');

// Mock cheerio
jest.mock('cheerio');

// Mock the ApiClient and its dependencies
const mockPageContent = jest.fn();
const mockPageGoto = jest.fn();
const mockPageClose = jest.fn();
const mockBrowserNewPage = jest.fn().mockResolvedValue({
  goto: mockPageGoto,
  content: mockPageContent,
  close: mockPageClose,
});
const mockInitBrowser = jest.fn().mockResolvedValue(undefined);

const mockApiClient = {
  initBrowser: mockInitBrowser,
  browser: {
    newPage: mockBrowserNewPage,
  },
};

// Get the path to the queue file relative to the test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUEUE_FILE = path.join(__dirname, '..', 'queue.txt');

describe('ExtractUrlsEnhancedTool', () => {
  let tool: ExtractUrlsEnhancedTool;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockCheerio = cheerio as jest.Mocked<typeof cheerio>;

  beforeEach(() => {
    tool = new ExtractUrlsEnhancedTool();
    // Manually set the mocked apiClient
    (tool as any).apiClient = mockApiClient;
    jest.clearAllMocks();

    // Reset cheerio mock to its original implementation for each test
    jest.requireActual('cheerio');
  });

  it('should have the correct definition', () => {
    expect(tool.definition).toEqual({
      name: 'extract_urls',
      description: 'Extract all URLs from a given web page',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the page to extract URLs from',
          },
          add_to_queue: {
            type: 'boolean',
            description: 'If true, automatically add extracted URLs to the queue',
            default: false,
          },
        },
        required: ['url'],
      },
    });
  });

  it('should throw InvalidParams error if URL is missing', async () => {
    await expect(tool.execute({})).rejects.toThrow(
      new McpError(ErrorCode.InvalidParams, 'URL is required')
    );
  });

  it('should successfully extract URLs and return them (non-queue)', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `
      <html>
        <body>
          <a href="/docs/3/another.html">Link 1</a>
          <a href="http://example.com/docs/3/yet-another.html">Link 2</a>
          <a href="http://other.com/page.html">External Link</a>
          <a href="#section">Anchor Link</a>
          <a href="/docs/2/old-version.html">Old Version Link</a>
        </body>
      </html>
    `;
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);

    const result = await tool.execute({ url: testUrl });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.appendFile).not.toHaveBeenCalled();

    const expectedUrls = [
      'http://example.com/docs/3/another.html',
      'http://example.com/docs/3/yet-another.html',
    ];
    expect(result).toEqual({
      type: 'text',
      content: expectedUrls.join('\n'),
    });
  });

  it('should successfully extract URLs and add them to the queue', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `
      <html>
        <body>
          <a href="/docs/3/link1.html">Link 1</a>
          <a href="http://example.com/docs/3/link2.html">Link 2</a>
        </body>
      </html>
    `;
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);
    mockFs.access.mockResolvedValue(undefined); // Queue file exists
    mockFs.appendFile.mockResolvedValue(undefined);

    const result = await tool.execute({ url: testUrl, add_to_queue: true });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));

    const expectedUrls = [
      'http://example.com/docs/3/link1.html',
      'http://example.com/docs/3/link2.html',
    ];
    expect(mockFs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('queue.txt'),
      expectedUrls.join('\n') + '\n'
    );

    expect(result).toEqual({
      type: 'text',
      content: `Successfully added ${expectedUrls.length} URLs to the queue`,
    });
  });

  it('should report no URLs found if no relevant links exist', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `
      <html>
        <body>
          <p>No links here.</p>
        </body>
      </html>
    `;
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);

    const result = await tool.execute({ url: testUrl });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.appendFile).not.toHaveBeenCalled();

    expect(result).toEqual({
      type: 'text',
      content: 'No URLs found on this page.',
    });
  });

  it('should handle errors during page.goto', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockError = new Error('Navigation failed');
    mockPageGoto.mockRejectedValue(mockError);

    const result = await tool.execute({ url: testUrl });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).not.toHaveBeenCalled();
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.appendFile).not.toHaveBeenCalled();

    expect(result).toEqual({
      type: 'text',
      content: `Failed to extract URLs: ${mockError}`,
      isError: true,
    });
  });

  it('should handle errors during page.content', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockError = new Error('Failed to get content');
    mockPageGoto.mockResolvedValue(undefined);
    mockPageContent.mockRejectedValue(mockError);

    const result = await tool.execute({ url: testUrl });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.appendFile).not.toHaveBeenCalled();

    expect(result).toEqual({
      type: 'text',
      content: `Failed to extract URLs: ${mockError}`,
      isError: true,
    });
  });

  it('should handle errors during queue file access when adding to queue', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `<html><body><a href="/docs/3/link1.html">Link 1</a></body></html>`;
    const mockError = new Error('Access denied');
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(mockError); // Simulate access error
    mockFs.writeFile.mockResolvedValue(undefined); // writeFile should still be called if access fails
    mockFs.appendFile.mockResolvedValue(undefined);

    const result = await tool.execute({ url: testUrl, add_to_queue: true });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), ''); // writeFile is called to create the file
    expect(mockFs.appendFile).toHaveBeenCalledTimes(1); // appendFile is called after writeFile

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`Failed to add URLs to queue: ${mockError}`),
        },
      ],
      isError: true,
    });
  });

  it('should handle errors during queue file writing when adding to queue', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `<html><body><a href="/docs/3/link1.html">Link 1</a></body></html>`;
    const mockError = new Error('Write error');
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error('File not found')); // Simulate file not found
    mockFs.writeFile.mockRejectedValue(mockError); // Simulate write error
    mockFs.appendFile.mockResolvedValue(undefined);

    const result = await tool.execute({ url: testUrl, add_to_queue: true });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), '');
    expect(mockFs.appendFile).not.toHaveBeenCalled(); // appendFile should not be called if writeFile fails

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`Failed to add URLs to queue: ${mockError}`),
        },
      ],
      isError: true,
    });
  });

  it('should handle errors during queue file appending when adding to queue', async () => {
    const testUrl = 'http://example.com/docs/3/page.html';
    const mockHtmlContent = `<html><body><a href="/docs/3/link1.html">Link 1</a></body></html>`;
    const mockError = new Error('Append error');
    mockPageContent.mockResolvedValue(mockHtmlContent);
    mockPageGoto.mockResolvedValue(undefined);
    mockFs.access.mockResolvedValue(undefined); // Queue file exists
    mockFs.appendFile.mockRejectedValue(mockError); // Simulate append error

    const result = await tool.execute({ url: testUrl, add_to_queue: true });

    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockBrowserNewPage).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(testUrl, { waitUntil: 'networkidle' });
    expect(mockPageContent).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockFs.access).toHaveBeenCalledWith(expect.stringContaining('queue.txt'));
    expect(mockFs.writeFile).not.toHaveBeenCalled(); // writeFile should not be called if access succeeds
    expect(mockFs.appendFile).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`Failed to add URLs to queue: ${mockError}`),
        },
      ],
      isError: true,
    });
  });
});
