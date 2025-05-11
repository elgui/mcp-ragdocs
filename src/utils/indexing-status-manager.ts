import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { IndexingStatus } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_DIR = path.join(__dirname, '..', 'indexing-status');
const STATUS_FILE_PREFIX = 'status-';

/**
 * Manages the status of repository indexing operations
 */
export class IndexingStatusManager {
  /**
   * Initialize the status manager
   */
  constructor() {
    this.ensureStatusDirectory();
  }

  /**
   * Create a new indexing status entry
   */
  async createStatus(repositoryName: string): Promise<IndexingStatus> {
    await this.ensureStatusDirectory();
    
    const status: IndexingStatus = {
      repositoryName,
      status: 'pending',
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    await this.saveStatus(status);
    return status;
  }

  /**
   * Update an existing indexing status
   */
  async updateStatus(status: Partial<IndexingStatus> & { repositoryName: string }): Promise<IndexingStatus> {
    const currentStatus = await this.getStatus(status.repositoryName);
    
    if (!currentStatus) {
      throw new Error(`No status found for repository: ${status.repositoryName}`);
    }

    const updatedStatus: IndexingStatus = {
      ...currentStatus,
      ...status,
      lastUpdated: new Date().toISOString()
    };

    await this.saveStatus(updatedStatus);
    return updatedStatus;
  }

  /**
   * Get the current status for a repository
   */
  async getStatus(repositoryName: string): Promise<IndexingStatus | null> {
    try {
      const filePath = this.getStatusFilePath(repositoryName);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as IndexingStatus;
    } catch (error) {
      // If file doesn't exist, return null
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all indexing statuses
   */
  async getAllStatuses(): Promise<IndexingStatus[]> {
    await this.ensureStatusDirectory();
    
    try {
      const files = await fs.readdir(STATUS_DIR);
      const statusFiles = files.filter(file => file.startsWith(STATUS_FILE_PREFIX));
      
      const statuses: IndexingStatus[] = [];
      for (const file of statusFiles) {
        try {
          const content = await fs.readFile(path.join(STATUS_DIR, file), 'utf-8');
          statuses.push(JSON.parse(content) as IndexingStatus);
        } catch (error) {
          console.error(`Error reading status file ${file}:`, error);
        }
      }
      
      return statuses;
    } catch (error) {
      console.error('Error reading status directory:', error);
      return [];
    }
  }

  /**
   * Delete a status entry
   */
  async deleteStatus(repositoryName: string): Promise<void> {
    try {
      const filePath = this.getStatusFilePath(repositoryName);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Complete an indexing operation
   */
  async completeStatus(
    repositoryName: string, 
    success: boolean, 
    stats?: { 
      processedFiles: number, 
      skippedFiles: number, 
      totalChunks: number, 
      indexedChunks: number 
    },
    error?: string
  ): Promise<IndexingStatus> {
    const status = await this.getStatus(repositoryName);
    
    if (!status) {
      throw new Error(`No status found for repository: ${repositoryName}`);
    }

    const updatedStatus: IndexingStatus = {
      ...status,
      status: success ? 'completed' : 'failed',
      endTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      percentageComplete: success ? 100 : status.percentageComplete,
      error: error || status.error
    };

    if (stats) {
      updatedStatus.processedFiles = stats.processedFiles;
      updatedStatus.skippedFiles = stats.skippedFiles;
      updatedStatus.totalChunks = stats.totalChunks;
      updatedStatus.indexedChunks = stats.indexedChunks;
    }

    await this.saveStatus(updatedStatus);
    return updatedStatus;
  }

  /**
   * Save status to file
   */
  private async saveStatus(status: IndexingStatus): Promise<void> {
    await this.ensureStatusDirectory();
    const filePath = this.getStatusFilePath(status.repositoryName);
    await fs.writeFile(filePath, JSON.stringify(status, null, 2), 'utf-8');
  }

  /**
   * Get the file path for a status file
   */
  private getStatusFilePath(repositoryName: string): string {
    return path.join(STATUS_DIR, `${STATUS_FILE_PREFIX}${repositoryName}.json`);
  }

  /**
   * Ensure the status directory exists
   */
  private async ensureStatusDirectory(): Promise<void> {
    try {
      await fs.mkdir(STATUS_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating status directory:', error);
      throw error;
    }
  }
}
