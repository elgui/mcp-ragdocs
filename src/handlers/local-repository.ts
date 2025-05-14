import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig, IndexingStatus, FileIndexMetadata } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { glob } from 'glob';
// import { fileTypeFromFile } from 'file-type'; // file-type might not be needed if we rely on extensions
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { IndexingStatusManager } from '../utils/indexing-status-manager.js';
import { getFileMetadataManager } from '../utils/file-metadata-manager.js';
import { RepositoryWatcher } from '../utils/repository-watcher.js'; // Import RepositoryWatcher
import { info, error, debug } from '../utils/logger.js';
import { parseCodeFile } from '../utils/ast-parser.js';
import { splitTextByTokens } from '../utils/token-counter.js';
import { getCurrentCommitSha } from '../utils/git-utils.js';

const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');
const DEFAULT_CHUNK_SIZE = 1000;

export class LocalRepositoryHandler extends BaseHandler {
  private activeProgressToken: string | number | undefined;
  private statusManager: IndexingStatusManager;
  private repositoryConfig: RepositoryConfig | undefined; // Add property to store config
  // Track active indexing processes
  private static activeIndexingProcesses: Map<string, boolean> = new Map();
  // Smaller batch size to reduce processing time per batch
  private static BATCH_SIZE = 50;

  constructor(server: any, apiClient: any) {
    super(server, apiClient);
    this.statusManager = new IndexingStatusManager();
  }

  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    this.activeProgressToken = callContext?.progressToken || callContext?.requestId;

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
    } catch (err) {
      error(`Invalid repository path: ${repoPath}. Error: ${err instanceof Error ? err.message : String(err)}`);
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

    this.repositoryConfig = config; // Assign config to class property

    try {
      // Check if indexing is already in progress for this repository
      if (LocalRepositoryHandler.activeIndexingProcesses.has(config.name)) {
        // Get current status
        const status = await this.statusManager.getStatus(config.name);
        if (status && status.status === 'processing') {
          return {
            content: [
              {
                type: 'text',
                text: `Repository indexing already in progress for ${config.name}.\n` +
                      `Current progress: ${status.percentageComplete || 0}%\n` +
                      `Files processed: ${status.processedFiles || 0} of ${status.totalFiles || 'unknown'}\n` +
                      `Chunks indexed: ${status.indexedChunks || 0} of ${status.totalChunks || 'unknown'}\n` +
                      `Started at: ${new Date(status.startTime).toLocaleString()}`
              },
            ],
          };
        }
      }

      // Save the repository configuration
      await this.saveRepositoryConfig(config);

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.addRepositoryToConfig(config);
      info(`[${config.name}] Repository configuration saved and loaded.`);
      if (this.activeProgressToken) {
        (this.server as any).sendProgress(this.activeProgressToken, { message: "Repository configuration saved." });
      }

      // Create initial status
      await this.statusManager.createStatus(config.name);

      // Start the indexing process asynchronously
      await this.processRepositoryAsync(config, this.activeProgressToken);

      return {
        content: [
          {
            type: 'text',
            text: `Repository configuration saved for ${config.name} (${repoPath}).\n` +
                  `Indexing has started in the background and will continue after this response.\n` +
                  `You can check the status using the 'get_indexing_status' tool with parameter name="${config.name}".\n` +
                  `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`
          },
        ],
      };
    } catch (err) {
      error(`Failed to index repository: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof McpError) {
        throw err;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to index repository. Check logs for details.`,
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
    processedFilesMetadata: FileIndexMetadata[] // Add processedFilesMetadata to return type
  }> {
    const metadataManager = await getFileMetadataManager();
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0; // Successfully processed and generated chunks for
    let skippedFiles = 0;   // Skipped due to config, emptiness, or being unchanged
    let filesNeedingUpdate = 0; // Files that were modified and will be re-indexed
    let deletedFilesCount = 0; // Files found in metadata but not in the current scan
    let fileCounter = 0;
    const repositoryId = config.name;
    const processedFilesMetadata: FileIndexMetadata[] = []; // Declare array to store metadata for processed files

    // Load all existing metadata for this repository to compare against current files
    const existingRepoMetadata = await metadataManager.getRepositoryMetadata(repositoryId);
    const allKnownFileIdsInRepo = new Set(existingRepoMetadata ? Object.keys(existingRepoMetadata) : []);

    const files = await glob(config.include, {
      cwd: config.path,
      ignore: config.exclude,
      absolute: true,
      nodir: true,
    });
    const totalFiles = files.length; // This is the count of files currently on disk

    info(`[${repositoryId}] Found ${totalFiles} files on disk to process based on include/exclude patterns.`);
    if (this.activeProgressToken) {
      (this.server as any).sendProgress(this.activeProgressToken, { message: `Found ${totalFiles} files on disk to process.` });
    }

    const currentFileIdsOnDisk = new Set<string>();

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
        const fileChunks = await this.chunkFileContent(
          content,
          file,
          relativePath,
          config,
          language,
          fileTypeConfig?.chunkStrategy || 'line',
          fileId // Pass fileId to chunkFileContent
        );

        chunks.push(...fileChunks);
        processedFiles++;

        // Update metadata after successful processing of the file's content into chunks
        const newMetadata: FileIndexMetadata = {
          repositoryId,
          fileId,
          filePath: relativePath,
          lastModifiedTimestamp,
          contentHash,
        };
        // DO NOT set metadata here. Metadata is set AFTER successful Qdrant upsert in processRepositoryAsync.
        // await metadataManager.setFileMetadata(newMetadata); // Removed this line

        // Store metadata for files that generated chunks, to be set after Qdrant upsert
        processedFilesMetadata.push(newMetadata);

        if (fileCounter % 50 === 0 && fileCounter > 0 && this.activeProgressToken) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 33);
          (this.server as any).sendProgress(this.activeProgressToken, { message: `Scanned ${fileCounter} of ${totalFiles} files...`, percentageComplete });
          info(`[${repositoryId}] Scanned ${fileCounter} of ${totalFiles} files... (${processedFiles} to process/update, ${skippedFiles} skipped)`);
        }
      } catch (err) {
        error(`[${repositoryId}] Error processing file ${relativePath} (File ID: ${fileId}): ${err instanceof Error ? err.message : String(err)}`);
        skippedFiles++; // Count errors as skipped for now
      }
    }

    // Identify deleted files: files in metadata but not in currentFileIdsOnDisk
    for (const knownFileId of allKnownFileIdsInRepo) {
      if (!currentFileIdsOnDisk.has(knownFileId)) {
        const deletedMetadata = await metadataManager.getFileMetadata(repositoryId, knownFileId);
        const deletedFilePath = deletedMetadata?.filePath || 'unknown path';
        info(`[${repositoryId}] File ${deletedFilePath} (ID: ${knownFileId}) deleted from source. Removing from Qdrant and metadata.`);
        // TODO: Sub-Task 2: Implement deletion of chunks from Qdrant for knownFileId
        // This is where you'd call apiClient.deletePointsByFileId(knownFileId) or similar
        error(`[${repositoryId}] QDRANT_DELETION_PENDING: File ${deletedFilePath} (ID: ${knownFileId}) was deleted. Qdrant points should be removed.`);
        await metadataManager.removeFileMetadata(repositoryId, knownFileId);
        deletedFilesCount++;
      }
    }

    info(`[${repositoryId}] Completed file scan. New/Modified files to process: ${processedFiles}. Files skipped (unchanged/excluded/empty/error): ${skippedFiles}. Files deleted: ${deletedFilesCount}.`);
    // Return processedFilesMetadata along with chunks
    return { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata }; // `deletedFilesCount` is handled, not returned directly to async processor yet
  }

  private async chunkFileContent(
    content: string,
    filePath: string, // full absolute path
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string,
    fileId: string // Added fileId
  ): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const timestamp = new Date().toISOString();
    const fileUrl = `file://${filePath}`; // URL for the absolute file path
    const title = `${config.name}/${relativePath}`; // Title using repository name and relative path
    const extension = path.extname(filePath).toLowerCase();

    // Get the current commit SHA
    const commitSha = await getCurrentCommitSha(config.path);

    // Check if this is a code file that should be parsed with AST
    const isCodeFile = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php'].includes(extension);

    if (isCodeFile && chunkStrategy === 'semantic') {
      // Parse the code file to extract docstrings and code structure
      const codeChunks = parseCodeFile(filePath, content);

      // Process each code chunk
      for (const codeChunk of codeChunks) {
        // If the chunk has a docstring, create a chunk for it
        if (codeChunk.docstring) {
          const docstringText = codeChunk.docstring.trim();

          if (docstringText) {
            // Create a fully-qualified symbol name
            const symbolName = codeChunk.parent
              ? `${codeChunk.parent}.${codeChunk.symbolName}`
              : codeChunk.symbolName;

            // Prefix the docstring with the symbol name for context
            const prefixedDocstring = `${symbolName}: ${docstringText}`;

            // Split docstring into smaller chunks if needed (200-400 tokens)
            const docstringChunks = splitTextByTokens(prefixedDocstring, 200, 400, false);

            // Create a chunk for each docstring part
            docstringChunks.forEach((text) => {
              chunks.push({
                text,
                url: fileUrl,
                title,
                timestamp,
                filePath: relativePath,
                language,
                chunkIndex: chunks.length,
                totalChunks: -1, // Will be updated later
                repository: config.name,
                isRepositoryFile: true,
                fileId,
                symbol: symbolName,
                domain: 'docs' as 'code' | 'docs',
                lines: [codeChunk.startLine, codeChunk.endLine] as [number, number],
                commit_sha: commitSha
              });
            });
          }
        }

        // Only include code chunks if they have an associated docstring
        // This ensures we focus on documented code
        if (codeChunk.docstring) {
          const codeText = codeChunk.text.trim();

          if (codeText) {
            // Create a fully-qualified symbol name
            const symbolName = codeChunk.parent
              ? `${codeChunk.parent}.${codeChunk.symbolName}`
              : codeChunk.symbolName;

            // Split code into smaller chunks if needed (200-400 tokens)
            const codeTextChunks = splitTextByTokens(codeText, 200, 400, true);

            // Create a chunk for each code part
            codeTextChunks.forEach((text) => {
              chunks.push({
                text,
                url: fileUrl,
                title,
                timestamp,
                filePath: relativePath,
                language,
                chunkIndex: chunks.length,
                totalChunks: -1, // Will be updated later
                repository: config.name,
                isRepositoryFile: true,
                fileId,
                symbol: symbolName,
                domain: 'code' as 'code' | 'docs',
                lines: [codeChunk.startLine, codeChunk.endLine] as [number, number],
                commit_sha: commitSha
              });
            });
          }
        }
      }

      // If no chunks were created (no docstrings found), create a single chunk for the module
      if (chunks.length === 0) {
        // Look for a module-level docstring
        const moduleChunk = codeChunks.find(chunk => chunk.symbolName === '__module__' && chunk.docstring);

        if (moduleChunk && moduleChunk.docstring) {
          // Use the module docstring
          chunks.push({
            text: moduleChunk.docstring,
            url: fileUrl,
            title,
            timestamp,
            filePath: relativePath,
            language,
            chunkIndex: 0,
            totalChunks: 1,
            repository: config.name,
            isRepositoryFile: true,
            fileId,
            symbol: path.basename(relativePath),
            domain: 'docs' as 'code' | 'docs',
            lines: [moduleChunk.startLine, moduleChunk.endLine] as [number, number],
            commit_sha: commitSha
          });
        } else {
          // Create a minimal chunk with file info
          chunks.push({
            text: `File: ${relativePath}`,
            url: fileUrl,
            title,
            timestamp,
            filePath: relativePath,
            language,
            chunkIndex: 0,
            totalChunks: 1,
            repository: config.name,
            isRepositoryFile: true,
            fileId,
            symbol: path.basename(relativePath),
            domain: 'docs' as 'code' | 'docs',
            lines: [1, 1] as [number, number],
            commit_sha: commitSha
          });
        }
      } else {
        // Update totalChunks for all chunks
        const totalChunks = chunks.length;
        chunks.forEach(chunk => {
          chunk.totalChunks = totalChunks;
        });
      }

      return chunks;
    }

    // For non-code files or if not using semantic chunking, use the original approach
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
      url: fileUrl, // Store the absolute file path as URL
      title,
      timestamp,
      filePath: relativePath, // Store relative path in filePath field
      language,
      chunkIndex: index,
      totalChunks: textChunks.length,
      repository: config.name, // Add repository name
      isRepositoryFile: true,  // Mark as repository file
      fileId, // Add fileId to each chunk
      domain: 'docs' as 'code' | 'docs', // Default to docs for non-code files
      lines: [0, 0] as [number, number], // We don't have line numbers for these chunks
      commit_sha: commitSha
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
    } catch (err) {
      error(`Error creating repository config directory: ${err instanceof Error ? err.message : String(err)}`);
      throw new McpError(ErrorCode.InternalError, 'Failed to create repository config directory');
    }

    // Save the config file
    const configPath = path.join(REPO_CONFIG_DIR, `${config.name}.json`);
    info(`[${config.name}] Attempting to save repository config to: ${configPath}`);
    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      info(`[${config.name}] Successfully saved repository config to: ${configPath}`);
    } catch (writeErr) {
      error(`[${config.name}] Error saving repository config to ${configPath}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
      throw new McpError(ErrorCode.InternalError, `Failed to save repository config: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
    }
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Process repository asynchronously to avoid MCP timeout
   */
  private async processRepositoryAsync(config: RepositoryConfig, _progressToken?: string | number): Promise<void> {
    const repositoryId = config.name;
    try {
      LocalRepositoryHandler.activeIndexingProcesses.set(repositoryId, true);
      await this.statusManager.updateStatus({
        repositoryName: repositoryId,
        status: 'processing'
      });

      info(`[${repositoryId}] Starting to process repository files asynchronously...`);
      const metadataManager = await getFileMetadataManager(); // Get metadata manager here

      // Process the repository files, check metadata, calculate hashes
      const { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata } = await this.processRepository(config);
      // `processedFiles` now means files that generated new chunks (new or updated)
      // `skippedFiles` means files that were unchanged, excluded by config, or empty/errored.

      // TODO: Sub-Task 2: Before upserting, delete points from Qdrant for `filesNeedingUpdate`
      // This needs careful handling. If a file was updated, its old chunks (associated with its fileId)
      // must be deleted from Qdrant. This should happen *before* new chunks are added.
      // For now, this is a placeholder. The actual deletion logic will be added in Sub-Task 2.
      if (filesNeedingUpdate > 0) {
        info(`[${repositoryId}] ${filesNeedingUpdate} files were modified and their old Qdrant entries should be deleted before re-indexing.`);
        // Placeholder for Qdrant deletion logic based on fileIds of updated files.
        // This would involve iterating through the files identified as "updated" during processRepository,
        // collecting their fileIds, and then calling a Qdrant delete operation with a filter for those fileIds.
      }


      await this.statusManager.updateStatus({
        repositoryName: repositoryId,
        totalFiles: processedFiles + skippedFiles, // Total files scanned
        processedFiles, // Files that resulted in new/updated chunks
        skippedFiles,   // Unchanged, excluded, empty, errored
        totalChunks: chunks.length, // Chunks from new/updated files
        percentageComplete: 33 // Mark file scanning phase as 33%
      });

      info(`[${repositoryId}] File scanning complete. New/updated files processed: ${processedFiles}. Files skipped: ${skippedFiles}. Total chunks to index: ${chunks.length}.`);

      // Batch process chunks with smaller batch size for better responsiveness
      const batchSize = LocalRepositoryHandler.BATCH_SIZE;
      let indexedChunks = 0;
      const totalChunks = chunks.length;
      const totalBatches = Math.ceil(totalChunks / batchSize);

      info(`[${config.name}] Starting to generate embeddings and index ${totalChunks} chunks in ${totalBatches} batches...`);

      const COLLECTION_NAME = 'documentation';

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        const currentBatch = Math.floor(i / batchSize) + 1;

        // Update status before processing batch
        await this.statusManager.updateStatus({
          repositoryName: config.name,
          currentBatch,
          totalBatches,
          indexedChunks,
          percentageComplete: 33 + Math.round((i / totalChunks) * 66)
        });

        info(`[${config.name}] Processing batch ${currentBatch} of ${totalBatches}...`);
        info(`[${config.name}] Generating embeddings for ${batchChunks.length} chunks in batch ${currentBatch}...`);

        try {
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
                error(`[${config.name}] Failed to generate embedding for chunk from ${chunk.filePath || chunk.url}: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
                throw embeddingError; // Re-throw to be caught by Promise.allSettled
              }
            })
          );

          const successfulPoints = embeddingResults
            .filter(result => result.status === 'fulfilled')
            .map(result => (result as PromiseFulfilledResult<any>).value);

          const failedEmbeddingsCount = embeddingResults.filter(result => result.status === 'rejected').length;
          if (failedEmbeddingsCount > 0) {
            error(`[${config.name}] Failed to generate embeddings for ${failedEmbeddingsCount} of ${batchChunks.length} chunks in batch ${currentBatch}.`);
          }

          if (successfulPoints.length > 0) {
            try {
              await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
                wait: true,
                points: successfulPoints,
              });
              indexedChunks += successfulPoints.length;

              // After successful upsert, update metadata for the files in this batch
              const indexedFileIds = new Set(successfulPoints.map(point => point.payload.fileId));
              for (const fileId of indexedFileIds) {
                const metadata = processedFilesMetadata.find(meta => meta.fileId === fileId);
                if (metadata) {
                  await metadataManager.setFileMetadata(metadata);
                  debug(`[${config.name}] Successfully set metadata for file ID: ${fileId}`); // Optional: add debug log
                } else {
                  error(`[${config.name}] Could not find metadata for indexed file ID: ${fileId}`);
                }
              }

            } catch (upsertError) {
              error(`[${config.name}] Failed to upsert batch ${currentBatch} of ${successfulPoints.length} points to Qdrant: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`);
            }
          }

          const percentageComplete = 33 + Math.round(((i + batchChunks.length) / totalChunks) * 66);
          info(`[${config.name}] Processed batch ${currentBatch} of ${totalBatches}. Successfully indexed in this batch: ${successfulPoints.length}. Total indexed so far: ${indexedChunks} chunks.`);

          // Update status after processing batch
          await this.statusManager.updateStatus({
            repositoryName: config.name,
            currentBatch,
            totalBatches,
            indexedChunks,
            percentageComplete
          });
        } catch (batchError) {
          error(`[${config.name}] Error processing batch ${currentBatch}: ${batchError}`);
          // Continue with next batch despite errors
        }
      }

      // Mark indexing as completed
      info(`[${config.name}] Finished generating embeddings and indexing. Total indexed: ${indexedChunks} of ${totalChunks} chunks.`);

      await this.statusManager.completeStatus(config.name, true, {
        processedFiles,
        skippedFiles,
        totalChunks,
        indexedChunks
      });

      // If watch mode is enabled, start the watcher
      if (config.watchMode) {
        info(`[${config.name}] Starting repository watcher...`);
        const watcher = new RepositoryWatcher(config, this.handleWatchedFilesChange.bind(this));
        await watcher.start();
        // Note: The watcher runs in the background. Errors within the watcher's
        // checkForChanges method will be logged by the watcher itself.
      }
    } catch (err) {
      error(`[${config.name}] Error during async repository processing: ${err instanceof Error ? err.message : String(err)}`);

      // Update status to failed
      await this.statusManager.completeStatus(
        config.name,
        false,
        undefined,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      // Remove from active processes
      LocalRepositoryHandler.activeIndexingProcesses.delete(config.name);
    }
  }

  private async handleWatchedFilesChange(changedFiles: string[], removedFiles: string[]): Promise<void> {
    if (!this.repositoryConfig) {
      error('RepositoryWatcher callback called before repositoryConfig was set.');
      return;
    }
    const config = this.repositoryConfig; // Use a local variable for clarity and type safety

    info(`[${config.name}] Watcher detected changes.`);
    if (changedFiles.length > 0) {
      info(`[${config.name}] Changed files: ${changedFiles.join(', ')}`);
      // TODO: Implement re-indexing for changedFiles
      // This will involve reading the file content, chunking, generating embeddings, and upserting to Qdrant.
      // Need to handle deletion of old chunks for these files first.
    }
    if (removedFiles.length > 0) {
      info(`[${config.name}] Removed files: ${removedFiles.join(', ')}`); // Use local config variable
      // TODO: Implement deletion for removedFiles
      // This will involve getting the fileIds for these paths and deleting points from Qdrant.
    }
    // TODO: Update status manager?
  }
}
