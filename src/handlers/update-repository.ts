import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig, FileIndexMetadata } from '../types.js'; // Import FileIndexMetadata
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { getFileMetadataManager } from '../utils/file-metadata-manager.js'; // Import getFileMetadataManager
import { info, error, warn, debug } from '../utils/logger.js'; // Import debug

const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

export class UpdateRepositoryHandler extends BaseHandler {
  private activeProgressToken: string | number | undefined;

  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    this.activeProgressToken = callContext?.progressToken || callContext?.requestId;

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
      info(`[${config.name}] Repository configuration updated and saved.`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: "Repository configuration updated." });
      }

      // Process the repository
      info(`[${config.name}] Starting to re-process repository files...`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: "Starting to re-process repository files..." });
      }
      const { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata, deletedFileIds } = await this.processRepository(config); // Destructure deletedFileIds
      info(`[${config.name}] Finished re-processing repository files. Found ${chunks.length} chunks from ${processedFiles} processed files (${skippedFiles} skipped).`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: `Finished re-processing files. Found ${chunks.length} chunks.`, percentageComplete: 25 }); // 25% for file processing
      }

      // Remove existing repository documents from the vector database
      console.info(`[${config.name}] Removing existing documents from vector database...`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: "Removing existing documents...", percentageComplete: 50 }); // 50% after deletion
      }
      // Use deletedFileIds to remove specific points
      if (deletedFileIds.length > 0) {
        info(`[${config.name}] Removing ${deletedFileIds.length} deleted files from vector database.`);
        await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
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
         } else {
            info(`[${config.name}] No files processed or deleted. Skipping Qdrant deletion.`);
         }
      }


      // Batch process chunks for better performance
      const batchSize = 100;
      let indexedChunks = 0;
      const totalChunks = chunks.length;

      console.info(`[${config.name}] Starting to generate embeddings and re-index ${totalChunks} chunks...`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: `Starting to generate embeddings for ${totalChunks} chunks...`, percentageComplete: 50 });
      }

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);

        const embeddingResults = await Promise.allSettled(
          batchChunks.map(async (chunk) => {
            try {
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
            await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
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
        if (this.activeProgressToken) {
          (this.server as any).sendProgress(this.activeProgressToken, { message: `Re-processed ${i + batchChunks.length} of ${totalChunks} chunks for embedding/indexing. Successfully re-indexed: ${indexedChunks}.`, percentageComplete });
        }
      }
      info(`[${config.name}] Finished generating embeddings and re-indexing. Total indexed: ${indexedChunks} chunks.`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: `Finished re-indexing ${indexedChunks} chunks.`, percentageComplete: 100 });
      }

      // Set metadata for processed files after successful upsert
      const metadataManager = await getFileMetadataManager();
      for (const metadata of processedFilesMetadata) {
        await metadataManager.setFileMetadata(metadata);
        debug(`[${config.name}] Successfully set metadata for file ID: ${metadata.fileId}`);
      }
      info(`[${config.name}] Successfully updated metadata for ${processedFilesMetadata.length} files.`);


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
    skippedFiles: number,
    filesNeedingUpdate: number, // For files that changed and need re-indexing
    processedFilesMetadata: FileIndexMetadata[], // Add processedFilesMetadata to return type
    deletedFileIds: string[] // Add deletedFileIds to return type
  }> {
    const metadataManager = await getFileMetadataManager(); // Get metadata manager here
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0; // Successfully processed and generated chunks for
    let skippedFiles = 0;   // Skipped due to config, emptiness, or being unchanged
    let filesNeedingUpdate = 0; // Files that were modified and will be re-indexed
    let fileCounter = 0;
    const repositoryId = config.name;
    const processedFilesMetadata: FileIndexMetadata[] = []; // Declare array to store metadata for processed files

    // Load all existing metadata for this repository to compare against current files
    const existingRepoMetadata = await metadataManager.getRepositoryMetadata(repositoryId);
    const allKnownFileIdsInRepo = new Set(existingRepoMetadata ? Object.keys(existingRepoMetadata) : []);

    // Get all files matching the include/exclude patterns
    const files = await glob(config.include, {
      cwd: config.path,
      ignore: config.exclude,
      absolute: true,
      nodir: true,
    });
    const totalFiles = files.length;

    console.info(`[${config.name}] Found ${totalFiles} files to re-process based on include/exclude patterns.`);
    if (this.activeProgressToken) {
      (this.server as any).sendProgress(this.activeProgressToken, { message: `Found ${totalFiles} files to re-process.` });
    }


    const currentFileIdsOnDisk = new Set<string>(); // Initialize set here

    for (const file of files) {
      fileCounter++;
      const relativePath = path.relative(config.path, file);
      const fileId = crypto.createHash('sha256').update(`${repositoryId}:${relativePath}`).digest('hex');
      currentFileIdsOnDisk.add(fileId); // Keep track of files currently on disk

      try {
        const stats = await fs.stat(file);
        if (!stats.isFile()) {
          skippedFiles++;
          continue;
        }
        const lastModifiedTimestamp = stats.mtimeMs;

        const extension = path.extname(file);
        const fileTypeConfig = config.fileTypeConfig[extension];

        if (fileTypeConfig && fileTypeConfig.include === false) {
          debug(`[${repositoryId}] Skipping ${relativePath} due to file type exclusion.`);
          skippedFiles++;
          continue;
        }

        const content = await fs.readFile(file, 'utf-8');
        if (!content.trim()) {
          debug(`[${repositoryId}] Skipping empty file ${relativePath}.`);
          skippedFiles++;
          // If an empty file had metadata, it means it was previously not empty.
          // Treat as a modified file that is now empty.
          const existingMetadata = await metadataManager.getFileMetadata(repositoryId, fileId);
          if (existingMetadata) {
            info(`[${repositoryId}] File ${relativePath} is now empty. Removing its Qdrant entries and metadata.`);
            // TODO: Sub-Task 2: Implement deletion of old chunks from Qdrant for fileId
            // This is where you'd call apiClient.deletePointsByFileId(fileId) or similar
            error(`[${repositoryId}] QDRANT_DELETION_PENDING: File ${relativePath} (ID: ${fileId}) is now empty. Old Qdrant points should be deleted.`);
            await metadataManager.removeFileMetadata(repositoryId, fileId);
            // No new chunks to add, so it's effectively "deleted" from the index.
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
          // This is where you'd call apiClient.deletePointsByFileId(fileId) or similar
          error(`[${repositoryId}] QDRANT_DELETION_PENDING: File ${relativePath} (ID: ${fileId}) was modified. Old Qdrant points should be deleted before re-indexing.`);
          // Deletion of old Qdrant points will happen before upserting new ones in processRepositoryAsync
        } else {
          info(`[${repositoryId}] New file ${relativePath}. Processing.`);
        }

        const language = detectLanguage(file, content);
        const fileChunks = this.chunkFileContent( // Note: This calls the chunkFileContent in UpdateRepositoryHandler
          content,
          file,
          relativePath,
          config,
          language,
          fileTypeConfig?.chunkStrategy || 'line',
          fileId // Pass fileId here
        );

        chunks.push(...fileChunks);
        processedFiles++;

        // Store metadata for files that generated chunks, to be set after successful Qdrant upsert
        const newMetadata: FileIndexMetadata = {
          repositoryId,
          fileId,
          filePath: relativePath,
          lastModifiedTimestamp,
          contentHash,
        };
        processedFilesMetadata.push(newMetadata);


        if (fileCounter % 50 === 0 && fileCounter > 0 && this.activeProgressToken) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 25); // File processing is ~1/4 of the job here
          (this.server as any).sendProgress(this.activeProgressToken, { message: `Re-processed ${fileCounter} of ${totalFiles} files...`, percentageComplete });
          console.info(`[${config.name}] Re-processed ${fileCounter} of ${totalFiles} files... (${processedFiles} successful, ${skippedFiles} skipped/errored)`);
        }
      } catch (err) {
        error(`[${repositoryId}] Error processing file ${relativePath} (File ID: ${fileId}): ${err instanceof Error ? err.message : String(err)}`);
        skippedFiles++; // Count errors as skipped for now
      }
    }
    info(`[${repositoryId}] Completed file re-iteration. Processed: ${processedFiles}, Skipped/Errored: ${skippedFiles}.`);

    // Identify deleted files: files in metadata but not in currentFileIdsOnDisk
    let deletedFilesCount = 0;
    const deletedFileIds: string[] = []; // Collect IDs of deleted files

    for (const knownFileId of allKnownFileIdsInRepo) {
      if (!currentFileIdsOnDisk.has(knownFileId)) {
        const deletedMetadata = await metadataManager.getFileMetadata(repositoryId, knownFileId);
        const deletedFilePath = deletedMetadata?.filePath || 'unknown path';
        info(`[${repositoryId}] File ${deletedFilePath} (ID: ${knownFileId}) deleted from source. Marking for removal from Qdrant and metadata.`);
        deletedFileIds.push(knownFileId); // Add to list for Qdrant deletion
        deletedFilesCount++;
      }
    }
    info(`[${repositoryId}] Files deleted from source: ${deletedFilesCount}.`);


    return { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata, deletedFileIds }; // Return deletedFileIds
  }

  private chunkFileContent(
    content: string,
    filePath: string,
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string,
    fileId: string // Add fileId parameter
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
      fileId, // Include fileId in the chunk
      repository: config.name, // Add repository name
      isRepositoryFile: true,  // Mark as repository file
      domain: 'docs' as 'code' | 'docs', // Default to docs for non-code files
      lines: [0, 0] as [number, number], // We don't have line numbers for these chunks
      // commit_sha is not available here, will need to be added in processRepository if needed
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
