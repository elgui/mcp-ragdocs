import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig, IndexingStatus, FileIndexMetadata } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { IndexingStatusManager } from '../utils/indexing-status-manager.js';
import { getFileMetadataManager } from '../utils/file-metadata-manager.js';
import { RepositoryWatcher } from '../utils/repository-watcher.js';
import { info, error, debug } from '../utils/logger.js';
import { parseCodeFile } from '../utils/ast-parser.js';
import { splitTextByTokens } from '../utils/token-counter.js';
import { getCurrentCommitSha } from '../utils/git-utils.js';

const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');
const DEFAULT_CHUNK_SIZE = 1000;

export class LocalRepositoryEnhancedTool extends EnhancedBaseTool {
  private activeProgressToken: string | number | undefined;
  private statusManager: IndexingStatusManager;
  private repositoryConfig: RepositoryConfig | undefined;
  private static activeIndexingProcesses: Map<string, boolean> = new Map();
  private static BATCH_SIZE = 50;

  constructor(options?: { apiClient?: any, server?: any }) {
    super(options);
    this.statusManager = new IndexingStatusManager();
  }

  get definition() {
    return {
      name: 'local_repository',
      description: 'Adds a local repository to the documentation index.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute or relative path to the local repository.',
          },
          name: {
            type: 'string',
            description: 'A unique name for the repository. Defaults to the directory name.',
          },
          include: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns for files to include. Defaults to ["**/*"].',
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns for files to exclude. Defaults to common build/dependency directories.',
          },
          watchMode: {
            type: 'boolean',
            description: 'Enable watch mode to automatically re-index on file changes. Defaults to false.',
          },
          watchInterval: {
            type: 'number',
            description: 'Interval in milliseconds for checking file changes in watch mode. Defaults to 60000 (1 minute).',
          },
          chunkSize: {
            type: 'number',
            description: 'Maximum size of text chunks for indexing. Defaults to 1000.',
          },
          fileTypeConfig: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                include: { type: 'boolean' },
                chunkStrategy: { type: 'string', enum: ['semantic', 'line', 'text'] },
              },
            },
            description: 'Configuration for specific file types.',
          },
        },
        required: ['path'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    this.activeProgressToken = callContext?.progressToken || callContext?.requestId;

    if (!this.apiClient) {
      throw new McpError(ErrorCode.InternalError, 'API client is not initialized for LocalRepositoryEnhancedTool');
    }
    if (!this.server) {
      throw new McpError(ErrorCode.InternalError, 'Server is not initialized for LocalRepositoryEnhancedTool');
    }

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
      if (LocalRepositoryEnhancedTool.activeIndexingProcesses.has(config.name)) {
        // Get current status
        const status = await this.statusManager.getStatus(config.name);
        if (status && status.status === 'processing') {
          return this.formatTextResponse(
            `Repository indexing already in progress for ${config.name}.\n` +
            `Current progress: ${status.percentageComplete || 0}%\n` +
            `Files processed: ${status.processedFiles || 0} of ${status.totalFiles || 'unknown'}\n` +
            `Chunks indexed: ${status.indexedChunks || 0} of ${status.totalChunks || 'unknown'}\n` +
            `Started at: ${new Date(status.startTime).toLocaleString()}`
          );
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
      // Note: The tool execution will finish after this, but the async process continues.
      const metadataManager = await getFileMetadataManager();
      const initialExistingRepoMetadata = await metadataManager.getRepositoryMetadata(config.name);
      this.processRepositoryAsync(config, initialExistingRepoMetadata, this.activeProgressToken).catch(async (err) => {
        error(`[${config.name}] Uncaught error during async repository processing: ${err instanceof Error ? err.message : String(err)}`);
        // Ensure status is marked as failed even if the promise is not awaited here
        await this.statusManager.completeStatus(
          config.name,
          false,
          undefined,
          err instanceof Error ? err.message : String(err)
        );
        LocalRepositoryEnhancedTool.activeIndexingProcesses.delete(config.name);
      });


      return this.formatTextResponse(
        `Repository configuration saved for ${config.name} (${repoPath}).\n` +
        `Indexing has started in the background and will continue after this response.\n` +
        `You can check the status using the 'get_indexing_status' tool with parameter name="${config.name}".\n` +
        `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`
      );
    } catch (err) {
      error(`Failed to index repository: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof McpError) {
        throw err;
      }
      return this.handleError(`Failed to index repository. Check logs for details.`);
    }
  }

  private async processRepository(config: RepositoryConfig): Promise<{
    chunks: DocumentChunk[],
    processedFiles: number,
    skippedFiles: number,
    filesNeedingUpdate: number,
    processedFilesMetadata: FileIndexMetadata[],
    existingRepoMetadata: Record<string, FileIndexMetadata> | undefined
  }> {
    if (!this.apiClient || !this.server) {
      throw new McpError(ErrorCode.InternalError, 'API client or server is not initialized for LocalRepositoryEnhancedTool during file processing');
    }

    const metadataManager = await getFileMetadataManager();
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0;
    let skippedFiles = 0;
    let filesNeedingUpdate = 0;
    let deletedFilesCount = 0;
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

    info(`[${repositoryId}] Found ${totalFiles} files on disk to process based on include/exclude patterns.`);
    if (this.activeProgressToken) {
      (this.server as any).sendProgress(this.activeProgressToken, { message: `Found ${totalFiles} files on disk to process.` });
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
        const existingMetadata: FileIndexMetadata | undefined = await metadataManager.getFileMetadata(repositoryId, fileId);
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
        const fileChunks = await this.chunkFileContent(
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

        if (fileCounter % 50 === 0 && fileCounter > 0 && this.activeProgressToken) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 33);
          (this.server as any).sendProgress(this.activeProgressToken, { message: `Scanned ${fileCounter} of ${totalFiles} files...`, percentageComplete });
          info(`[${repositoryId}] Scanned ${fileCounter} of ${totalFiles} files... (${processedFiles} to process/update, ${skippedFiles} skipped)`);
        }
      } catch (err) {
        error(`[${repositoryId}] Error processing file ${relativePath} (File ID: ${fileId}): ${err instanceof Error ? err.message : String(err)}`);
        skippedFiles++;
      }
    }

    const deletedFileIds = [];
    for (const knownFileId of allKnownFileIdsInRepo) {
      if (!currentFileIdsOnDisk.has(knownFileId)) {
        const deletedMetadata = await metadataManager.getFileMetadata(repositoryId, knownFileId);
        const deletedFilePath = deletedMetadata?.filePath || 'unknown path';
        info(`[${repositoryId}] File ${deletedFilePath} (ID: ${knownFileId}) deleted from source. Will remove from Qdrant and metadata.`);
        deletedFileIds.push(knownFileId);
        await metadataManager.removeFileMetadata(repositoryId, knownFileId);
        deletedFilesCount++;
      }
    }
    
    // Delete Qdrant entries for all deleted files at once
    if (deletedFileIds.length > 0) {
      info(`[${repositoryId}] Deleting Qdrant entries for ${deletedFileIds.length} removed files...`);
      try {
        const deleteFilter = {
          must: [
            {
              key: 'repository',
              match: { value: repositoryId }
            },
            {
              key: 'isRepositoryFile', 
              match: { value: true }
            }
          ],
          should: deletedFileIds.map(fileId => ({
            key: 'fileId',
            match: { value: fileId }
          }))
        };
        
        const deleteResult = await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
          filter: deleteFilter,
          wait: true
        });
        
        info(`[${repositoryId}] Successfully deleted Qdrant entries for removed files: ${deleteResult.status}`);
      } catch (deleteError) {
        error(`[${repositoryId}] Error deleting Qdrant entries for removed files: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
        // Continue with indexing despite the error
      }
    }

    info(`[${repositoryId}] Completed file scan. New/Modified files to process: ${processedFiles}. Files skipped (unchanged/excluded/empty/error): ${skippedFiles}. Files deleted: ${deletedFilesCount}.`);
    return { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata, existingRepoMetadata };
  }

  private async chunkFileContent(
    content: string,
    filePath: string,
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string,
    fileId: string
  ): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const timestamp = new Date().toISOString();
    const fileUrl = `file://${filePath}`;
    const title = `${config.name}/${relativePath}`;
    const extension = path.extname(filePath).toLowerCase();
    const commitSha = await getCurrentCommitSha(config.path);
    const isCodeFile = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.php'].includes(extension);

    if (isCodeFile && chunkStrategy === 'semantic') {
      const codeChunks = parseCodeFile(filePath, content);

      for (const codeChunk of codeChunks) {
        if (codeChunk.docstring) {
          const docstringText = codeChunk.docstring.trim();
          if (docstringText) {
            const symbolName = codeChunk.parent
              ? `${codeChunk.parent}.${codeChunk.symbolName}`
              : codeChunk.symbolName;
            const prefixedDocstring = `${symbolName}: ${docstringText}`;
            const docstringChunks = splitTextByTokens(prefixedDocstring, 200, 400, false);

            docstringChunks.forEach((text) => {
              chunks.push({
                text,
                url: fileUrl,
                title,
                timestamp,
                filePath: relativePath,
                language,
                chunkIndex: chunks.length,
                totalChunks: -1,
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

        if (codeChunk.docstring) {
          const codeText = codeChunk.text.trim();
          if (codeText) {
            const symbolName = codeChunk.parent
              ? `${codeChunk.parent}.${codeChunk.symbolName}`
              : codeChunk.symbolName;
            const codeTextChunks = splitTextByTokens(codeText, 200, 400, true);

            codeTextChunks.forEach((text) => {
              chunks.push({
                text,
                url: fileUrl,
                title,
                timestamp,
                filePath: relativePath,
                language,
                chunkIndex: chunks.length,
                totalChunks: -1,
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

      if (chunks.length === 0) {
        const moduleChunk = codeChunks.find(chunk => chunk.symbolName === '__module__' && chunk.docstring);
        if (moduleChunk && moduleChunk.docstring) {
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
        const totalChunks = chunks.length;
        chunks.forEach(chunk => {
          chunk.totalChunks = totalChunks;
        });
      }
      return chunks;
    }

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
      repository: config.name,
      isRepositoryFile: true,
      fileId,
      domain: 'docs' as 'code' | 'docs',
      lines: [0, 0] as [number, number],
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

  private async saveRepositoryConfig(config: RepositoryConfig): Promise<void> {
    try {
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });
    } catch (err) {
      error(`Error creating repository config directory: ${err instanceof Error ? err.message : String(err)}`);
      throw new McpError(ErrorCode.InternalError, 'Failed to create repository config directory');
    }

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

  private async processRepositoryAsync(config: RepositoryConfig, existingRepoMetadata: Record<string, FileIndexMetadata> | undefined, _progressToken?: string | number): Promise<void> {
    const repositoryId = config.name;
    try {
      LocalRepositoryEnhancedTool.activeIndexingProcesses.set(repositoryId, true);
      await this.statusManager.updateStatus({
        repositoryName: repositoryId,
        status: 'processing'
      });

      const apiClient = this.apiClient;
      if (!apiClient) {
        throw new McpError(ErrorCode.InternalError, 'API client is not initialized for LocalRepositoryEnhancedTool during async processing');
      }

      info(`[${repositoryId}] Starting to process repository files asynchronously...`);
      const metadataManager = await getFileMetadataManager();

      const { chunks, processedFiles, skippedFiles, filesNeedingUpdate, processedFilesMetadata } = await this.processRepository(config);

      // Delete existing records for modified files to avoid duplicates
      if (filesNeedingUpdate > 0) {
        info(`[${repositoryId}] ${filesNeedingUpdate} files were modified - deleting old Qdrant entries before re-indexing.`);
        
        // Get all fileIds that need updating
        const fileIdsToUpdate = processedFilesMetadata
          .filter((meta: FileIndexMetadata) => {
            // Check if this is a modified file (not a brand new one)
            // We check if the fileId exists in the previously loaded existingRepoMetadata
            return existingRepoMetadata && existingRepoMetadata[meta.fileId] !== undefined;
          })
          .map(meta => meta.fileId);
          
        if (fileIdsToUpdate.length > 0) {
          try {
            info(`[${repositoryId}] Deleting old Qdrant entries for ${fileIdsToUpdate.length} modified files...`);
            
            // Create a filter that matches any of these fileIds
            const deleteFilter = {
              must: [
                {
                  key: 'repository',
                  match: { value: repositoryId }
                },
                {
                  key: 'isRepositoryFile',
                  match: { value: true }
                }
              ],
              should: fileIdsToUpdate.map(fileId => ({
                key: 'fileId',
                match: { value: fileId }
              }))
            };
            
            // Delete all points matching the filter
            const deleteResult = await apiClient.qdrantClient.delete(COLLECTION_NAME, {
              filter: deleteFilter,
              wait: true
            });
            
            info(`[${repositoryId}] Successfully deleted old entries for modified files: ${deleteResult.status}`);
          } catch (deleteError) {
            error(`[${repositoryId}] Error deleting old entries for modified files: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
            // Continue with indexing despite the error
          }
        }
      }

      await this.statusManager.updateStatus({
        repositoryName: repositoryId,
        totalFiles: processedFiles + skippedFiles,
        processedFiles,
        skippedFiles,
        totalChunks: chunks.length,
        percentageComplete: 33
      });

      info(`[${repositoryId}] File scanning complete. New/updated files processed: ${processedFiles}. Files skipped: ${skippedFiles}. Total chunks to index: ${chunks.length}.`);

      const batchSize = LocalRepositoryEnhancedTool.BATCH_SIZE;
      let indexedChunks = 0;
      const totalChunks = chunks.length;
      const totalBatches = Math.ceil(totalChunks / batchSize);

      info(`[${config.name}] Starting to generate embeddings and index ${totalChunks} chunks in ${totalBatches} batches...`);

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        const currentBatch = Math.floor(i / batchSize) + 1;

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
                error(`[${config.name}] Failed to generate embedding for chunk from ${chunk.filePath || chunk.url}: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
                throw embeddingError;
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
              await apiClient.qdrantClient.upsert(COLLECTION_NAME, {
                wait: true,
                points: successfulPoints,
                // Set the ordering by ID for better batch processing
              });
              indexedChunks += successfulPoints.length;

              const indexedFileIds = new Set(successfulPoints.map(point => point.payload.fileId));
              for (const fileId of indexedFileIds) {
                const metadata = processedFilesMetadata.find(meta => meta.fileId === fileId);
                if (metadata) {
                  await metadataManager.setFileMetadata(metadata);
                  debug(`[${config.name}] Successfully set metadata for file ID: ${fileId}`);
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

          await this.statusManager.updateStatus({
            repositoryName: config.name,
            currentBatch,
            totalBatches,
            indexedChunks,
            percentageComplete
          });
        } catch (batchError) {
          error(`[${config.name}] Error processing batch ${currentBatch}: ${batchError}`);
        }
      }

      info(`[${config.name}] Finished generating embeddings and indexing. Total indexed: ${indexedChunks} of ${totalChunks} chunks.`);

      await this.statusManager.completeStatus(config.name, true, {
        processedFiles,
        skippedFiles,
        totalChunks,
        indexedChunks
      });

      if (config.watchMode) {
        info(`[${config.name}] Starting repository watcher...`);
        const watcher = new RepositoryWatcher(config, this.handleWatchedFilesChange.bind(this));
        await watcher.start();
      }
    } catch (err) {
      error(`[${config.name}] Error during async repository processing: ${err instanceof Error ? err.message : String(err)}`);
      await this.statusManager.completeStatus(
        config.name,
        false,
        undefined,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      LocalRepositoryEnhancedTool.activeIndexingProcesses.delete(config.name);
    }
  }

  private async handleWatchedFilesChange(changedFiles: string[], removedFiles: string[]): Promise<void> {
    if (!this.repositoryConfig) {
      error('RepositoryWatcher callback called before repositoryConfig was set.');
      return;
    }
    const config = this.repositoryConfig;

    info(`[${config.name}] Watcher detected changes.`);
    if (changedFiles.length > 0) {
      info(`[${config.name}] Changed files: ${changedFiles.join(', ')}`);
      // TODO: Implement re-indexing for changedFiles
    }
    if (removedFiles.length > 0) {
      info(`[${config.name}] Removed files: ${removedFiles.join(', ')}`);
      // TODO: Implement deletion for removedFiles
    }
  }
}
