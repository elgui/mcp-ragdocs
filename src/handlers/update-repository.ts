import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

export class UpdateRepositoryHandler extends BaseHandler {
  async handle(args: any): Promise<McpToolResponse> {
    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    const repoName = args.name;
    const configPath = path.join(REPO_CONFIG_DIR, `${repoName}.json`);

    try {
      // Check if the repository config exists
      try {
        await fs.access(configPath);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `Repository not found: ${repoName}`);
      }

      // Read the config
      const configContent = await fs.readFile(configPath, 'utf-8');
      let config = JSON.parse(configContent) as RepositoryConfig;

      // Update config with any provided parameters
      if (args.include) config.include = args.include;
      if (args.exclude) config.exclude = args.exclude;
      if (args.watchMode !== undefined) config.watchMode = args.watchMode;
      if (args.watchInterval) config.watchInterval = args.watchInterval;
      if (args.chunkSize) config.chunkSize = args.chunkSize;
      if (args.fileTypeConfig) config.fileTypeConfig = { ...config.fileTypeConfig, ...args.fileTypeConfig };

      // Check if the repository path exists
      try {
        const stats = await fs.stat(config.path);
        if (!stats.isDirectory()) {
          throw new McpError(ErrorCode.InvalidParams, `Path is not a directory: ${config.path}`);
        }
      } catch (error) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid repository path: ${config.path}`);
      }

      // Save the updated config
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.addRepositoryToConfig(config);

      // Process the repository
      const { chunks, processedFiles, skippedFiles } = await this.processRepository(config);

      // Remove existing repository documents from the vector database
      await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
        filter: {
          must: [
            {
              key: 'repository',
              match: { value: repoName }
            },
            {
              key: 'isRepositoryFile',
              match: { value: true }
            }
          ]
        },
        wait: true
      });

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

      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated repository: ${config.name} (${config.path})\n` +
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
            text: `Failed to update repository: ${error}`,
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

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
