import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { RepositoryConfig } from '../types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { UpdateRepositoryHandler } from '../handlers/update-repository.js';
import { LocalRepositoryHandler } from '../handlers/local-repository.js';
import { WatchRepositoryHandler } from '../handlers/watch-repository.js';

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
        console.log('No repositories.json configuration file found. Creating default configuration...');
        await this.createDefaultConfig();
        return;
      }

      // Read the config file
      const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const config = JSON.parse(configContent) as RepositoriesConfig;

      // Ensure the repo-configs directory exists
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });

      // Process each repository in the config
      console.log(`Loading ${config.repositories.length} repositories from configuration...`);

      for (const repoConfig of config.repositories) {
        try {
          // Check if the repository path exists
          try {
            const stats = await fs.stat(repoConfig.path);
            if (!stats.isDirectory()) {
              console.error(`Repository path is not a directory: ${repoConfig.path}`);
              continue;
            }
          } catch {
            console.error(`Repository path does not exist: ${repoConfig.path}`);
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
            console.log(`Updating repository: ${repoConfig.name}`);
            await this.updateHandler.handle(repoConfig);
          } else {
            // Add new repository
            console.log(`Adding repository: ${repoConfig.name}`);
            await this.addHandler.handle(repoConfig);
          }

          // Start watching if configured
          if (config.autoWatch && repoConfig.watchMode) {
            console.log(`Starting watch for repository: ${repoConfig.name}`);
            await this.watchHandler.handle({
              name: repoConfig.name,
              action: 'start'
            });
          }
        } catch (error) {
          console.error(`Error processing repository ${repoConfig.name}:`, error);
        }
      }

      console.log('Repositories loaded successfully from configuration');
    } catch (error) {
      console.error('Error loading repositories from configuration:', error);
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
      console.log(`Created default repositories configuration at ${CONFIG_FILE_PATH}`);
    } catch (error) {
      console.error('Error creating default configuration:', error);
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
        } catch (error) {
          console.error(`Error loading repository config ${file}:`, error);
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
      console.log(`Updated repositories configuration at ${CONFIG_FILE_PATH}`);
    } catch (error) {
      console.error('Error updating configuration file:', error);
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
      console.log(`Added repository ${config.name} to configuration`);
    } catch (error) {
      console.error(`Error adding repository ${config.name} to configuration:`, error);
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
        console.log('No repositories.json configuration file found.');
        return;
      }

      // Read the config file
      const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const config = JSON.parse(configContent) as RepositoriesConfig;

      // Remove the repository
      const initialLength = config.repositories.length;
      config.repositories = config.repositories.filter(repo => repo.name !== name);

      if (config.repositories.length === initialLength) {
        console.log(`Repository ${name} not found in configuration`);
        return;
      }

      // Update the config file
      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`Removed repository ${name} from configuration`);
    } catch (error) {
      console.error(`Error removing repository ${name} from configuration:`, error);
    }
  }
}
