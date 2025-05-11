import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto';
import { RepositoryConfig } from '../types.js';

interface FileState {
  path: string;
  hash: string;
  lastModified: number;
}

export class RepositoryWatcher {
  private config: RepositoryConfig;
  private fileStates: Map<string, FileState> = new Map();
  private watchInterval: NodeJS.Timeout | null = null;
  private onFileChanged: (changedFiles: string[], removedFiles: string[]) => Promise<void>;

  constructor(
    config: RepositoryConfig,
    onFileChanged: (changedFiles: string[], removedFiles: string[]) => Promise<void>
  ) {
    this.config = config;
    this.onFileChanged = onFileChanged;
  }

  /**
   * Start watching the repository for changes
   */
  async start(): Promise<void> {
    // Initialize the file states
    await this.initializeFileStates();

    // Start the watch interval
    this.watchInterval = setInterval(
      () => this.checkForChanges(),
      this.config.watchInterval
    );

    console.log(`Started watching repository: ${this.config.name} (${this.config.path})`);
  }

  /**
   * Stop watching the repository
   */
  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
      console.log(`Stopped watching repository: ${this.config.name}`);
    }
  }

  /**
   * Initialize the file states by scanning the repository
   */
  private async initializeFileStates(): Promise<void> {
    const files = await glob(this.config.include, {
      cwd: this.config.path,
      ignore: this.config.exclude,
      absolute: true,
      nodir: true,
    });

    for (const file of files) {
      try {
        const stats = fs.statSync(file);
        const content = fs.readFileSync(file, 'utf-8');
        const hash = this.hashContent(content);

        this.fileStates.set(file, {
          path: file,
          hash,
          lastModified: stats.mtimeMs,
        });
      } catch (error) {
        console.error(`Error initializing file state for ${file}:`, error);
      }
    }

    console.log(`Initialized file states for ${this.fileStates.size} files in repository: ${this.config.name}`);
  }

  /**
   * Check for changes in the repository
   */
  private async checkForChanges(): Promise<void> {
    try {
      const currentFiles = await glob(this.config.include, {
        cwd: this.config.path,
        ignore: this.config.exclude,
        absolute: true,
        nodir: true,
      });

      const currentFilePaths = new Set(currentFiles);
      const previousFilePaths = new Set(this.fileStates.keys());

      // Find added or modified files
      const changedFiles: string[] = [];
      for (const file of currentFiles) {
        try {
          const stats = fs.statSync(file);
          const previousState = this.fileStates.get(file);

          // If the file is new or the modification time has changed
          if (!previousState || previousState.lastModified !== stats.mtimeMs) {
            const content = fs.readFileSync(file, 'utf-8');
            const hash = this.hashContent(content);

            // If the file is new or the content has changed
            if (!previousState || previousState.hash !== hash) {
              changedFiles.push(file);

              // Update the file state
              this.fileStates.set(file, {
                path: file,
                hash,
                lastModified: stats.mtimeMs,
              });
            } else if (previousState) {
              // Update just the modification time if only that changed
              this.fileStates.set(file, {
                ...previousState,
                lastModified: stats.mtimeMs,
              });
            }
          }
        } catch (error) {
          console.error(`Error checking file ${file}:`, error);
        }
      }

      // Find removed files
      const removedFiles: string[] = [];
      for (const file of previousFilePaths) {
        if (!currentFilePaths.has(file)) {
          removedFiles.push(file);
          this.fileStates.delete(file);
        }
      }

      // If there are changes, notify the callback
      if (changedFiles.length > 0 || removedFiles.length > 0) {
        console.log(`Detected changes in repository ${this.config.name}:`);
        if (changedFiles.length > 0) {
          console.log(`- Changed files: ${changedFiles.length}`);
        }
        if (removedFiles.length > 0) {
          console.log(`- Removed files: ${removedFiles.length}`);
        }

        await this.onFileChanged(changedFiles, removedFiles);
      }
    } catch (error) {
      console.error(`Error checking for changes in repository ${this.config.name}:`, error);
    }
  }

  /**
   * Generate a hash of the file content
   */
  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}
