import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { RepositoryConfig } from '../types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { UpdateRepositoryHandler } from '../handlers/update-repository.js';
import { LocalRepositoryHandler } from '../handlers/local-repository.js';
import { WatchRepositoryHandler } from '../handlers/watch-repository.js';
import { info, error } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE_PATH = path.join(__dirname, '..', '..', 'repositories.json');
const REPO_CONFIG_DIR = path.join(__dirname, '..', '..', 'repo-configs');

/**
 * Interface for the repositories configuration file
 */
interface RepositoriesConfig {
  repositories: RepositoryConfig[];
  autoWatch: boolean;
}

/**
 * Class for loading and managing repository configurations from a JSON file
 */
export class RepositoryConfigLoader {
  private server: Server;
  private apiClient: ApiClient;
  private updateHandler: UpdateRepositoryHandler;
  private addHandler: LocalRepositoryHandler;
  private watchHandler: WatchRepositoryHandler;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
    this.updateHandler = new UpdateRepositoryHandler(server, apiClient);
    this.addHandler = new LocalRepositoryHandler(server, apiClient);
    this.watchHandler = new WatchRepositoryHandler(server, apiClient);
  }

  /**
   * Load repositories from the configuration file and initialize them
   */
  async loadRepositories(): Promise<void> {
    try {
      // Check if the config file exists
      try {
        await fs.access(CONFIG_FILE_PATH);
      } catch {
        info('No repositories.json configuration file found. Creating default configuration...');
        await this.createDefaultConfig();
        return;
      }

      // Read the config file
      const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const config = JSON.parse(configContent) as RepositoriesConfig;

      // Ensure the repo-configs directory exists
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });

      // Process each repository in the config
      info(`Loading ${config.repositories.length} repositories from configuration...`);

      for (const repoConfig of config.repositories) {
        try {
          // Check if the repository path exists
          try {
            const stats = await fs.stat(repoConfig.path);
            if (!stats.isDirectory()) {
              error(`Repository path is not a directory: ${repoConfig.path}`);
              continue;
            }
          } catch (err) {
            error(`Repository path does not exist: ${repoConfig.path}. Error: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }

          // Check if the repository is already indexed
          const configPath = path.join(REPO_CONFIG_DIR, `${repoConfig.name}.json`);
          let isUpdate = false;

          try {
            await fs.access(configPath);
            isUpdate = true;
          } catch {
            // Repository doesn't exist yet, will be added
          }

          if (isUpdate) {
            // Update existing repository
            info(`Updating repository: ${repoConfig.name}`);
            await this.updateHandler.handle(repoConfig);
          } else {
            // Add new repository
            info(`Adding repository: ${repoConfig.name}`);
            await this.addHandler.handle(repoConfig);
          }

          // Start watching if configured
          if (config.autoWatch && repoConfig.watchMode) {
            info(`Starting watch for repository: ${repoConfig.name}`);
            await this.watchHandler.handle({
              name: repoConfig.name,
              action: 'start'
            });
          }
        } catch (err) {
          error(`Error processing repository ${repoConfig.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      info('Repositories loaded successfully from configuration');
    } catch (err) {
      error(`Error loading repositories from configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Create a default configuration file if none exists
   */
  private async createDefaultConfig(): Promise<void> {
    const defaultConfig: RepositoriesConfig = {
      repositories: [],
      autoWatch: true
    };

    try {
      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      info(`Created default repositories configuration at ${CONFIG_FILE_PATH}`);
    } catch (err) {
      error(`Error creating default configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Update the configuration file with the current state of repositories
   */
  async updateConfigFile(): Promise<void> {
    try {
      // Get all repository config files
      const configFiles = await fs.readdir(REPO_CONFIG_DIR);
      const jsonFiles = configFiles.filter(file => file.endsWith('.json'));

      // Load each repository config
      const repositories: RepositoryConfig[] = [];
      for (const file of jsonFiles) {
        try {
          const configPath = path.join(REPO_CONFIG_DIR, file);
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent) as RepositoryConfig;
          repositories.push(config);
        } catch (err) {
          error(`Error loading repository config ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Check if the config file exists
      let existingConfig: RepositoriesConfig = { repositories: [], autoWatch: true };
      try {
        const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        existingConfig = JSON.parse(configContent) as RepositoriesConfig;
      } catch {
        // Config file doesn't exist yet, will use default
      }

      // Update the config file
      const updatedConfig: RepositoriesConfig = {
        repositories,
        autoWatch: existingConfig.autoWatch
      };

      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(updatedConfig, null, 2), 'utf-8');
      info(`Updated repositories configuration at ${CONFIG_FILE_PATH}`);
    } catch (err) {
      error(`Error updating configuration file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Add a repository to the configuration file
   */
  async addRepositoryToConfig(config: RepositoryConfig): Promise<void> {
    try {
      // Check if the config file exists
      let existingConfig: RepositoriesConfig = { repositories: [], autoWatch: true };
      try {
        const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        existingConfig = JSON.parse(configContent) as RepositoriesConfig;
      } catch {
        // Config file doesn't exist yet, will use default
      }

      // Check if the repository already exists
      const existingIndex = existingConfig.repositories.findIndex(repo => repo.name === config.name);
      if (existingIndex >= 0) {
        // Update existing repository
        existingConfig.repositories[existingIndex] = config;
      } else {
        // Add new repository
        existingConfig.repositories.push(config);
      }

      // Update the config file
      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(existingConfig, null, 2), 'utf-8');
      info(`Added repository ${config.name} to configuration`);
    } catch (err) {
      error(`Error adding repository ${config.name} to configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Remove a repository from the configuration file
   */
  async removeRepositoryFromConfig(name: string): Promise<void> {
    try {
      // Check if the config file exists
      try {
        await fs.access(CONFIG_FILE_PATH);
      } catch {
        info('No repositories.json configuration file found.');
        return;
      }

      // Read the config file
      const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const config = JSON.parse(configContent) as RepositoriesConfig;

      // Remove the repository
      const initialLength = config.repositories.length;
      config.repositories = config.repositories.filter(repo => repo.name !== name);

      if (config.repositories.length === initialLength) {
        info(`Repository ${name} not found in configuration`);
        return;
      }

      // Update the config file
      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
      info(`Removed repository ${name} from configuration`);
    } catch (err) {
      error(`Error removing repository ${name} from configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
