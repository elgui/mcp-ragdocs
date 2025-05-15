import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig, FileIndexMetadata } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { getFileMetadataManager } from '../utils/file-metadata-manager.js';
import { info, error, warn, debug } from '../utils/logger.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';


const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

export class UpdateRepositoryEnhancedTool extends EnhancedBaseTool {
  get definition() {
    return {
      name: 'update_repository',
      description: 'Updates an existing documentation repository configuration and re-indexes its content.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the repository to update.',
          },
          include: {
            type: 'string',
            description: 'Glob pattern for files to include (overwrites existing).',
            nullable: true,
          },
          exclude: {
            type: 'string',
            description: 'Glob pattern for files to exclude (overwrites existing).',
            nullable: true,
          },
          watchMode: {
            type: 'boolean',
            description: 'Enable or disable watch mode for the repository.',
            nullable: true,
          },
          watchInterval: {
            type: 'number',
            description: 'Interval in milliseconds for watching files (if watchMode is true).',
            nullable: true,
          },
          chunkSize: {
            type: 'number',
            description: 'Maximum size of text chunks for indexing.',
            nullable: true,
          },
          fileTypeConfig: {
            type: 'object',
            description: 'Configuration for specific file types (e.g., chunking strategy).',
            additionalProperties: {
              type: 'object',
              properties: {
                include: { type: 'boolean', nullable: true },
                chunkStrategy: { type: 'string', nullable: true },
              },
            },
            nullable: true,
          },
        },
        required: ['name'],
      },
    };
  }

  constructor(options?: { apiClient?: ApiClient, server?: any }) {
    super(options);
  }


  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    const activeProgressToken = callContext?.progressToken || callContext?.requestId;

    const apiClient = this.apiClient;
    if (!apiClient) {
      throw new Error('API client is required for UpdateRepositoryEnhancedTool');
    }
    const server = this.server;
     if (!server) {
      throw new Error('Server instance is required for UpdateRepositoryEnhancedTool to send progress');
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
      if (args.include !== undefined) config.include = args.include;
      if (args.exclude !== undefined) config.exclude = args.exclude;
      if (args.watchMode !== undefined) config.watchMode = args.watchMode;
      if (args.watchInterval !== undefined) config.watchInterval = args.watchInterval;
      if (args.chunkSize !== undefined) config.chunkSize = args.chunkSize;
      if (args.fileTypeConfig !== undefined) config.fileTypeConfig = { ...config.fileTypeConfig, ...args.fileTypeConfig };

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
      const configLoader = new RepositoryConfigLoader(server, apiClient);
      await configLoader.addRepositoryToConfig(config);
      info(`[${config.name}] Repository configuration updated and saved.`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: "Repository configuration updated." });
      }

      // Process the repository
      info(`[${config.name}] Starting to re-process repository files...`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: "Starting to re-process repository files..." });
      }
      const { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata, deletedFileIds } = await this.processRepository(config, activeProgressToken);
      info(`[${config.name}] Finished re-processing repository files. Found ${chunks.length} chunks from ${processedFiles} processed files (${skippedFiles} skipped).`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: `Finished re-processing files. Found ${chunks.length} chunks.`, percentageComplete: 25 }); // 25% for file processing
      }

      // Remove existing repository documents from the vector database
      info(`[${config.name}] Removing existing documents from vector database...`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: "Removing existing documents...", percentageComplete: 50 }); // 50% after deletion
      }
      // Use deletedFileIds to remove specific points
      if (deletedFileIds.length > 0) {
        info(`[${config.name}] Removing ${deletedFileIds.length} deleted files from vector database.`);
        await apiClient.qdrantClient.delete(COLLECTION_NAME, {
          filter: {
            must: [
              {
                key: 'fileId',
                match: { any: deletedFileIds }
              }
            ]
          },
          wait: true
        });
      } else {
         // If no files were deleted, still remove existing documents for updated files
         // This logic might need refinement based on how updates are handled (delete old then add new)
         // For now, keeping the broad delete for the repository if no specific files were marked as deleted
         // but files were processed (meaning some were updated).
         if (processedFiles > 0) {
            info(`[${config.name}] No files marked as deleted, but ${processedFiles} files were processed. Removing all existing documents for the repository before re-indexing.`);
             await apiClient.qdrantClient.delete(COLLECTION_NAME, {
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
         } else {
            info(`[${config.name}] No files processed or deleted. Skipping Qdrant deletion.`);
         }
      }


      // Batch process chunks for better performance
      const batchSize = 100;
      let indexedChunks = 0;
      const totalChunks = chunks.length;

      info(`[${config.name}] Starting to generate embeddings and re-index ${totalChunks} chunks...`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: `Starting to generate embeddings for ${totalChunks} chunks...`, percentageComplete: 50 });
      }

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);

        const embeddingResults = await Promise.allSettled(
          batchChunks.map(async (chunk) => {
            try {
              // Ensure apiClient is not undefined before calling getEmbeddings
              if (!apiClient) {
                 throw new Error('API client is not available for embedding generation.');
              }
              const embedding = await apiClient.getEmbeddings(chunk.text);
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
            } catch (embeddingError) {
              error(`[${config.name}] Failed to generate embedding for chunk from ${chunk.filePath || chunk.url} during update: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
              throw embeddingError; // Re-throw to be caught by Promise.allSettled
            }
          })
        );

        const successfulPoints = embeddingResults
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<any>).value);

        const failedEmbeddingsCount = embeddingResults.filter(result => result.status === 'rejected').length;
        if (failedEmbeddingsCount > 0) {
            warn(`[${config.name}] Failed to generate embeddings for ${failedEmbeddingsCount} of ${batchChunks.length} chunks in this batch during update.`);
        }

        if (successfulPoints.length > 0) {
          try {
            await apiClient.qdrantClient.upsert(COLLECTION_NAME, {
              wait: true,
              points: successfulPoints,
            });
            indexedChunks += successfulPoints.length;
          } catch (upsertError) {
            error(`[${config.name}] Failed to upsert batch of ${successfulPoints.length} points to Qdrant during update: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`);
          }
        }

        const percentageComplete = 50 + Math.round(((i + batchChunks.length) / totalChunks) * 50); // Remaining 50% for indexing
        info(`[${config.name}] Re-processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalChunks / batchSize)}. Successfully re-indexed in this batch: ${successfulPoints.length}. Total re-indexed so far: ${indexedChunks} chunks.`);
        if (activeProgressToken) {
          (server as any).sendProgress(activeProgressToken, { message: `Re-processed ${i + batchChunks.length} of ${totalChunks} chunks for embedding/indexing. Successfully re-indexed: ${indexedChunks}.`, percentageComplete });
        }
      }
      info(`[${config.name}] Finished generating embeddings and re-indexing. Total indexed: ${indexedChunks} chunks.`);
      if (activeProgressToken) {
        (server as any).sendProgress(activeProgressToken, { message: `Finished re-indexing ${indexedChunks} chunks.`, percentageComplete: 100 });
      }

      // Set metadata for processed files after successful upsert
      const metadataManager = await getFileMetadataManager();
      for (const metadata of processedFilesMetadata) {
        await metadataManager.setFileMetadata(metadata);
        debug(`[${config.name}] Successfully set metadata for file ID: ${metadata.fileId}`);
      }
      info(`[${config.name}] Successfully updated metadata for ${processedFilesMetadata.length} files.`);


      return this.formatTextResponse(
        `Successfully updated repository: ${config.name} (${config.path})\n` +
        `Processed ${processedFiles} files, skipped ${skippedFiles} files\n` +
        `Created ${chunks.length} chunks, indexed ${indexedChunks} chunks\n` +
        `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.handleError(`Failed to update repository: ${error}`);
    }
  }

  private async processRepository(config: RepositoryConfig, activeProgressToken?: string | number): Promise<{
    chunks: DocumentChunk[],
    processedFiles: number,
    skippedFiles: number,
    filesNeedingUpdate: number,
    processedFilesMetadata: FileIndexMetadata[],
    deletedFileIds: string[]
  }> {
    const metadataManager = await getFileMetadataManager();
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0;
    let skippedFiles = 0;
    let filesNeedingUpdate = 0;
    let fileCounter = 0;
    const repositoryId = config.name;
    const processedFilesMetadata: FileIndexMetadata[] = [];

    const existingRepoMetadata = await metadataManager.getRepositoryMetadata(repositoryId);
    const allKnownFileIdsInRepo = new Set(existingRepoMetadata ? Object.keys(existingRepoMetadata) : []);

    const files = await glob(config.include, {
      cwd: config.path,
      ignore: config.exclude,
      absolute: true,
      nodir: true,
    });
    const totalFiles = files.length;

    info(`[${config.name}] Found ${totalFiles} files to re-process based on include/exclude patterns.`);
    if (activeProgressToken) {
      (this.server as any).sendProgress(activeProgressToken, { message: `Found ${totalFiles} files to re-process.` });
    }

    const currentFileIdsOnDisk = new Set<string>();

    for (const file of files) {
      fileCounter++;
      const relativePath = path.relative(config.path, file);
      const fileId = crypto.createHash('sha256').update(`${repositoryId}:${relativePath}`).digest('hex');
      currentFileIdsOnDisk.add(fileId);

      try {
        const stats = await fs.stat(file);
        if (!stats.isFile()) {
          skippedFiles++;
          continue;
        }
        const lastModifiedTimestamp = stats.mtimeMs;

        const extension = path.extname(file);
        const fileTypeConfig = config.fileTypeConfig?.[extension];

        // Check if fileTypeConfig exists before accessing its properties
        if (fileTypeConfig && fileTypeConfig.include === false) {
          debug(`[${repositoryId}] Skipping ${relativePath} due to file type exclusion.`);
          skippedFiles++;
          continue;
        }

        const content = await fs.readFile(file, 'utf-8');
        if (!content.trim()) {
          debug(`[${repositoryId}] Skipping empty file ${relativePath}.`);
          skippedFiles++;
          const existingMetadata = await metadataManager.getFileMetadata(repositoryId, fileId);
          if (existingMetadata) {
            info(`[${repositoryId}] File ${relativePath} is now empty. Removing its Qdrant entries and metadata.`);
            // TODO: Sub-Task 2: Implement deletion of old chunks from Qdrant for fileId
            error(`[${repositoryId}] QDRANT_DELETION_PENDING: File ${relativePath} (ID: ${fileId}) is now empty. Old Qdrant points should be deleted.`);
            await metadataManager.removeFileMetadata(repositoryId, fileId);
          }
          continue;
        }

        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        const existingMetadata = await metadataManager.getFileMetadata(repositoryId, fileId);

        if (existingMetadata && existingMetadata.contentHash === contentHash && existingMetadata.lastModifiedTimestamp === lastModifiedTimestamp) {
          debug(`[${repositoryId}] File ${relativePath} is unchanged. Skipping.`);
          skippedFiles++;
          continue;
        }

        if (existingMetadata) {
          info(`[${repositoryId}] File ${relativePath} has changed. Marking for update.`);
          filesNeedingUpdate++;
          // TODO: Sub-Task 2: Implement deletion of old chunks from Qdrant for fileId
          error(`[${repositoryId}] QDRANT_DELETION_PENDING: File ${relativePath} (ID: ${fileId}) was modified. Old Qdrant points should be deleted before re-indexing.`);
        } else {
          info(`[${repositoryId}] New file ${relativePath}. Processing.`);
        }

        const language = detectLanguage(file, content);
        const fileChunks = this.chunkFileContent(
          content,
          file,
          relativePath,
          config,
          language,
          fileTypeConfig?.chunkStrategy || 'line',
          fileId
        );

        chunks.push(...fileChunks);

        processedFiles++;

        const newMetadata: FileIndexMetadata = {
          repositoryId,
          fileId,
          filePath: relativePath,
          lastModifiedTimestamp,
          contentHash,
        };
        processedFilesMetadata.push(newMetadata);


        if (fileCounter % 50 === 0 && fileCounter > 0 && activeProgressToken) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 25);
          (this.server as any).sendProgress(activeProgressToken, { message: `Re-processed ${fileCounter} of ${totalFiles} files...`, percentageComplete });
          info(`[${config.name}] Re-processed ${fileCounter} of ${totalFiles} files... (${processedFiles} successful, ${skippedFiles} skipped/errored)`);
        }
      } catch (err) {
        error(`[${repositoryId}] Error processing file ${relativePath} (File ID: ${fileId}): ${err instanceof Error ? err.message : String(err)}`);
        skippedFiles++;
      }
    }
    info(`[${repositoryId}] Completed file re-iteration. Processed: ${processedFiles}, Skipped/Errored: ${skippedFiles}.`);

    const deletedFileIds: string[] = [];
    for (const knownFileId of allKnownFileIdsInRepo) {
      if (!currentFileIdsOnDisk.has(knownFileId)) {
        const deletedMetadata = await metadataManager.getFileMetadata(repositoryId, knownFileId);
        const deletedFilePath = deletedMetadata?.filePath || 'unknown path';
        info(`[${repositoryId}] File ${deletedFilePath} (ID: ${knownFileId}) deleted from source. Marking for removal from Qdrant and metadata.`);
        deletedFileIds.push(knownFileId);
      }
    }
    info(`[${repositoryId}] Files deleted from source: ${deletedFileIds.length}.`);


    return { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata, deletedFileIds };
  }

  private chunkFileContent(
    content: string,
    filePath: string,
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string,
    fileId: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const timestamp = new Date().toISOString();
    const fileUrl = `file://${filePath}`;
    const title = `${config.name}/${relativePath}`;

    let textChunks: string[] = [];

    switch (chunkStrategy) {
      case 'semantic':
        textChunks = this.chunkByParagraphs(content, config.chunkSize);
        break;
      case 'line':
        textChunks = this.chunkByLines(content, config.chunkSize);
        break;
      default:
        textChunks = this.chunkText(content, config.chunkSize);
    }

    chunks.push(...textChunks.map((text, index) => ({
      text,
      url: fileUrl,
      title,
      timestamp,
      filePath: relativePath,
      language,
      chunkIndex: index,
      totalChunks: textChunks.length,
      fileId,
      repository: config.name,
      isRepositoryFile: true,
      domain: 'docs' as 'code' | 'docs',
      lines: [0, 0] as [number, number],
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
      const lineLength = line.length + 1;

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
    const paragraphs = text.split(/\r?\n\r?\n/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length + 2;

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
