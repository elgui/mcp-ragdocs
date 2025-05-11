import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { RepositoryWatcher } from '../utils/repository-watcher.js';
import { UpdateRepositoryHandler } from './update-repository.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

// Map to store active watchers
const activeWatchers = new Map<string, RepositoryWatcher>();

export class WatchRepositoryHandler extends BaseHandler {
  private updateHandler: UpdateRepositoryHandler;

  constructor(server: any, apiClient: any) {
    super(server, apiClient);
    this.updateHandler = new UpdateRepositoryHandler(server, apiClient);
  }

  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    if (args.action !== 'start' && args.action !== 'stop') {
      throw new McpError(ErrorCode.InvalidParams, 'Action must be either "start" or "stop"');
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
      const config = JSON.parse(configContent) as RepositoryConfig;

      if (args.action === 'start') {
        // Check if already watching
        if (activeWatchers.has(repoName)) {
          return {
            content: [
              {
                type: 'text',
                text: `Repository ${repoName} is already being watched`,
              },
            ],
          };
        }

        // Create a new watcher
        const watcher = new RepositoryWatcher(
          config,
          async (changedFiles, removedFiles) => {
            console.log(`Repository ${repoName} changed: ${changedFiles.length} files changed, ${removedFiles.length} files removed`);

            // Update the repository index
            if (changedFiles.length > 0 || removedFiles.length > 0) {
              try {
                // Pass the callContext along if it exists
                await this.updateHandler.handle({ name: repoName }, callContext);
                console.log(`Repository ${repoName} index updated successfully`);
              } catch (error) {
                console.error(`Failed to update repository ${repoName} index:`, error);
              }
            }
          }
        );

        // Start watching
        await watcher.start();
        activeWatchers.set(repoName, watcher);

        // Update the config to reflect watch mode
        config.watchMode = true;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

        // Update the repositories.json configuration file
        const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
        await configLoader.addRepositoryToConfig(config);

        return {
          content: [
            {
              type: 'text',
              text: `Started watching repository: ${repoName} (${config.path})`,
            },
          ],
        };
      } else {
        // Stop watching
        const watcher = activeWatchers.get(repoName);
        if (!watcher) {
          return {
            content: [
              {
                type: 'text',
                text: `Repository ${repoName} is not currently being watched`,
              },
            ],
          };
        }

        watcher.stop();
        activeWatchers.delete(repoName);

        // Update the config to reflect watch mode
        config.watchMode = false;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

        // Update the repositories.json configuration file
        const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
        await configLoader.addRepositoryToConfig(config);

        return {
          content: [
            {
              type: 'text',
              text: `Stopped watching repository: ${repoName} (${config.path})`,
            },
          ],
        };
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to ${args.action} watching repository: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}
