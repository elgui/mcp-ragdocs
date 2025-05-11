import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { glob } from 'glob';
import { fileTypeFromFile } from 'file-type';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const COLLECTION_NAME = 'documentation';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_CONFIG_DIR = path.join(__dirname, '..', 'repo-configs');
const DEFAULT_CHUNK_SIZE = 1000;

export class LocalRepositoryHandler extends BaseHandler {
  async handle(args: any): Promise<McpToolResponse> {
    // Validate required parameters
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository path is required');
    }

    // Normalize the repository path
    const repoPath = path.resolve(args.path);

    // Check if the repository path exists
    try {
      const stats = await fs.stat(repoPath);
      if (!stats.isDirectory()) {
        throw new McpError(ErrorCode.InvalidParams, `Path is not a directory: ${repoPath}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid repository path: ${repoPath}`);
    }

    // Create repository configuration
    const config: RepositoryConfig = {
      path: repoPath,
      name: args.name || path.basename(repoPath),
      include: args.include || ['**/*'],
      exclude: args.exclude || [
        '**/node_modules/**',
        '**/.git/**',
        '**/build/**',
        '**/dist/**',
        '**/*.min.js',
        '**/*.map',
        '**/package-lock.json',
        '**/yarn.lock'
      ],
      watchMode: args.watchMode || false,
      watchInterval: args.watchInterval || 60000, // Default: 1 minute
      chunkSize: args.chunkSize || DEFAULT_CHUNK_SIZE,
      fileTypeConfig: args.fileTypeConfig || {
        // Default file type configurations
        '.js': { include: true, chunkStrategy: 'semantic' },
        '.ts': { include: true, chunkStrategy: 'semantic' },
        '.jsx': { include: true, chunkStrategy: 'semantic' },
        '.tsx': { include: true, chunkStrategy: 'semantic' },
        '.py': { include: true, chunkStrategy: 'semantic' },
        '.java': { include: true, chunkStrategy: 'semantic' },
        '.md': { include: true, chunkStrategy: 'semantic' },
        '.txt': { include: true, chunkStrategy: 'line' },
        '.json': { include: true, chunkStrategy: 'semantic' },
        '.html': { include: true, chunkStrategy: 'semantic' },
        '.css': { include: true, chunkStrategy: 'semantic' },
        '.scss': { include: true, chunkStrategy: 'semantic' },
        '.xml': { include: true, chunkStrategy: 'semantic' },
        '.yaml': { include: true, chunkStrategy: 'semantic' },
        '.yml': { include: true, chunkStrategy: 'semantic' },
      }
    };

    try {
      // Save the repository configuration
      await this.saveRepositoryConfig(config);

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.addRepositoryToConfig(config);

      // Process the repository
      const { chunks, processedFiles, skippedFiles } = await this.processRepository(config);

      // Batch process chunks for better performance
      const batchSize = 100;
      let indexedChunks = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const points = await Promise.all(
          batch.map(async (chunk) => {
            const embedding = await this.apiClient.getEmbeddings(chunk.text);
            return {
              id: this.generatePointId(),
              vector: embedding,
              payload: {
                ...chunk,
                _type: 'DocumentChunk' as const,
                repository: config.name,
                isRepositoryFile: true,
              } as Record<string, unknown>,
            };
          })
        );

        await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
          wait: true,
          points,
        });

        indexedChunks += batch.length;
      }

      // If watch mode is enabled, start the watcher
      if (config.watchMode) {
        // This would be implemented in a separate class
        // this.startRepositoryWatcher(config);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully indexed repository: ${config.name} (${repoPath})\n` +
                  `Processed ${processedFiles} files, skipped ${skippedFiles} files\n` +
                  `Created ${chunks.length} chunks, indexed ${indexedChunks} chunks\n` +
                  `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to index repository: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async processRepository(config: RepositoryConfig): Promise<{
    chunks: DocumentChunk[],
    processedFiles: number,
    skippedFiles: number
  }> {
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0;
    let skippedFiles = 0;

    // Get all files matching the include/exclude patterns
    const files = await glob(config.include, {
      cwd: config.path,
      ignore: config.exclude,
      absolute: true,
      nodir: true,
    });

    for (const file of files) {
      try {
        const relativePath = path.relative(config.path, file);
        const extension = path.extname(file);
        const fileTypeConfig = config.fileTypeConfig[extension];

        // Skip files that should be excluded based on file type config
        if (fileTypeConfig && fileTypeConfig.include === false) {
          skippedFiles++;
          continue;
        }

        // Read file content
        const content = await fs.readFile(file, 'utf-8');

        // Skip empty files
        if (!content.trim()) {
          skippedFiles++;
          continue;
        }

        // Detect language for better processing
        const language = detectLanguage(file, content);

        // Process the file content into chunks
        const fileChunks = this.chunkFileContent(
          content,
          file,
          relativePath,
          config,
          language,
          fileTypeConfig?.chunkStrategy || 'line'
        );

        chunks.push(...fileChunks);
        processedFiles++;
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
        skippedFiles++;
      }
    }

    return { chunks, processedFiles, skippedFiles };
  }

  private chunkFileContent(
    content: string,
    filePath: string,
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const timestamp = new Date().toISOString();
    const fileUrl = `file://${filePath}`;
    const title = `${config.name}/${relativePath}`;

    // Different chunking strategies based on file type
    let textChunks: string[] = [];

    switch (chunkStrategy) {
      case 'semantic':
        // For semantic chunking, we'd ideally use a more sophisticated approach
        // For now, we'll use a simple paragraph-based approach
        textChunks = this.chunkByParagraphs(content, config.chunkSize);
        break;
      case 'line':
        // Chunk by lines, respecting max chunk size
        textChunks = this.chunkByLines(content, config.chunkSize);
        break;
      default:
        // Default to simple text chunking
        textChunks = this.chunkText(content, config.chunkSize);
    }

    // Create document chunks with metadata
    chunks.push(...textChunks.map((text, index) => ({
      text,
      url: fileUrl,
      title,
      timestamp,
      filePath: relativePath,
      language,
      chunkIndex: index,
      totalChunks: textChunks.length,
    })));

    return chunks;
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
      currentChunk.push(word);
      const currentLength = currentChunk.join(' ').length;

      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  private chunkByLines(text: string, maxChunkSize: number): string[] {
    const lines = text.split(/\r?\n/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for the newline

      if (currentLength + lineLength > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(line);
      currentLength += lineLength;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return chunks;
  }

  private chunkByParagraphs(text: string, maxChunkSize: number): string[] {
    // Split by double newlines (paragraphs)
    const paragraphs = text.split(/\r?\n\r?\n/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length + 2; // +2 for the double newline

      if (currentLength + paragraphLength > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(paragraph);
      currentLength += paragraphLength;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
    }

    return chunks;
  }

  private async saveRepositoryConfig(config: RepositoryConfig): Promise<void> {
    // Ensure the config directory exists
    try {
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating repository config directory:', error);
      throw new McpError(ErrorCode.InternalError, 'Failed to create repository config directory');
    }

    // Save the config file
    const configPath = path.join(REPO_CONFIG_DIR, `${config.name}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
