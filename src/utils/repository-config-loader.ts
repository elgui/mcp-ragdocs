import fs from 'fs/promises';
import path from 'path';
import { RepositoryConfig } from '../types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { UpdateRepositoryHandler } from '../handlers/update-repository.js';
import { LocalRepositoryHandler } from '../handlers/local-repository.js';
import { WatchRepositoryHandler } from '../handlers/watch-repository.js';
import { info, error } from './logger.js';

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

/**
 * Class for loading and managing repository configurations from individual files in repo-configs
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
    // Initialize handlers with server and apiClient
    this.updateHandler = new UpdateRepositoryHandler(server, apiClient);
    this.addHandler = new LocalRepositoryHandler(server, apiClient);
    this.watchHandler = new WatchRepositoryHandler(server, apiClient);
  }

  /**
   * Load repositories from individual configuration files in repo-configs and initialize them
   */
  async loadRepositories(): Promise<void> {
    try {
      // Ensure the repo-configs directory exists
      try {
        await fs.access(REPO_CONFIG_DIR);
      } catch {
        info('No repo-configs directory found. No repositories to load at startup.');
        return;
      }

      // Get all repository config files
      const configFiles = await fs.readdir(REPO_CONFIG_DIR);
      const jsonFiles = configFiles.filter(file => file.endsWith('.json'));

      if (jsonFiles.length === 0) {
        info('No repository configuration files found in repo-configs.');
        return;
      }

      info(`Loading ${jsonFiles.length} repositories from repo-configs...`);

      for (const file of jsonFiles) {
        const configPath = path.join(REPO_CONFIG_DIR, file);
        try {
          const configContent = await fs.readFile(configPath, 'utf-8');
          const repoConfig = JSON.parse(configContent) as RepositoryConfig;

          // Check if the repository path exists
          try {
            const stats = await fs.stat(repoConfig.path);
            if (!stats.isDirectory()) {
              error(`Repository path is not a directory: ${repoConfig.path}. Skipping.`);
              continue;
            }
          } catch (err) {
            error(`Repository path does not exist: ${repoConfig.path}. Error: ${err instanceof Error ? err.message : String(err)}. Skipping.`);
            continue;
          }

          // For startup loading, we treat all found configs as needing an update/re-index
          // This ensures consistency with the current state of the files on disk
          info(`Initializing repository: ${repoConfig.name}`);
          await this.updateHandler.handle(repoConfig); // Use updateHandler for initial load

          // Start watching if configured
          if (repoConfig.watchMode) {
            info(`Starting watch for repository: ${repoConfig.name}`);
            // Pass undefined for callContext as this is a server-initiated watch
            await this.watchHandler.handle({
              name: repoConfig.name,
              action: 'start'
            }, undefined);
          }
        } catch (err) {
          error(`Error processing repository config file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      info('Repositories loaded and initialized successfully from repo-configs');
    } catch (err) {
      error(`Error loading repositories from repo-configs: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * This method is no longer used for loading at startup, but is kept for tool-based updates.
   * It updates the configuration file with the current state of repositories.
   * Note: This method's purpose might need re-evaluation if repositories.json is truly obsolete.
   * Keeping it for now based on existing tool usage.
   */
  async updateConfigFile(): Promise<void> {
     // This method's logic might need adjustment if repositories.json is removed entirely.
     // For now, it can potentially be used by tools that still interact with a list concept.
     // If repositories.json is completely removed, this method would become obsolete.
     info('updateConfigFile called. This method might be obsolete if repositories.json is removed.');
     // Current implementation reads from repo-configs and writes to repositories.json
     // This might still be needed for the /repositories endpoint in src/server.ts
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

      // Check if the repositories.json file exists to preserve autoWatch setting
      let existingConfig: { autoWatch?: boolean } = {};
      const CONFIG_FILE_PATH = path.join(process.cwd(), 'repositories.json'); // Use process.cwd() for consistency
      try {
        const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        existingConfig = JSON.parse(configContent);
      } catch {
        // repositories.json doesn't exist, use default autoWatch
      }

      // Update the repositories.json file
      const updatedConfig = {
        repositories,
        autoWatch: existingConfig.autoWatch !== undefined ? existingConfig.autoWatch : true // Preserve existing or default to true
      };

      await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(updatedConfig, null, 2), 'utf-8');
      info(`Updated repositories configuration at ${CONFIG_FILE_PATH}`);
    } catch (err) {
      error(`Error updating repositories.json configuration file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Add a repository to the configuration file (repo-configs)
   * This method is used by the add_repository tool.
   */
  async addRepositoryToConfig(config: RepositoryConfig): Promise<void> {
    // This method now only saves the individual config file in repo-configs.
    // The repositories.json file is updated by updateConfigFile if needed (e.g., for the /repositories endpoint).
    info(`Saving individual repository config for ${config.name} to repo-configs...`);
    try {
      // Ensure the config directory exists
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });

      // Save the config file
      const configPath = path.join(REPO_CONFIG_DIR, `${config.name}.json`);
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      info(`Saved individual repository config for ${config.name} to ${configPath}`);

      // Optionally, update the main repositories.json file if it's still used by the frontend
      // This call might be removed if the frontend is updated to read from a different endpoint
      // or if repositories.json is completely removed.
      await this.updateConfigFile();

    } catch (err) {
      error(`Error adding repository ${config.name} to repo-configs: ${err instanceof Error ? err.message : String(err)}`);
      throw err; // Re-throw to be handled by the calling handler
    }
  }

  /**
   * Remove a repository from the configuration file (repo-configs)
   * This method is used by the remove_repository tool.
   */
  async removeRepositoryFromConfig(name: string): Promise<void> {
    info(`Removing individual repository config for ${name} from repo-configs...`);
    const configPath = path.join(REPO_CONFIG_DIR, `${name}.json`);
    try {
      // Remove the repository config file
      await fs.unlink(configPath);
      info(`Removed individual repository config for ${name} from ${configPath}`);

      // Optionally, update the main repositories.json file if it's still used by the frontend
      // This call might be removed if the frontend is updated to read from a different endpoint
      // or if repositories.json is completely removed.
      await this.updateConfigFile();

    } catch (err) {
      if ((err as any).code === 'ENOENT') {
        info(`Repository config file for ${name} not found in repo-configs. Nothing to remove.`);
      } else {
        error(`Error removing repository ${name} from repo-configs: ${err instanceof Error ? err.message : String(err)}`);
        throw err; // Re-throw to be handled by the calling handler
      }
    }
  }
}
