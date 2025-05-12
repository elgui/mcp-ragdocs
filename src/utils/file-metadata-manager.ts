import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url'; // Import fileURLToPath
import { FileIndexMetadata } from '../types.js';
import { info, error, debug } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Add __dirname definition

const METADATA_DIR = path.join(__dirname, '..', 'metadata'); // Use __dirname
const METADATA_FILE_PATH = path.join(METADATA_DIR, 'index_metadata.json');

// In-memory store for metadata, keyed by repositoryId, then by fileId
type RepositoryMetadataStore = Record<string, FileIndexMetadata>; // fileId -> metadata
type AllRepositoriesMetadataStore = Record<string, RepositoryMetadataStore>; // repositoryId -> RepositoryMetadataStore

export class FileMetadataManager {
  private metadata: AllRepositoriesMetadataStore = {};
  private metadataFilePath: string;

  constructor(metadataFilePath: string = METADATA_FILE_PATH) {
    this.metadataFilePath = metadataFilePath;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.metadataFilePath), { recursive: true });
      const fileContent = await fs.readFile(this.metadataFilePath, 'utf-8');
      this.metadata = JSON.parse(fileContent) as AllRepositoriesMetadataStore;
      info(`Loaded file index metadata from ${this.metadataFilePath}`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        info(`Metadata file ${this.metadataFilePath} not found. Initializing with empty metadata.`);
        this.metadata = {};
        await this.saveMetadata(); // Create the file with empty data
      } else {
        error(`Error loading metadata from ${this.metadataFilePath}: ${err instanceof Error ? err.message : String(err)}`);
        // Decide if we should re-initialize or throw
        this.metadata = {};
      }
    }
  }

  private async saveMetadata(): Promise<void> {
    try {
      const jsonData = JSON.stringify(this.metadata, null, 2);
      await fs.writeFile(this.metadataFilePath, jsonData, 'utf-8');
      debug(`Saved file index metadata to ${this.metadataFilePath}`);
    } catch (err) {
      error(`Error saving metadata to ${this.metadataFilePath}: ${err instanceof Error ? err.message : String(err)}`);
      // Potentially throw to indicate failure
      throw err;
    }
  }

  public async getFileMetadata(repositoryId: string, fileId: string): Promise<FileIndexMetadata | undefined> {
    return this.metadata[repositoryId]?.[fileId];
  }

  public async setFileMetadata(metadataEntry: FileIndexMetadata): Promise<void> {
    if (!this.metadata[metadataEntry.repositoryId]) {
      this.metadata[metadataEntry.repositoryId] = {};
    }
    this.metadata[metadataEntry.repositoryId][metadataEntry.fileId] = metadataEntry;
    await this.saveMetadata();
  }

  public async removeFileMetadata(repositoryId: string, fileId: string): Promise<void> {
    if (this.metadata[repositoryId]?.[fileId]) {
      delete this.metadata[repositoryId][fileId];
      if (Object.keys(this.metadata[repositoryId]).length === 0) {
        delete this.metadata[repositoryId];
      }
      await this.saveMetadata();
    }
  }

  public async getRepositoryMetadata(repositoryId: string): Promise<RepositoryMetadataStore | undefined> {
    return this.metadata[repositoryId];
  }

  public async getAllMetadata(): Promise<AllRepositoriesMetadataStore> {
    return this.metadata;
  }

  public async removeRepositoryMetadata(repositoryId: string): Promise<void> {
    if (this.metadata[repositoryId]) {
      delete this.metadata[repositoryId];
      await this.saveMetadata();
    }
  }
}

// Singleton instance
let metadataManagerInstance: FileMetadataManager | null = null;

export async function getFileMetadataManager(): Promise<FileMetadataManager> {
  if (!metadataManagerInstance) {
    metadataManagerInstance = new FileMetadataManager();
    await metadataManagerInstance.initialize();
  }
  return metadataManagerInstance;
}
